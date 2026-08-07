import { and, eq, isNull } from 'drizzle-orm';
import type { CallDisposition, CallDto, CompleteCallInput, InitiateCallInput } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { activities, contacts } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import type { AiService } from '../../ai/service.js';
import type { JobRunner } from '../../lib/jobs.js';
import { recordAudit } from '../audit/service.js';
import { createActivity, getActivity, updateActivity } from '../activities/service.js';
import { analyzeCapture } from '../knowledge/service.js';
import { CAPTURE_JOB, type CaptureJobData } from '../knowledge/routes.js';
import type { AuthContext } from '../auth/service.js';
import type { TelephonyProvider } from './provider.js';

function meta(row: { metadata: unknown }): Record<string, unknown> {
  return (row.metadata ?? {}) as Record<string, unknown>;
}

/** Click-to-call: place the call via the provider and open an in-progress call activity. */
export async function initiateCall(
  db: Db,
  telephony: TelephonyProvider,
  ctx: AuthContext,
  input: InitiateCallInput,
): Promise<CallDto> {
  const contact = await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
      .limit(1);
    return row;
  });
  if (!contact) throw new NotFoundError('contact not found');
  if (!contact.phone) throw new ValidationError('contact has no phone number');

  const { providerCallId, recordingUrl } = await telephony.initiateCall({ to: contact.phone });

  const accountId = input.accountId ?? contact.accountId ?? null;
  const activity = await createActivity(db, ctx, {
    type: 'call',
    direction: 'outbound',
    subject: `Call with ${contact.firstName} ${contact.lastName}`.trim(),
    metadata: {
      providerCallId,
      status: 'in_progress',
      to: contact.phone,
      recordingUrl,
    },
    links: {
      contacts: [contact.id],
      ...(accountId ? { accounts: [accountId] } : {}),
      ...(input.dealId ? { deals: [input.dealId] } : {}),
    },
  });

  return {
    activityId: activity.id,
    providerCallId,
    status: 'in_progress',
    to: contact.phone,
    contactId: contact.id,
    accountId,
    dealId: input.dealId ?? null,
  };
}

/**
 * Call ended (softphone hang-up / provider webhook): store duration, recording,
 * disposition; a transcript is routed through the capture pipeline — AI summary,
 * action items, and follow-up email generation all reuse Prompt 9.
 */
export async function completeCall(
  db: Db,
  ai: AiService,
  jobs: JobRunner | null,
  ctx: AuthContext,
  activityId: string,
  input: CompleteCallInput,
): Promise<{ activityId: string; analysisQueued: boolean }> {
  const call = await getActivity(db, ctx, activityId);
  if (call.type !== 'call') throw new ValidationError('activity is not a call');
  const currentMeta = call.metadata;
  if (currentMeta.status === 'completed') throw new ValidationError('call is already completed');

  await withOrg(db, ctx.organizationId, async (tx) => {
    await tx
      .update(activities)
      .set({
        metadata: {
          ...currentMeta,
          status: 'completed',
          durationSeconds: input.durationSeconds,
          ...(input.disposition ? { disposition: input.disposition } : {}),
          ...(input.recordingUrl ? { recordingUrl: input.recordingUrl } : {}),
          completedAt: new Date().toISOString(),
        },
        updatedBy: ctx.userId,
      })
      .where(eq(activities.id, activityId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'activity',
      entityId: activityId,
      changes: {
        status: { from: 'in_progress', to: 'completed' },
        durationSeconds: { from: null, to: input.durationSeconds },
        disposition: { from: null, to: input.disposition ?? null },
      },
    });
  });

  if (!input.transcript) return { activityId, analysisQueued: false };

  // transcript is part of the call record
  await updateActivity(db, ctx, activityId, { body: input.transcript });

  const links = {
    contactId: call.links.contacts[0]?.id,
    accountId: call.links.accounts[0]?.id,
    dealId: call.links.deals[0]?.id,
  };
  if (jobs) {
    await jobs.enqueue(CAPTURE_JOB, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      activityId,
      sourceType: 'call_transcript',
      content: input.transcript,
      links,
    } satisfies CaptureJobData);
    return { activityId, analysisQueued: true };
  }
  await analyzeCapture(db, ai, ctx, {
    activityId,
    sourceType: 'call_transcript',
    content: input.transcript,
    links,
  });
  return { activityId, analysisQueued: false };
}

/** Disposition can be set or corrected after the fact. */
export async function setCallDisposition(
  db: Db,
  ctx: AuthContext,
  activityId: string,
  disposition: CallDisposition,
  notes?: string,
): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [call] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, activityId), isNull(activities.deletedAt)))
      .limit(1);
    if (!call || call.type !== 'call') throw new NotFoundError('call not found');
    const currentMeta = meta(call);
    await tx
      .update(activities)
      .set({
        metadata: {
          ...currentMeta,
          disposition,
          ...(notes ? { dispositionNotes: notes } : {}),
        },
        updatedBy: ctx.userId,
      })
      .where(eq(activities.id, activityId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'activity',
      entityId: activityId,
      changes: { disposition: { from: currentMeta.disposition ?? null, to: disposition } },
    });
  });
}
