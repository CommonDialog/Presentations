import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { meetingPrepSchema } from '@crm/shared';
import type {
  CalendarEventInput,
  CalendarIngestResult,
  CreateEventInput,
  MeetingPrep,
  MeetingPrepDto,
  UpcomingMeetingDto,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, activities, aiArtifacts, contacts } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import type { AiService } from '../../ai/service.js';
import { renderPrompt } from '../../ai/prompts.js';
import { recordTimeline } from '../timeline/service.js';
import { createActivity, getActivity, updateActivity } from '../activities/service.js';
import { analyzeCapture } from '../knowledge/service.js';
import type { AuthContext } from '../auth/service.js';
import type { CalendarProvider } from './provider.js';
import type { JobRunner } from '../../lib/jobs.js';
import { CAPTURE_JOB, type CaptureJobData } from '../knowledge/routes.js';

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

interface MatchedAttendees {
  contactIds: string[];
  accountIds: string[];
  unmatched: string[];
}

/** Attendee emails → known contacts (and their accounts) + domain-matched accounts. */
async function matchAttendees(
  db: Db,
  organizationId: string,
  attendees: { email: string }[],
  ownEmail: string,
): Promise<MatchedAttendees> {
  return withOrg(db, organizationId, async (tx) => {
    const contactIds = new Set<string>();
    const accountIds = new Set<string>();
    const unmatched: string[] = [];
    for (const attendee of attendees) {
      if (attendee.email === ownEmail) continue; // don't match ourselves
      const [contact] = await tx
        .select({ id: contacts.id, accountId: contacts.accountId })
        .from(contacts)
        .where(and(eq(sql`lower(${contacts.email})`, attendee.email), isNull(contacts.deletedAt)))
        .limit(1);
      if (contact) {
        contactIds.add(contact.id);
        if (contact.accountId) accountIds.add(contact.accountId);
        continue;
      }
      const domain = attendee.email.split('@')[1]!;
      if (!FREE_MAIL_DOMAINS.has(domain)) {
        const [account] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.domain, domain), isNull(accounts.deletedAt)))
          .limit(1);
        if (account) {
          accountIds.add(account.id);
          unmatched.push(attendee.email); // account matched, person unknown
          continue;
        }
      }
      unmatched.push(attendee.email);
    }
    return { contactIds: [...contactIds], accountIds: [...accountIds], unmatched };
  });
}

/** Inbound calendar sync: dedup, match attendees, create the meeting activity. */
export async function ingestCalendarEvent(
  db: Db,
  ctx: AuthContext,
  event: CalendarEventInput,
  extraLinks: { accountId?: string | undefined; dealId?: string | undefined } = {},
): Promise<CalendarIngestResult> {
  const existing = await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.type, 'meeting'),
          isNull(activities.deletedAt),
          sql`${activities.metadata}->>'providerEventId' = ${event.providerEventId}`,
        ),
      )
      .limit(1);
    return row;
  });
  if (existing) {
    return {
      activityId: existing.id,
      duplicate: true,
      matchedContactIds: [],
      matchedAccountIds: [],
      unmatchedAttendees: [],
    };
  }

  const matched = await matchAttendees(db, ctx.organizationId, event.attendees, ctx.email);
  const accountIds = new Set(matched.accountIds);
  if (extraLinks.accountId) accountIds.add(extraLinks.accountId);

  if (matched.contactIds.length === 0 && accountIds.size === 0 && !extraLinks.dealId) {
    throw new ValidationError(
      'no attendee matched a contact or account — link the meeting to a record first',
    );
  }

  const activity = await createActivity(db, ctx, {
    type: 'meeting',
    subject: event.title,
    ...(event.description ? { body: event.description } : {}),
    occurredAt: event.startsAt,
    metadata: {
      providerEventId: event.providerEventId,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location ?? null,
      attendees: event.attendees,
      organizer: event.organizer?.email ?? null,
      unmatchedAttendees: matched.unmatched,
    },
    links: {
      ...(matched.contactIds.length > 0 ? { contacts: matched.contactIds } : {}),
      ...(accountIds.size > 0 ? { accounts: [...accountIds] } : {}),
      ...(extraLinks.dealId ? { deals: [extraLinks.dealId] } : {}),
    },
  });

  return {
    activityId: activity.id,
    duplicate: false,
    matchedContactIds: matched.contactIds,
    matchedAccountIds: [...accountIds],
    unmatchedAttendees: matched.unmatched,
  };
}

/** Outbound: create in the external calendar, then ingest locally. */
export async function createCalendarEvent(
  db: Db,
  calendar: CalendarProvider,
  ctx: AuthContext,
  input: CreateEventInput,
): Promise<CalendarIngestResult & { providerEventId: string }> {
  const { providerEventId } = await calendar.createEvent(input);
  const result = await ingestCalendarEvent(
    db,
    ctx,
    {
      providerEventId,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...(input.location ? { location: input.location } : {}),
      attendees: input.attendeeEmails.map((email) => ({ email })),
      organizer: { email: ctx.email },
    },
    { accountId: input.accountId, dealId: input.dealId },
  );
  return { ...result, providerEventId };
}

export async function listUpcomingMeetings(
  db: Db,
  ctx: AuthContext,
): Promise<UpcomingMeetingDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.type, 'meeting'),
          isNull(activities.deletedAt),
          gte(activities.occurredAt, new Date()),
        ),
      )
      .orderBy(asc(activities.occurredAt))
      .limit(50),
  );
  const results: UpcomingMeetingDto[] = [];
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const links = await getActivity(db, ctx, row.id);
    results.push({
      activityId: row.id,
      title: row.subject,
      startsAt: String(meta.startsAt ?? row.occurredAt.toISOString()),
      endsAt: String(meta.endsAt ?? row.occurredAt.toISOString()),
      location: typeof meta.location === 'string' ? meta.location : null,
      attendees: Array.isArray(meta.attendees)
        ? (meta.attendees as { email: string; name?: string }[])
        : [],
      accountIds: links.links.accounts.map((a) => a.id),
      contactIds: links.links.contacts.map((c) => c.id),
    });
  }
  return results;
}

/** AI meeting preparation from everything the CRM knows about the participants. */
export async function prepareMeeting(
  db: Db,
  ai: AiService,
  ctx: AuthContext,
  activityId: string,
): Promise<MeetingPrepDto> {
  const meeting = await getActivity(db, ctx, activityId);
  if (meeting.type !== 'meeting') throw new ValidationError('activity is not a meeting');

  const lines: string[] = [
    `Meeting: ${meeting.subject}`,
    `When: ${String((meeting.metadata as Record<string, unknown>).startsAt ?? meeting.occurredAt)}`,
    `Attendees: ${JSON.stringify((meeting.metadata as Record<string, unknown>).attendees ?? [])}`,
    '',
  ];
  for (const accountRef of meeting.links.accounts) {
    lines.push(`Account: ${accountRef.label}`);
  }
  for (const contactRef of meeting.links.contacts) {
    lines.push(`Known contact: ${contactRef.label}`);
  }
  // recent interactions across the linked records
  const recent = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(activities)
      .where(and(isNull(activities.deletedAt), sql`${activities.id} <> ${activityId}`))
      .orderBy(desc(activities.occurredAt))
      .limit(8),
  );
  lines.push('', 'Recent interactions (org-wide, newest first):');
  for (const activity of recent) {
    lines.push(`- [${activity.type}] ${activity.subject}`);
    if (activity.body) lines.push(`  ${activity.body.slice(0, 500).replace(/\n/g, ' ')}`);
  }

  const prompt = await renderPrompt(db, 'calendar.prepare', { context: lines.join('\n') });
  const { output } = await ai.completeStructured(
    { organizationId: ctx.organizationId, purpose: 'calendar.prepare', promptName: prompt.promptName },
    {
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      schema: meetingPrepSchema,
    },
  );

  return withOrg(db, ctx.organizationId, async (tx) => {
    const accountId = meeting.links.accounts[0]?.id ?? null;
    const contactId = meeting.links.contacts[0]?.id ?? null;
    const [artifact] = await tx
      .insert(aiArtifacts)
      .values({
        organizationId: ctx.organizationId,
        kind: 'summary',
        status: 'approved',
        title: `Meeting prep: ${meeting.subject}`.slice(0, 120),
        payload: { type: 'meeting_prep', prep: output },
        sourceActivityId: activityId,
        accountId,
        contactId,
      })
      .returning();
    if (accountId || contactId) {
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'ai.meeting_prep',
        summary: `Meeting prep generated for "${meeting.subject}"`,
        actorUserId: ctx.userId,
        targets: { accountId, contactId },
        aiArtifactId: artifact!.id,
      });
    }
    return {
      id: artifact!.id,
      activityId,
      prep: output,
      createdAt: artifact!.createdAt.toISOString(),
    };
  });
}

export async function getMeetingPrep(
  db: Db,
  ctx: AuthContext,
  activityId: string,
): Promise<MeetingPrepDto | null> {
  await getActivity(db, ctx, activityId);
  const [row] = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(aiArtifacts)
      .where(
        and(
          eq(aiArtifacts.sourceActivityId, activityId),
          eq(aiArtifacts.kind, 'summary'),
          sql`${aiArtifacts.payload}->>'type' = 'meeting_prep'`,
        ),
      )
      .orderBy(desc(aiArtifacts.createdAt))
      .limit(1),
  );
  if (!row) return null;
  return {
    id: row.id,
    activityId,
    prep: (row.payload as { prep: MeetingPrep }).prep,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Post-meeting: attach the transcript and run it through the capture pipeline. */
export async function summarizeMeeting(
  db: Db,
  ai: AiService,
  jobs: JobRunner | null,
  ctx: AuthContext,
  activityId: string,
  transcript: string,
): Promise<{ activityId: string; queued: boolean }> {
  const meeting = await getActivity(db, ctx, activityId);
  if (meeting.type !== 'meeting') throw new ValidationError('activity is not a meeting');
  if (meeting.links.accounts.length === 0 && meeting.links.contacts.length === 0) {
    throw new NotFoundError('meeting has no linked records to attach the summary to');
  }

  await updateActivity(db, ctx, activityId, { body: transcript });

  const links = {
    accountId: meeting.links.accounts[0]?.id,
    contactId: meeting.links.contacts[0]?.id,
    dealId: meeting.links.deals[0]?.id,
  };
  if (jobs) {
    await jobs.enqueue(CAPTURE_JOB, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      activityId,
      sourceType: 'meeting_transcript',
      content: transcript,
      links,
    } satisfies CaptureJobData);
    return { activityId, queued: true };
  }
  await analyzeCapture(db, ai, ctx, {
    activityId,
    sourceType: 'meeting_transcript',
    content: transcript,
    links,
  });
  return { activityId, queued: false };
}
