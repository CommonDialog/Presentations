import { and, desc, eq } from 'drizzle-orm';
import { activeInsightSchema, activityQuerySchema, taskQuerySchema } from '@crm/shared';
import type { ActiveInsight, DealInsightDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { aiArtifacts } from '../../db/schema/index.js';
import type { AiService } from '../../ai/service.js';
import { renderPrompt } from '../../ai/prompts.js';
import { withOrg } from '../../lib/tenant.js';
import { recordTimeline } from '../timeline/service.js';
import { getDeal, listDealContacts, getStageHistory } from '../deals/service.js';
import { listActivities } from '../activities/service.js';
import { listTasks } from '../tasks/service.js';
import type { AuthContext } from '../auth/service.js';

export const ANALYZE_JOB = 'active.analyze';
export const ANALYZE_DEBOUNCE_SECONDS = 300;

export interface AnalyzeJobData {
  organizationId: string;
  userId: string;
  dealId: string;
}

function toDto(row: typeof aiArtifacts.$inferSelect): DealInsightDto {
  return {
    id: row.id,
    dealId: row.dealId!,
    analysis: (row.payload as { analysis: ActiveInsight }).analysis,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Everything the engine knows about the deal, serialized for the prompt. */
async function buildDealContext(db: Db, ctx: AuthContext, dealId: string): Promise<string> {
  const deal = await getDeal(db, ctx, dealId);
  const contacts = await listDealContacts(db, ctx, dealId);
  const history = await getStageHistory(db, ctx, dealId);
  const activities = await listActivities(
    db,
    ctx,
    activityQuerySchema.parse({ dealId, pageSize: 10 }),
  );
  const openTasks = await listTasks(
    db,
    ctx,
    taskQuerySchema.parse({ dealId, open: true, pageSize: 10 }),
  );

  const lines: string[] = [
    `Deal: ${deal.name} | account: ${deal.accountName} | status: ${deal.status}`,
    `Amount: ${deal.amount ?? '(not set)'} ${deal.currency} | expected close: ${deal.expectedCloseDate ?? '(not set)'} | effective probability: ${deal.effectiveProbability}%`,
    `Stage history: ${history.map((h) => h.toStageName).join(' → ') || '(none)'}`,
    `Contacts on deal: ${
      contacts.map((c) => `${c.firstName} ${c.lastName}${c.role ? ` (${c.role})` : ''}${c.isPrimary ? ' [primary]' : ''}`).join(', ') || '(none)'
    }`,
    `Open tasks: ${openTasks.items.map((t) => t.title).join('; ') || '(none)'}`,
    '',
    'Recent interactions (newest first):',
  ];
  if (activities.items.length === 0) {
    lines.push('(no interactions recorded)');
  }
  for (const activity of activities.items) {
    lines.push(
      `- [${activity.type}${activity.direction ? `/${activity.direction}` : ''}] ${activity.occurredAt.slice(0, 10)} ${activity.subject}`,
    );
    if (activity.body) lines.push(`  ${activity.body.slice(0, 1500).replace(/\n/g, ' ')}`);
  }
  return lines.join('\n');
}

export async function getLatestInsight(
  db: Db,
  ctx: AuthContext,
  dealId: string,
): Promise<DealInsightDto | null> {
  await getDeal(db, ctx, dealId); // 404 when not visible
  const [row] = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(aiArtifacts)
      .where(and(eq(aiArtifacts.kind, 'insight'), eq(aiArtifacts.dealId, dealId)))
      .orderBy(desc(aiArtifacts.createdAt), desc(aiArtifacts.id))
      .limit(1),
  );
  return row ? toDto(row) : null;
}

/**
 * The Active CRM engine: analyze one deal and store the insight. Detection is
 * informational (auto-approved artifact); anything that would CHANGE the CRM —
 * the suggested next actions — becomes pending proposals for human review.
 */
export async function analyzeDeal(
  db: Db,
  ai: AiService,
  ctx: AuthContext,
  dealId: string,
): Promise<DealInsightDto> {
  const deal = await getDeal(db, ctx, dealId);
  const context = await buildDealContext(db, ctx, dealId);
  const prompt = await renderPrompt(db, 'active.analyze', { context });

  const { output } = await ai.completeStructured(
    { organizationId: ctx.organizationId, purpose: 'active.analyze', promptName: prompt.promptName },
    {
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      schema: activeInsightSchema,
    },
  );
  const analysis: ActiveInsight = {
    ...output,
    confidence: Math.min(Math.max(output.confidence, 0), 100),
  };

  const previous = await getLatestInsight(db, ctx, dealId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [artifact] = await tx
      .insert(aiArtifacts)
      .values({
        organizationId: ctx.organizationId,
        kind: 'insight',
        status: 'approved',
        title: `Deal health: ${analysis.health} (${analysis.confidence}% confidence)`,
        payload: { analysis },
        dealId,
        accountId: deal.accountId,
      })
      .returning();

    // Timeline only on the first insight or a health change — re-analysis at
    // the same health would spam every deal timeline.
    if (!previous || previous.analysis.health !== analysis.health) {
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'ai.insight',
        summary: `Deal health ${previous ? `changed to ${analysis.health}` : `assessed as ${analysis.health}`} (${analysis.confidence}% confidence)`,
        actorUserId: null,
        detail: { risks: analysis.risks, reasoning: analysis.reasoning },
        targets: { dealId, accountId: deal.accountId },
        aiArtifactId: artifact!.id,
      });
    }

    // Next actions become task proposals — pending human approval, and deduped
    // against existing pending proposals so re-analysis doesn't stack copies.
    const pendingTitles = new Set(
      (
        await tx
          .select({ title: aiArtifacts.title })
          .from(aiArtifacts)
          .where(
            and(
              eq(aiArtifacts.kind, 'proposal'),
              eq(aiArtifacts.status, 'pending'),
              eq(aiArtifacts.dealId, dealId),
            ),
          )
      ).map((r) => r.title),
    );
    const proposals = analysis.nextActions
      .map((action) => ({
        organizationId: ctx.organizationId,
        kind: 'proposal' as const,
        status: 'pending' as const,
        title: `Create task "${action.title}"`,
        payload: { proposalType: 'create_task', ...action },
        dealId,
        accountId: deal.accountId,
      }))
      .filter((p) => !pendingTitles.has(p.title));
    if (proposals.length > 0) await tx.insert(aiArtifacts).values(proposals);

    return toDto(artifact!);
  });
}
