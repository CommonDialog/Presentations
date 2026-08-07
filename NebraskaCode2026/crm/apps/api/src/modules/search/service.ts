import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  searchEntityTypes,
  type NlSearchInterpretation,
  type NlSearchResponseDto,
  type SearchEntityType,
  type SearchResponseDto,
  type SearchResultDto,
  type SemanticHitDto,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import type { AiService } from '../../ai/service.js';
import { renderPrompt } from '../../ai/prompts.js';
import { searchSimilar } from '../../ai/embeddings.js';
import type { AuthContext } from '../auth/service.js';

// Search is read-only SQL over live rows (ILIKE at demo scale; the upgrade
// path is tsvector/pgvector without changing the API shape). RLS scopes
// every query to the caller's organization.

type Row = Record<string, unknown>;

interface SearchFilters {
  status?: 'open' | 'won' | 'lost' | undefined;
  minAmount?: number | undefined;
  timeframeDays?: number | undefined;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

/** ~120 chars of body centered on the first case-insensitive match. */
function snippetAround(body: string | null, term: string): string | null {
  if (!body) return null;
  const idx = body.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return body.length > 120 ? `${body.slice(0, 120)}…` : body;
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + term.length + 80);
  return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ')}${end < body.length ? '…' : ''}`;
}

/** Route to the record itself, or the closest linked record for content types. */
function linkUrl(r: Row): string | null {
  if (r.deal_id) return `/deals/${String(r.deal_id)}`;
  if (r.account_id) return `/accounts/${String(r.account_id)}`;
  if (r.contact_id) return `/contacts/${String(r.contact_id)}`;
  if (r.project_id) return `/projects/${String(r.project_id)}`;
  if (r.lead_id) return `/leads/${String(r.lead_id)}`;
  return null;
}

function money(value: unknown): string {
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

type TypeSearcher = (tx: Tx, pattern: string, term: string, limit: number, filters: SearchFilters) => Promise<SearchResultDto[]>;

const searchers: Record<SearchEntityType, TypeSearcher> = {
  account: async (tx, pattern, _term, limit) => {
    const { rows } = await tx.execute(sql`
      select a.id, a.name, a.industry, a.domain, a.updated_at
      from accounts a
      where a.deleted_at is null
        and (a.name ilike ${pattern} or a.domain ilike ${pattern} or a.industry ilike ${pattern})
      order by (a.name ilike ${pattern}) desc, a.updated_at desc
      limit ${limit}`);
    return (rows as Row[]).map((r) => ({
      type: 'account' as const,
      id: String(r.id),
      title: String(r.name),
      snippet: null,
      url: `/accounts/${String(r.id)}`,
      meta: [r.industry, r.domain].filter(Boolean).join(' · ') || null,
      updatedAt: iso(r.updated_at),
    }));
  },

  contact: async (tx, pattern, _term, limit) => {
    const { rows } = await tx.execute(sql`
      select c.id, c.first_name, c.last_name, c.email, c.title, c.updated_at, a.name as account_name
      from contacts c
      left join accounts a on a.id = c.account_id
      where c.deleted_at is null
        and ((c.first_name || ' ' || c.last_name) ilike ${pattern}
          or c.email ilike ${pattern} or c.title ilike ${pattern})
      order by c.updated_at desc
      limit ${limit}`);
    return (rows as Row[]).map((r) => ({
      type: 'contact' as const,
      id: String(r.id),
      title: `${String(r.first_name)} ${String(r.last_name)}`.trim(),
      snippet: null,
      url: `/contacts/${String(r.id)}`,
      meta: [r.title, r.account_name, r.email].filter(Boolean).join(' · ') || null,
      updatedAt: iso(r.updated_at),
    }));
  },

  deal: async (tx, pattern, _term, limit, filters) => {
    const statusFilter: SQL = filters.status ? sql`and d.status = ${filters.status}` : sql``;
    const amountFilter: SQL =
      filters.minAmount !== undefined ? sql`and d.amount >= ${filters.minAmount}` : sql``;
    const { rows } = await tx.execute(sql`
      select d.id, d.name, d.status, d.amount, d.updated_at, a.name as account_name, s.name as stage_name
      from deals d
      join accounts a on a.id = d.account_id
      join pipeline_stages s on s.id = d.stage_id
      where d.deleted_at is null and (d.name ilike ${pattern} or a.name ilike ${pattern})
        ${statusFilter} ${amountFilter}
      order by d.updated_at desc
      limit ${limit}`);
    return (rows as Row[]).map((r) => ({
      type: 'deal' as const,
      id: String(r.id),
      title: String(r.name),
      snippet: null,
      url: `/deals/${String(r.id)}`,
      meta: [
        r.amount === null ? null : money(r.amount),
        String(r.stage_name),
        String(r.status),
        String(r.account_name),
      ]
        .filter(Boolean)
        .join(' · '),
      updatedAt: iso(r.updated_at),
    }));
  },

  project: async (tx, pattern, term, limit) => {
    const { rows } = await tx.execute(sql`
      select p.id, p.name, p.status, p.description, p.updated_at, a.name as account_name
      from projects p
      join accounts a on a.id = p.account_id
      where p.deleted_at is null and (p.name ilike ${pattern} or p.description ilike ${pattern})
      order by p.updated_at desc
      limit ${limit}`);
    return (rows as Row[]).map((r) => ({
      type: 'project' as const,
      id: String(r.id),
      title: String(r.name),
      snippet: r.description ? snippetAround(String(r.description), term) : null,
      url: `/projects/${String(r.id)}`,
      meta: `${String(r.status)} · ${String(r.account_name)}`,
      updatedAt: iso(r.updated_at),
    }));
  },

  activity: (tx, pattern, term, limit, filters) =>
    activitySearch(tx, pattern, term, limit, filters, false),

  email: (tx, pattern, term, limit, filters) =>
    activitySearch(tx, pattern, term, limit, filters, true),

  document: async (tx, pattern, _term, limit) => {
    const { rows } = await tx.execute(sql`
      select d.id, d.name, d.mime_type, d.updated_at,
             d.account_id, d.contact_id, d.deal_id, d.project_id
      from documents d
      where d.deleted_at is null and d.name ilike ${pattern}
      order by d.updated_at desc
      limit ${limit}`);
    return (rows as Row[]).map((r) => ({
      type: 'document' as const,
      id: String(r.id),
      title: String(r.name),
      snippet: null,
      url: linkUrl(r),
      meta: String(r.mime_type),
      updatedAt: iso(r.updated_at),
    }));
  },

  ai_summary: async (tx, pattern, term, limit) => {
    const { rows } = await tx.execute(sql`
      select ar.id, ar.title, ar.kind, ar.updated_at,
             ar.payload->>'summary' as summary_text,
             ar.account_id, ar.contact_id, ar.deal_id, ar.project_id, ar.lead_id
      from ai_artifacts ar
      where ar.kind in ('summary', 'insight') and ar.status in ('approved', 'applied')
        and (ar.title ilike ${pattern} or ar.payload::text ilike ${pattern})
      order by ar.updated_at desc
      limit ${limit}`);
    return (rows as Row[]).map((r) => ({
      type: 'ai_summary' as const,
      id: String(r.id),
      title: String(r.title),
      snippet: r.summary_text ? snippetAround(String(r.summary_text), term) : null,
      url: linkUrl(r) ?? '/approvals',
      meta: `AI ${String(r.kind)}`,
      updatedAt: iso(r.updated_at),
    }));
  },
};

async function activitySearch(
  tx: Tx,
  pattern: string,
  term: string,
  limit: number,
  filters: SearchFilters,
  emailsOnly: boolean,
): Promise<SearchResultDto[]> {
  const typeFilter: SQL = emailsOnly ? sql`and a.type = 'email'` : sql`and a.type <> 'email'`;
  const timeFilter: SQL =
    filters.timeframeDays !== undefined
      ? sql`and a.occurred_at >= now() - make_interval(days => ${filters.timeframeDays})`
      : sql``;
  const { rows } = await tx.execute(sql`
    select a.id, a.subject, a.type, a.direction, left(a.body, 500) as body, a.updated_at,
           a.metadata->>'counterpartEmail' as counterpart,
           l.deal_id, l.account_id, l.contact_id, l.project_id, l.lead_id
    from activities a
    left join lateral (
      select al.deal_id, al.account_id, al.contact_id, al.project_id, al.lead_id
      from activity_links al
      where al.activity_id = a.id
      order by al.deal_id is null, al.account_id is null, al.contact_id is null
      limit 1
    ) l on true
    where a.deleted_at is null ${typeFilter} ${timeFilter}
      and (a.subject ilike ${pattern} or a.body ilike ${pattern})
    order by a.occurred_at desc
    limit ${limit}`);
  return (rows as Row[]).map((r) => ({
    type: (emailsOnly ? 'email' : 'activity') as SearchEntityType,
    id: String(r.id),
    title: String(r.subject),
    snippet: snippetAround(r.body === null ? null : String(r.body), term),
    url: linkUrl(r),
    meta: emailsOnly
      ? [r.direction, r.counterpart].filter(Boolean).join(' · ') || 'email'
      : String(r.type),
    updatedAt: iso(r.updated_at),
  }));
}

/** Types the caller's permissions allow them to search. */
export function permittedTypes(ctx: AuthContext): SearchEntityType[] {
  const required: Record<SearchEntityType, string> = {
    account: 'accounts:read',
    contact: 'contacts:read',
    deal: 'deals:read',
    project: 'projects:read',
    activity: 'activities:read',
    email: 'activities:read',
    document: 'documents:read',
    ai_summary: 'ai:use',
  };
  return searchEntityTypes.filter((t) => ctx.permissions.has(required[t]));
}

function parseTypes(types: string | undefined, allowed: SearchEntityType[]): SearchEntityType[] {
  if (!types) return allowed;
  const requested = types
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is SearchEntityType => (searchEntityTypes as readonly string[]).includes(t))
    .filter((t) => allowed.includes(t));
  return requested.length > 0 ? requested : allowed;
}

export async function globalSearch(
  db: Db,
  ctx: AuthContext,
  params: { q: string; types?: string | undefined; limit: number; filters?: SearchFilters },
): Promise<SearchResponseDto> {
  const term = params.q.trim();
  const pattern = `%${escapeLike(term)}%`;
  const types = parseTypes(params.types, permittedTypes(ctx));
  const filters = params.filters ?? {};

  const results = await withOrg(db, ctx.organizationId, async (tx) => {
    const all: SearchResultDto[] = [];
    for (const type of types) {
      all.push(...(await searchers[type](tx, pattern, term, params.limit, filters)));
    }
    return all;
  });

  const totalsByType: Partial<Record<SearchEntityType, number>> = {};
  for (const r of results) totalsByType[r.type] = (totalsByType[r.type] ?? 0) + 1;
  return { query: term, results, totalsByType };
}

// What the LLM extracts from a natural-language query. Arrays default to
// empty and scalars to null, so the dev fake provider's synthesized output
// degrades to a plain keyword search instead of erroring.
const nlParseSchema = z.object({
  entityTypes: z.array(z.enum(searchEntityTypes)),
  keywords: z.array(z.string()),
  status: z.enum(['open', 'won', 'lost']).nullable(),
  minAmount: z.number().nullable(),
  timeframeDays: z.number().int().min(1).max(365).nullable(),
  summary: z.string(),
});

export async function nlSearch(
  db: Db,
  ai: AiService,
  ctx: AuthContext,
  query: string,
): Promise<NlSearchResponseDto> {
  let interpretation: NlSearchInterpretation;
  try {
    const prompt = await renderPrompt(db, 'search.parse', { query });
    const { output } = await ai.completeStructured(
      { organizationId: ctx.organizationId, purpose: 'search.parse', promptName: prompt.promptName },
      { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], schema: nlParseSchema },
    );
    interpretation = { ...output, fallback: false };
  } catch {
    interpretation = {
      entityTypes: [],
      keywords: [],
      status: null,
      minAmount: null,
      timeframeDays: null,
      summary: 'AI parsing unavailable — ran a keyword search instead.',
      fallback: true,
    };
  }

  const keywords = interpretation.keywords.map((k) => k.trim()).filter((k) => k.length > 1);
  const effectiveKeywords = keywords.length > 0 ? keywords.slice(0, 3) : [query];
  const types =
    interpretation.entityTypes.length > 0 ? interpretation.entityTypes.join(',') : undefined;

  const merged = new Map<string, SearchResultDto>();
  for (const keyword of effectiveKeywords) {
    const { results } = await globalSearch(db, ctx, {
      q: keyword,
      types,
      limit: 5,
      filters: {
        status: interpretation.status ?? undefined,
        minAmount: interpretation.minAmount ?? undefined,
        timeframeDays: interpretation.timeframeDays ?? undefined,
      },
    });
    for (const result of results) merged.set(`${result.type}:${result.id}`, result);
  }

  // Semantic layer over captured-knowledge embeddings, when any exist.
  let related: SemanticHitDto[] = [];
  try {
    related = await searchSimilar(db, ai, {
      organizationId: ctx.organizationId,
      query,
      limit: 5,
    });
  } catch {
    // embeddings unavailable — structured results stand alone
  }

  return {
    query,
    interpretation,
    results: [...merged.values()],
    related,
  };
}
