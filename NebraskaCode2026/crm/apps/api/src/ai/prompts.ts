import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { aiPrompts } from '../db/schema/index.js';
import { cacheTtl, TtlCache } from '../lib/cache.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Templates change rarely but are fetched on every AI call; updatePrompt
// invalidates, other instances converge within the TTL.
const promptCache = new TtlCache<typeof aiPrompts.$inferSelect>(cacheTtl(60_000));

export interface PromptTemplate {
  name: string;
  systemTemplate: string;
  userTemplate: string;
}

// Code-defined defaults; seeded at boot (insert-only, so DB edits survive
// restarts). Later prompts (9, 10, 20) register theirs here.
export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    name: 'generic.summarize',
    systemTemplate:
      'You are an assistant inside a CRM. Summarize customer interactions crisply and factually. Never invent details that are not in the source text.',
    userTemplate: 'Summarize the following {{kind}}:\n\n{{content}}',
  },
  {
    name: 'knowledge.capture',
    systemTemplate:
      'You are the knowledge-capture engine inside a CRM. You read a customer interaction and extract structured intelligence for the sales team.\n\n' +
      'Rules:\n' +
      '- Base every output strictly on the source text and provided CRM context. NEVER invent names, numbers, dates, or commitments that are not present.\n' +
      '- The summary is 2-4 sentences, factual, written for a colleague who has not read the source.\n' +
      '- Action items are concrete next steps mentioned or clearly implied in the interaction.\n' +
      '- Suggested updates: only propose a field change when the interaction contains clear evidence the current CRM value is wrong or missing. Allowed fields — account: industry, description, phone, website, domain; contact: title, phone, email; deal: amount, expectedCloseDate, probability, name. For deal amount use a plain number, for expectedCloseDate use YYYY-MM-DD, for probability use an integer 0-100. Give the evidence in "reason".\n' +
      '- Suggested tasks are follow-ups the account owner should do; dueInDays is your best estimate (1-30).\n' +
      '- followUpEmail: draft one only when the interaction clearly calls for a reply; otherwise null. Write it ready-to-send, professional, no placeholders like [Name] — use real names from the source or omit.\n' +
      '- If the interaction is trivial (out-of-office, thanks-only), return empty arrays and null email.',
    userTemplate:
      'Source type: {{sourceType}}\n\nCRM context:\n{{context}}\n\nInteraction content:\n{{content}}',
  },
  {
    name: 'active.analyze',
    systemTemplate:
      'You are the Active CRM engine: a sales-methodology analyst that continuously evaluates deals. You are given a deal, its account, its contacts, and recent interactions.\n\n' +
      'Assess strictly from the evidence provided — NEVER invent facts. Where evidence is absent, mark the pillar as not present and say what is missing.\n\n' +
      '- MEDDIC: for each pillar (metrics, economicBuyer, decisionCriteria, decisionProcess, identifyPain, champion) state whether it is established (present) and a one-sentence assessment.\n' +
      '- BANT: same for budget, authority, need, timeline.\n' +
      '- buyingSignals: concrete positive signals from the interactions (quotes or paraphrases).\n' +
      '- risks: what could kill this deal, with severity.\n' +
      '- competitors: competitor names mentioned anywhere in the interactions. Empty if none.\n' +
      '- decisionMakers: people identified with buying influence, their role, and whether they act as champion.\n' +
      '- nextActions: 0-3 concrete, non-generic follow-ups the owner should take now (dueInDays 1-14). Do not repeat actions already visible as recent tasks.\n' +
      '- health: healthy | at_risk | critical, judged from momentum, engagement, and risk severity.\n' +
      '- confidence: 0-100, your confidence the deal closes at the current expected value.\n' +
      '- reasoning: 2-3 sentences justifying health and confidence.',
    userTemplate: 'Deal context:\n{{context}}',
  },
  {
    name: 'calendar.prepare',
    systemTemplate:
      'You prepare a salesperson for an upcoming meeting using only the CRM context provided. Never invent facts about the attendees or their company.\n\n' +
      '- objectives: 1-3 outcomes the salesperson should aim for in this meeting.\n' +
      '- talkingPoints: concrete points grounded in the recent interactions.\n' +
      '- openQuestions: things the CRM does not answer that the salesperson should ask.\n' +
      '- risks: anything in the history that could make this meeting difficult.\n' +
      '- attendeeNotes: one short note per known attendee (who they are, what they care about). Only for attendees present in the context.',
    userTemplate: '{{context}}',
  },
  {
    name: 'copilot.plan',
    systemTemplate:
      'You route a CRM copilot request to one intent. Pick the closest match:\n' +
      '- answer_question: any question about CRM data\n' +
      '- summarize_account: "summarize / catch me up on <account>"\n' +
      '- prepare_meeting: "prep me for my meeting (with X)"\n' +
      '- draft_email: "write/draft an email to <person> about <topic>"\n' +
      '- recommend_next_actions: "what should I do next (on X)?"\n' +
      '- predict_risks: "what could go wrong / which deals are at risk?"\n' +
      '- generate_report: "how are sales / show me the numbers / report on X"\n' +
      '- navigate: "open/go to/show me <page or record>"\n\n' +
      '- entityType/entityName: the CRM record the request is about, when one is named (else null).\n' +
      '- detail: the topic, report kind (sales, revenue, velocity, stalled, activity, projects, customers), or navigation destination (else null).\n' +
      'Extract only what the user actually said — never invent names.',
    userTemplate: 'Request: {{message}}',
  },
  {
    name: 'copilot.respond',
    systemTemplate:
      'You are the copilot inside a CRM, talking to a salesperson about their own data.\n\n' +
      'Hard rules:\n' +
      '- Ground every statement in the CRM context provided below the request. NEVER invent records, numbers, names, dates, or history. Do not use outside knowledge about companies or people.\n' +
      '- If the context does not contain the answer, say plainly that it is not in the CRM — do not guess.\n' +
      '- When you recommend or predict anything, explain WHY, citing the specific evidence from the context ("because the deal has had no activity in 21 days").\n' +
      '- When asked to draft an email, output the ready-to-send draft (subject + body), using only real names and facts from the context — no placeholders.\n' +
      '- Be concise. Plain text, short paragraphs or dashes; no markdown headers.',
    userTemplate: 'CRM context:\n{{context}}\n\nUser request: {{message}}',
  },
  {
    name: 'search.parse',
    systemTemplate:
      'You translate a natural-language CRM search query into structured search parameters. Extract only what the query actually says — never invent filters.\n\n' +
      '- entityTypes: which record types the user is asking about (account, contact, deal, project, activity, email, document, ai_summary). Empty array = search everything.\n' +
      '- keywords: 1-3 short search terms (names, companies, topics) to match against records. Strip filler words; keep proper nouns and domain terms. Do not include filter words like "won" or "big" that are captured by the filters below.\n' +
      '- status: open | won | lost when the query is about deals in that state, else null.\n' +
      '- minAmount: a number when the query implies a deal-size floor ("over $50k" → 50000), else null.\n' +
      '- timeframeDays: when the query has a recency window ("last week" → 7, "this month" → 30, "this quarter" → 90), else null.\n' +
      '- summary: one short sentence restating what you searched for, e.g. "Won deals over $50,000 mentioning Acme".',
    userTemplate: 'Search query: {{query}}',
  },
];

export async function seedPrompts(db: Db): Promise<void> {
  if (DEFAULT_PROMPTS.length === 0) return;
  await db
    .insert(aiPrompts)
    .values(
      DEFAULT_PROMPTS.map((p) => ({
        name: p.name,
        systemTemplate: p.systemTemplate,
        userTemplate: p.userTemplate,
      })),
    )
    .onConflictDoNothing({ target: aiPrompts.name });
}

export async function getPrompt(db: Db, name: string): Promise<typeof aiPrompts.$inferSelect> {
  const cached = promptCache.get(name);
  if (cached) return cached;
  const [row] = await db.select().from(aiPrompts).where(eq(aiPrompts.name, name)).limit(1);
  if (!row) throw new NotFoundError(`prompt "${name}" not found`);
  promptCache.set(name, row);
  return row;
}

export async function listPrompts(db: Db): Promise<(typeof aiPrompts.$inferSelect)[]> {
  return db.select().from(aiPrompts).orderBy(aiPrompts.name);
}

export async function updatePrompt(
  db: Db,
  name: string,
  update: { systemTemplate?: string | undefined; userTemplate?: string | undefined },
): Promise<typeof aiPrompts.$inferSelect> {
  await getPrompt(db, name);
  const [row] = await db
    .update(aiPrompts)
    .set({
      ...(update.systemTemplate !== undefined ? { systemTemplate: update.systemTemplate } : {}),
      ...(update.userTemplate !== undefined ? { userTemplate: update.userTemplate } : {}),
      version: sql`${aiPrompts.version} + 1`,
    })
    .where(eq(aiPrompts.name, name))
    .returning();
  promptCache.delete(name);
  return row!;
}

/** Render a {{var}} template; unknown or missing variables are hard errors. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new ValidationError(`prompt variable "${key}" missing`);
    return value;
  });
}

export async function renderPrompt(
  db: Db,
  name: string,
  vars: Record<string, string>,
): Promise<{ system: string; user: string; promptName: string }> {
  const prompt = await getPrompt(db, name);
  return {
    system: renderTemplate(prompt.systemTemplate, vars),
    user: renderTemplate(prompt.userTemplate, vars),
    promptName: name,
  };
}
