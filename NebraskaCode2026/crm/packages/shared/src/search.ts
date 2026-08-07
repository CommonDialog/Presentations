import { z } from 'zod';

export const searchEntityTypes = [
  'account',
  'contact',
  'deal',
  'project',
  'activity',
  'email',
  'document',
  'ai_summary',
] as const;
export type SearchEntityType = (typeof searchEntityTypes)[number];

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  /** Comma-separated subset of searchEntityTypes; omitted = all. */
  types: z.string().optional(),
  /** Max results per entity type. */
  limit: z.coerce.number().int().min(1).max(25).default(5),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface SearchResultDto {
  type: SearchEntityType;
  id: string;
  title: string;
  /** Matched text around the hit, when the match was in body content. */
  snippet: string | null;
  /** Web route to open the result (or its closest linked record). */
  url: string | null;
  /** Short human context line, e.g. "$60,000 · open" or "inbound email". */
  meta: string | null;
  updatedAt: string;
}

export interface SearchResponseDto {
  query: string;
  results: SearchResultDto[];
  totalsByType: Partial<Record<SearchEntityType, number>>;
}

export const nlSearchInputSchema = z.object({
  query: z.string().trim().min(2).max(500),
});
export type NlSearchInput = z.infer<typeof nlSearchInputSchema>;

/** What the AI understood from the natural-language query. */
export interface NlSearchInterpretation {
  entityTypes: SearchEntityType[];
  keywords: string[];
  status: 'open' | 'won' | 'lost' | null;
  minAmount: number | null;
  timeframeDays: number | null;
  summary: string;
  /** True when AI parsing was unavailable and keywords fell back to the raw query. */
  fallback: boolean;
}

export interface SemanticHitDto {
  entityType: string;
  entityId: string;
  content: string;
  score: number;
}

export interface NlSearchResponseDto {
  query: string;
  interpretation: NlSearchInterpretation;
  results: SearchResultDto[];
  /** Embedding-similarity hits over captured knowledge, when available. */
  related: SemanticHitDto[];
}
