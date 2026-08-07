import { desc, eq, isNull, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  copilotIntents,
  type CopilotAskInput,
  type CopilotIntent,
  type CopilotResponseDto,
  type CopilotSourceDto,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import {
  accounts,
  activities,
  activityLinks,
  contacts,
  deals,
  pipelineStages,
  tasks,
} from '../../db/schema/index.js';
import { withOrg } from '../../lib/tenant.js';
import { renderPrompt } from '../../ai/prompts.js';
import {
  appendMessage,
  createConversation,
  getConversation,
} from '../../ai/conversations.js';
import { getLatestInsight } from '../active/service.js';
import { listUpcomingMeetings, prepareMeeting } from '../calendar/service.js';
import { getForecast } from '../deals/service.js';
import {
  activityReport,
  customerHealthReport,
  projectHealthReport,
  revenueReport,
  salesReport,
  stalledReport,
  velocityReport,
} from '../reports/service.js';
import { globalSearch } from '../search/service.js';
import type { AuthContext } from '../auth/service.js';

// The copilot answers in three steps: (1) a structured LLM call routes the
// request to an intent, (2) plain code loads REAL CRM data for that intent,
// (3) the LLM writes the reply from that context alone. The model never
// fetches anything itself, so every answer is grounded in rows that exist —
// and when the plan call fails, step 2 degrades to a search-grounded Q&A.

const planSchema = z.object({
  intent: z.enum(copilotIntents),
  entityType: z.enum(['account', 'contact', 'deal', 'lead', 'project']).nullable(),
  entityName: z.string().nullable(),
  detail: z.string().nullable(),
});
type Plan = z.infer<typeof planSchema>;

interface Grounding {
  lines: string[];
  sources: CopilotSourceDto[];
  navigation: { url: string; label: string } | null;
}

const PAGES: Record<string, { url: string; label: string }> = {
  pipeline: { url: '/deals', label: 'Pipeline' },
  deal: { url: '/deals', label: 'Pipeline' },
  board: { url: '/deals', label: 'Pipeline' },
  lead: { url: '/leads', label: 'Leads' },
  account: { url: '/accounts', label: 'Accounts' },
  contact: { url: '/contacts', label: 'Contacts' },
  task: { url: '/tasks', label: 'Tasks' },
  project: { url: '/projects', label: 'Projects' },
  meeting: { url: '/meetings', label: 'Meetings' },
  capture: { url: '/capture', label: 'Capture' },
  approval: { url: '/approvals', label: 'Approvals' },
  report: { url: '/reports', label: 'Reports' },
  dashboard: { url: '/reports', label: 'Reports' },
  forecast: { url: '/reports', label: 'Reports' },
  workflow: { url: '/workflows', label: 'Workflows' },
  customiz: { url: '/settings/customization', label: 'Customization' },
  setup: { url: '/settings/customization', label: 'Customization' },
  integration: { url: '/settings/integrations', label: 'Integrations' },
};

function money(value: number | null): string {
  return value === null ? 'no amount' : `$${value.toLocaleString()}`;
}

function truncate(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function resolveRecord(
  db: Db,
  ctx: AuthContext,
  name: string,
  entityType?: string | null,
): Promise<CopilotSourceDto | null> {
  const types =
    entityType && ['account', 'contact', 'deal', 'lead', 'project'].includes(entityType)
      ? entityType
      : 'account,contact,deal,lead,project';
  const { results } = await globalSearch(db, ctx, { q: name, types, limit: 2 });
  const hit = results[0];
  return hit ? { type: hit.type, id: hit.id, title: hit.title, url: hit.url } : null;
}

// ---------- per-record context loaders ----------

async function accountLines(db: Db, ctx: AuthContext, accountId: string): Promise<string[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!account) return [];
    const lines = [
      `Account: ${account.name}${account.industry ? ` (${account.industry})` : ''}${account.domain ? ` — ${account.domain}` : ''}`,
    ];
    if (account.description) lines.push(`Description: ${truncate(account.description, 200)}`);

    const contactRows = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), isNull(contacts.deletedAt)))
      .limit(10);
    if (contactRows.length > 0) {
      lines.push(
        `Contacts: ${contactRows.map((c) => `${c.firstName} ${c.lastName}${c.title ? ` (${c.title})` : ''}`).join('; ')}`,
      );
    }

    const dealRows = await tx
      .select({ d: deals, stageName: pipelineStages.name })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(and(eq(deals.accountId, accountId), isNull(deals.deletedAt)))
      .orderBy(desc(deals.updatedAt))
      .limit(10);
    for (const { d, stageName } of dealRows) {
      lines.push(
        `Deal: "${d.name}" — ${d.status}, stage ${stageName}, ${money(d.amount === null ? null : Number(d.amount))}${d.expectedCloseDate ? `, expected close ${d.expectedCloseDate}` : ''}`,
      );
    }

    const recent = await tx
      .select({ a: activities })
      .from(activityLinks)
      .innerJoin(activities, eq(activities.id, activityLinks.activityId))
      .where(and(eq(activityLinks.accountId, accountId), isNull(activities.deletedAt)))
      .orderBy(desc(activities.occurredAt))
      .limit(5);
    for (const { a } of recent) {
      lines.push(
        `Activity (${a.occurredAt.toISOString().slice(0, 10)}, ${a.type}): ${a.subject}${a.body ? ` — ${truncate(a.body, 200)}` : ''}`,
      );
    }
    if (recent.length === 0) lines.push('No activities logged for this account.');

    const [openTasks] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.accountId, accountId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} in ('open', 'in_progress')`,
        ),
      );
    lines.push(`Open tasks on this account: ${openTasks?.count ?? 0}`);
    return lines;
  });
}

async function dealLines(
  db: Db,
  ctx: AuthContext,
  dealId: string,
): Promise<string[]> {
  const base = await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .select({ d: deals, stageName: pipelineStages.name, accountName: accounts.name })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .innerJoin(accounts, eq(accounts.id, deals.accountId))
      .where(eq(deals.id, dealId))
      .limit(1);
    if (!row) return [];
    const { d, stageName, accountName } = row;
    const lines = [
      `Deal: "${d.name}" for ${accountName} — ${d.status}, stage ${stageName}, ${money(d.amount === null ? null : Number(d.amount))}${d.expectedCloseDate ? `, expected close ${d.expectedCloseDate}` : ''}, created ${d.createdAt.toISOString().slice(0, 10)}`,
    ];
    if (d.winLossReason) lines.push(`Win/loss reason: ${d.winLossReason}`);

    const recent = await tx
      .select({ a: activities })
      .from(activityLinks)
      .innerJoin(activities, eq(activities.id, activityLinks.activityId))
      .where(and(eq(activityLinks.dealId, dealId), isNull(activities.deletedAt)))
      .orderBy(desc(activities.occurredAt))
      .limit(5);
    for (const { a } of recent) {
      lines.push(
        `Activity (${a.occurredAt.toISOString().slice(0, 10)}, ${a.type}): ${a.subject}${a.body ? ` — ${truncate(a.body, 200)}` : ''}`,
      );
    }
    if (recent.length === 0) lines.push('No activities logged on this deal.');
    return lines;
  });
  if (base.length === 0) return base;

  const insight = await getLatestInsight(db, ctx, dealId);
  if (insight) {
    base.push(`Latest AI deal analysis (${insight.createdAt.slice(0, 10)}): ${truncate(JSON.stringify(insight.analysis), 900)}`);
  }
  return base;
}

async function contactContextLines(db: Db, ctx: AuthContext, contactId: string): Promise<string[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .select({ c: contacts, accountName: accounts.name })
      .from(contacts)
      .leftJoin(accounts, eq(accounts.id, contacts.accountId))
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!row) return [];
    const { c, accountName } = row;
    const lines = [
      `Contact: ${c.firstName} ${c.lastName}${c.title ? `, ${c.title}` : ''}${accountName ? ` at ${accountName}` : ''}${c.email ? ` <${c.email}>` : ''}`,
    ];
    const recent = await tx
      .select({ a: activities })
      .from(activityLinks)
      .innerJoin(activities, eq(activities.id, activityLinks.activityId))
      .where(and(eq(activityLinks.contactId, contactId), isNull(activities.deletedAt)))
      .orderBy(desc(activities.occurredAt))
      .limit(5);
    for (const { a } of recent) {
      lines.push(
        `Interaction (${a.occurredAt.toISOString().slice(0, 10)}, ${a.type}${a.direction ? ` ${a.direction}` : ''}): ${a.subject}${a.body ? ` — ${truncate(a.body, 250)}` : ''}`,
      );
    }
    if (recent.length === 0) lines.push('No interactions logged with this contact.');
    return lines;
  });
}

async function recordLines(
  db: Db,
  ctx: AuthContext,
  source: CopilotSourceDto,
): Promise<string[]> {
  if (source.type === 'account') return accountLines(db, ctx, source.id);
  if (source.type === 'deal') return dealLines(db, ctx, source.id);
  if (source.type === 'contact') return contactContextLines(db, ctx, source.id);
  return [`${source.type}: ${source.title}`];
}

// ---------- intent grounding ----------

async function reportGrounding(app: FastifyInstance, ctx: AuthContext, detail: string | null): Promise<Grounding> {
  const kind = (detail ?? 'sales').toLowerCase();
  const lines: string[] = [];
  const add = (label: string, data: unknown) => lines.push(`${label}: ${truncate(JSON.stringify(data), 1500)}`);

  if (kind.includes('revenue')) add('Revenue report (last 6 months)', await revenueReport(app.db, ctx, 6));
  else if (kind.includes('velocit')) add('Stage velocity (30d)', await velocityReport(app.db, ctx, 30));
  else if (kind.includes('stall')) add('Stalled deals (idle 14d+)', await stalledReport(app.db, ctx, 14));
  else if (kind.includes('activit')) add('Activity report (30d)', await activityReport(app.db, ctx, 30));
  else if (kind.includes('project')) add('Project health', await projectHealthReport(app.db, ctx));
  else if (kind.includes('customer') || kind.includes('health')) add('Customer health', await customerHealthReport(app.db, ctx));
  else {
    add('Sales report (30d)', await salesReport(app.db, ctx, 30));
    add('Pipeline forecast', await getForecast(app.db, ctx));
  }
  return { lines, sources: [], navigation: { url: '/reports', label: 'Open reports' } };
}

async function orgSnapshotLines(app: FastifyInstance, ctx: AuthContext): Promise<string[]> {
  const [sales, stalled] = await Promise.all([
    salesReport(app.db, ctx, 30),
    stalledReport(app.db, ctx, 14),
  ]);
  return [
    `Org snapshot (30d): ${sales.won.count} deals won ($${sales.won.amount.toLocaleString()}), ${sales.lost.count} lost, win rate ${sales.winRate ?? 'n/a'}%, open pipeline ${sales.openPipeline.count} deals ($${sales.openPipeline.amount.toLocaleString()}, weighted $${sales.openPipeline.weighted.toLocaleString()}).`,
    `Stalled deals (no touch in 14d+): ${stalled.deals.length}${stalled.deals.length > 0 ? ` — ${stalled.deals.slice(0, 5).map((d) => `"${d.name}" (${d.idleDays}d idle, ${money(d.amount)})`).join('; ')}` : ''}`,
  ];
}

async function gatherGrounding(
  app: FastifyInstance,
  ctx: AuthContext,
  plan: Plan,
  message: string,
): Promise<Grounding> {
  const db = app.db;
  const sources: CopilotSourceDto[] = [];
  const lines: string[] = [];

  if (plan.intent === 'generate_report') return reportGrounding(app, ctx, plan.detail);

  if (plan.intent === 'prepare_meeting') {
    const meetings = await listUpcomingMeetings(db, ctx);
    const needle = (plan.entityName ?? plan.detail ?? '').toLowerCase();
    const meeting =
      (needle
        ? meetings.find(
            (m) =>
              m.title.toLowerCase().includes(needle) ||
              m.attendees.some((a) => (a.name ?? a.email).toLowerCase().includes(needle)),
          )
        : undefined) ?? meetings[0];
    if (!meeting) {
      return { lines: ['No upcoming meetings in the CRM.'], sources, navigation: { url: '/meetings', label: 'Open meetings' } };
    }
    const prep = await prepareMeeting(db, app.ai, ctx, meeting.activityId);
    lines.push(
      `Upcoming meeting: "${meeting.title}" at ${meeting.startsAt} with ${meeting.attendees.map((a) => a.name ?? a.email).join(', ') || 'no listed attendees'}.`,
      `Meeting prep: ${truncate(JSON.stringify(prep.prep), 1500)}`,
    );
    return { lines, sources, navigation: { url: '/meetings', label: 'Open meetings' } };
  }

  // record-focused intents
  if (plan.entityName) {
    const record = await resolveRecord(db, ctx, plan.entityName, plan.entityType);
    if (record) {
      sources.push(record);
      lines.push(...(await recordLines(db, ctx, record)));
    } else {
      lines.push(`No CRM record matched "${plan.entityName}".`);
    }
  }

  if (plan.intent === 'draft_email' && plan.detail) {
    lines.push(`Email topic requested: ${plan.detail}`);
  }

  // org-wide grounding when nothing specific was named, and for risk/action asks
  if (
    sources.length === 0 ||
    plan.intent === 'predict_risks' ||
    plan.intent === 'recommend_next_actions'
  ) {
    lines.push(...(await orgSnapshotLines(app, ctx)));
  }

  // generic question with no named record: search the message's meaningful words
  if (plan.intent === 'answer_question' && sources.length === 0) {
    const STOPWORDS = new Set([
      'what', 'when', 'where', 'which', 'about', 'with', 'have', 'this', 'that', 'there',
      'anything', 'happening', 'going', 'doing', 'tell', 'show', 'give', 'their', 'from',
    ]);
    const tokens = [
      ...new Set((message.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOPWORDS.has(t))),
    ].slice(0, 3);
    const seen = new Set<string>();
    for (const token of tokens) {
      const { results } = await globalSearch(db, ctx, { q: token, limit: 2 });
      for (const hit of results.slice(0, 4)) {
        const key = `${hit.type}:${hit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`Search hit (${hit.type}): ${hit.title}${hit.meta ? ` — ${hit.meta}` : ''}${hit.snippet ? ` — ${hit.snippet}` : ''}`);
        sources.push({ type: hit.type, id: hit.id, title: hit.title, url: hit.url });
      }
    }
  }

  return { lines, sources, navigation: sources[0]?.url ? { url: sources[0].url, label: `Open ${sources[0].title}` } : null };
}

function resolveNavigation(plan: Plan, message: string): { url: string; label: string } | null {
  const haystack = `${plan.detail ?? ''} ${plan.entityName ?? ''} ${message}`.toLowerCase();
  // longest key first, so "dashboard" beats "board"
  const entries = Object.entries(PAGES).sort(([a], [b]) => b.length - a.length);
  for (const [key, page] of entries) {
    if (haystack.includes(key)) return page;
  }
  return null;
}

// ---------- the ask loop ----------

export async function copilotAsk(
  app: FastifyInstance,
  ctx: AuthContext,
  input: CopilotAskInput,
): Promise<CopilotResponseDto> {
  const db = app.db;
  const conversationId =
    input.conversationId ?? (await createConversation(db, ctx, truncate(input.message, 80))).id;
  const history = input.conversationId
    ? (await getConversation(db, ctx, conversationId)).messages
    : [];
  await appendMessage(db, ctx, conversationId, 'user', input.message);

  // 1. route
  let plan: Plan;
  try {
    const planPrompt = await renderPrompt(db, 'copilot.plan', { message: input.message });
    const { output } = await app.ai.completeStructured(
      { organizationId: ctx.organizationId, purpose: 'copilot.plan', promptName: planPrompt.promptName },
      { system: planPrompt.system, messages: [{ role: 'user', content: planPrompt.user }], schema: planSchema },
    );
    plan = output;
  } catch {
    plan = { intent: 'answer_question', entityType: null, entityName: null, detail: null };
  }

  // 2. navigation is deterministic — no generation, nothing to fabricate
  if (plan.intent === 'navigate') {
    let navigation = null;
    let message: string;
    const sources: CopilotSourceDto[] = [];
    if (plan.entityName) {
      const record = await resolveRecord(db, ctx, plan.entityName, plan.entityType);
      if (record?.url) {
        navigation = { url: record.url, label: `Open ${record.title}` };
        sources.push(record);
      }
    }
    navigation ??= resolveNavigation(plan, input.message);
    message = navigation
      ? `Here you go — ${navigation.label.toLowerCase()}.`
      : `I couldn't find that page or record in the CRM.`;
    await appendMessage(db, ctx, conversationId, 'assistant', message);
    return { conversationId, intent: plan.intent, message, sources, navigation };
  }

  // 3. ground
  const grounding = await gatherGrounding(app, ctx, plan, input.message);
  const context = grounding.lines.length > 0 ? grounding.lines.join('\n') : 'No matching CRM records found.';

  // 4. respond from the context alone
  const prompt = await renderPrompt(db, 'copilot.respond', { context, message: input.message });
  const priorTurns = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const { text } = await app.ai.complete(
    { organizationId: ctx.organizationId, purpose: `copilot.${plan.intent}`, promptName: prompt.promptName },
    { system: prompt.system, messages: [...priorTurns, { role: 'user', content: prompt.user }] },
  );

  await appendMessage(db, ctx, conversationId, 'assistant', text);
  return {
    conversationId,
    intent: plan.intent,
    message: text,
    sources: grounding.sources.slice(0, 8),
    navigation: grounding.navigation,
  };
}
