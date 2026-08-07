import { desc, eq, sql, and, type SQL } from 'drizzle-orm';
import type { Paginated, TimelineEntryDto } from '@crm/shared';
import { timelineEntries } from '../../db/schema/index.js';
import type { DbLike, Tx } from '../../lib/tenant.js';

export interface TimelineTargets {
  accountId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  projectId?: string | null;
}

export interface TimelineRecord {
  organizationId: string;
  entryType: string;
  summary: string;
  actorUserId?: string | null;
  occurredAt?: Date;
  detail?: Record<string, unknown>;
  targets: TimelineTargets;
  activityId?: string | null;
  documentId?: string | null;
  aiArtifactId?: string | null;
}

/**
 * The single write path for timeline entries (docs/03 cross-entity rule 3).
 * One row may target several records — it appears in each record's timeline.
 */
export async function recordTimeline(tx: DbLike, entry: TimelineRecord): Promise<void> {
  await tx.insert(timelineEntries).values({
    organizationId: entry.organizationId,
    entryType: entry.entryType,
    summary: entry.summary,
    actorUserId: entry.actorUserId ?? null,
    ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    detail: entry.detail ?? {},
    accountId: entry.targets.accountId ?? null,
    contactId: entry.targets.contactId ?? null,
    dealId: entry.targets.dealId ?? null,
    leadId: entry.targets.leadId ?? null,
    projectId: entry.targets.projectId ?? null,
    activityId: entry.activityId ?? null,
    documentId: entry.documentId ?? null,
    aiArtifactId: entry.aiArtifactId ?? null,
  });
}

/** The org-wide feed: one chronological stream across every record. */
export async function getOrgTimeline(
  tx: Tx,
  page: number,
  pageSize: number,
): Promise<Paginated<TimelineEntryDto>> {
  const [items, totalRow] = await Promise.all([
    tx
      .select({
        id: timelineEntries.id,
        entryType: timelineEntries.entryType,
        occurredAt: timelineEntries.occurredAt,
        actorUserId: timelineEntries.actorUserId,
        summary: timelineEntries.summary,
        detail: timelineEntries.detail,
      })
      .from(timelineEntries)
      .orderBy(desc(timelineEntries.occurredAt), desc(timelineEntries.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    tx.select({ count: sql<number>`count(*)::int` }).from(timelineEntries),
  ]);
  return {
    items: items.map((i) => ({
      ...i,
      occurredAt: i.occurredAt.toISOString(),
      detail: (i.detail ?? {}) as Record<string, unknown>,
    })),
    total: totalRow[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export type TimelineTargetKind = 'account' | 'contact' | 'deal' | 'lead' | 'project';

const targetColumn = {
  account: timelineEntries.accountId,
  contact: timelineEntries.contactId,
  deal: timelineEntries.dealId,
  lead: timelineEntries.leadId,
  project: timelineEntries.projectId,
} as const;

export async function getTimeline(
  tx: Tx,
  kind: TimelineTargetKind,
  id: string,
  page: number,
  pageSize: number,
): Promise<Paginated<TimelineEntryDto>> {
  const where: SQL = and(eq(targetColumn[kind], id))!;
  const [items, totalRow] = await Promise.all([
    tx
      .select({
        id: timelineEntries.id,
        entryType: timelineEntries.entryType,
        occurredAt: timelineEntries.occurredAt,
        actorUserId: timelineEntries.actorUserId,
        summary: timelineEntries.summary,
        detail: timelineEntries.detail,
      })
      .from(timelineEntries)
      .where(where)
      .orderBy(desc(timelineEntries.occurredAt), desc(timelineEntries.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(timelineEntries)
      .where(where),
  ]);
  return {
    items: items.map((i) => ({
      ...i,
      occurredAt: i.occurredAt.toISOString(),
      detail: (i.detail ?? {}) as Record<string, unknown>,
    })),
    total: totalRow[0]?.count ?? 0,
    page,
    pageSize,
  };
}
