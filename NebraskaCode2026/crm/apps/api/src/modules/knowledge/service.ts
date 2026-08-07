import { eq, and } from 'drizzle-orm';
import { captureAnalysisSchema } from '@crm/shared';
import type { CaptureAnalysis, CaptureInput, CaptureResultDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, aiArtifacts, contacts, deals, leads } from '../../db/schema/index.js';
import { withOrg } from '../../lib/tenant.js';
import type { AiService } from '../../ai/service.js';
import { renderPrompt } from '../../ai/prompts.js';
import { recordTimeline } from '../timeline/service.js';
import { createActivity, getActivity } from '../activities/service.js';
import { isWhitelistedField, toProposalDto } from '../proposals/service.js';
import type { AuthContext } from '../auth/service.js';

const ACTIVITY_TYPE: Record<CaptureInput['sourceType'], 'email' | 'meeting' | 'call'> = {
  email: 'email',
  meeting_transcript: 'meeting',
  call_transcript: 'call',
};

const SUBJECT_FALLBACK: Record<CaptureInput['sourceType'], string> = {
  email: 'Captured email',
  meeting_transcript: 'Captured meeting',
  call_transcript: 'Captured call',
};

export interface CaptureLinks {
  accountId?: string | undefined;
  contactId?: string | undefined;
  dealId?: string | undefined;
  leadId?: string | undefined;
}

/** Step 1 (synchronous): the interaction is a fact — record it as an activity now. */
export async function captureSource(
  db: Db,
  ctx: AuthContext,
  input: CaptureInput,
): Promise<{ activityId: string }> {
  const activity = await createActivity(db, ctx, {
    type: ACTIVITY_TYPE[input.sourceType],
    ...(input.sourceType === 'email' ? { direction: 'inbound' as const } : {}),
    subject: input.subject ?? SUBJECT_FALLBACK[input.sourceType],
    body: input.content,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    metadata: { capturedBy: 'knowledge_capture', sourceType: input.sourceType },
    links: {
      ...(input.accountId ? { accounts: [input.accountId] } : {}),
      ...(input.contactId ? { contacts: [input.contactId] } : {}),
      ...(input.dealId ? { deals: [input.dealId] } : {}),
      ...(input.leadId ? { leads: [input.leadId] } : {}),
    },
  });
  return { activityId: activity.id };
}

/** CRM context serialized into the prompt so the model grounds suggestions in reality. */
async function buildContext(db: Db, organizationId: string, links: CaptureLinks): Promise<string> {
  return withOrg(db, organizationId, async (tx) => {
    const lines: string[] = [];
    if (links.accountId) {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, links.accountId)).limit(1);
      if (account) {
        lines.push(
          `Account: ${account.name}` +
            (account.industry ? ` | industry: ${account.industry}` : ' | industry: (empty)') +
            (account.website ? ` | website: ${account.website}` : ''),
        );
      }
    }
    if (links.contactId) {
      const [contact] = await tx.select().from(contacts).where(eq(contacts.id, links.contactId)).limit(1);
      if (contact) {
        lines.push(
          `Contact: ${contact.firstName} ${contact.lastName}` +
            (contact.title ? ` | title: ${contact.title}` : ' | title: (empty)') +
            (contact.email ? ` | email: ${contact.email}` : ''),
        );
      }
    }
    if (links.dealId) {
      const [deal] = await tx.select().from(deals).where(eq(deals.id, links.dealId)).limit(1);
      if (deal) {
        lines.push(
          `Deal: ${deal.name} | status: ${deal.status}` +
            (deal.amount ? ` | amount: ${deal.amount}` : ' | amount: (empty)') +
            (deal.expectedCloseDate ? ` | expected close: ${deal.expectedCloseDate}` : ''),
        );
      }
    }
    if (links.leadId) {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, links.leadId)).limit(1);
      if (lead) {
        lines.push(`Lead: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.company}`);
      }
    }
    return lines.join('\n') || '(no linked records)';
  });
}

/** Step 2: LLM analysis → summary artifact (auto-approved) + proposal artifacts (pending review). */
export async function analyzeCapture(
  db: Db,
  ai: AiService,
  ctx: AuthContext,
  params: { activityId: string; sourceType: CaptureInput['sourceType']; content: string; links: CaptureLinks },
): Promise<CaptureResultDto> {
  const context = await buildContext(db, ctx.organizationId, params.links);
  const prompt = await renderPrompt(db, 'knowledge.capture', {
    sourceType: params.sourceType,
    context,
    content: params.content,
  });

  const { output: analysis } = await ai.completeStructured(
    { organizationId: ctx.organizationId, purpose: 'knowledge.capture', promptName: prompt.promptName },
    {
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      schema: captureAnalysisSchema,
    },
  );

  const linkColumns = {
    accountId: params.links.accountId ?? null,
    contactId: params.links.contactId ?? null,
    dealId: params.links.dealId ?? null,
    leadId: params.links.leadId ?? null,
  };
  const linkFor = (entityType: string): string | null =>
    entityType === 'account'
      ? linkColumns.accountId
      : entityType === 'contact'
        ? linkColumns.contactId
        : entityType === 'deal'
          ? linkColumns.dealId
          : null;

  return withOrg(db, ctx.organizationId, async (tx) => {
    // Summary: born approved — it changes no records.
    const [summaryArtifact] = await tx
      .insert(aiArtifacts)
      .values({
        organizationId: ctx.organizationId,
        kind: 'summary',
        status: 'approved',
        title: analysis.summary.slice(0, 120),
        payload: {
          summary: analysis.summary,
          actionItems: analysis.actionItems,
          sentiment: analysis.sentiment,
        },
        model: null,
        sourceActivityId: params.activityId,
        ...linkColumns,
      })
      .returning();
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'ai.summary',
      summary: `AI summary: ${analysis.summary.slice(0, 200)}`,
      actorUserId: null,
      detail: { actionItems: analysis.actionItems, sentiment: analysis.sentiment },
      targets: linkColumns,
      aiArtifactId: summaryArtifact!.id,
    });

    // Proposals: pending until a human reviews. Drop suggestions we cannot
    // safely apply (no linked entity of that type, or non-whitelisted field).
    const proposalRows: (typeof aiArtifacts.$inferInsert)[] = [];
    for (const update of analysis.suggestedUpdates) {
      const entityId = linkFor(update.entityType);
      if (!entityId || !isWhitelistedField(update.entityType, update.field)) continue;
      proposalRows.push({
        organizationId: ctx.organizationId,
        kind: 'proposal',
        status: 'pending',
        title: `Update ${update.entityType} ${update.field} → "${update.suggestedValue}"`,
        payload: { proposalType: 'update_field', ...update },
        sourceActivityId: params.activityId,
        ...linkColumns,
      });
    }
    for (const task of analysis.suggestedTasks) {
      proposalRows.push({
        organizationId: ctx.organizationId,
        kind: 'proposal',
        status: 'pending',
        title: `Create task "${task.title}"`,
        payload: { proposalType: 'create_task', ...task },
        sourceActivityId: params.activityId,
        ...linkColumns,
      });
    }
    if (analysis.followUpEmail) {
      proposalRows.push({
        organizationId: ctx.organizationId,
        kind: 'proposal',
        status: 'pending',
        title: `Send follow-up email: "${analysis.followUpEmail.subject}"`,
        payload: { proposalType: 'followup_email', ...analysis.followUpEmail },
        sourceActivityId: params.activityId,
        ...linkColumns,
      });
    }
    const inserted =
      proposalRows.length > 0 ? await tx.insert(aiArtifacts).values(proposalRows).returning() : [];

    return {
      activityId: params.activityId,
      status: 'analyzed' as const,
      summary: analysis.summary,
      actionItems: analysis.actionItems,
      sentiment: analysis.sentiment,
      proposals: inserted.map(toProposalDto),
    };
  });
}

/** Poll endpoint backing: what has the analysis produced for this capture so far? */
export async function getCaptureResult(
  db: Db,
  ctx: AuthContext,
  activityId: string,
): Promise<CaptureResultDto> {
  await getActivity(db, ctx, activityId); // 404 when not visible in this org
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [summary] = await tx
      .select()
      .from(aiArtifacts)
      .where(and(eq(aiArtifacts.sourceActivityId, activityId), eq(aiArtifacts.kind, 'summary')))
      .limit(1);
    if (!summary) return { activityId, status: 'queued' as const };
    const proposals = await tx
      .select()
      .from(aiArtifacts)
      .where(and(eq(aiArtifacts.sourceActivityId, activityId), eq(aiArtifacts.kind, 'proposal')));
    const payload = (summary.payload ?? {}) as Record<string, unknown>;
    return {
      activityId,
      status: 'analyzed' as const,
      summary: String(payload.summary ?? ''),
      actionItems: (payload.actionItems as string[]) ?? [],
      sentiment: String(payload.sentiment ?? 'neutral'),
      proposals: proposals.map(toProposalDto),
    };
  });
}
