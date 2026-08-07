import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type {
  ActivityCreateInput,
  ActivityDto,
  ActivityLinksInput,
  ActivityLinkRef,
  ActivityQuery,
  ActivityUpdateInput,
  Paginated,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import {
  accounts,
  activities,
  activityLinks,
  contacts,
  deals,
  leads,
  projects,
  timelineEntries,
} from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { recordTimeline, type TimelineTargets } from '../timeline/service.js';
import type { AuthContext } from '../auth/service.js';

type ActivityRow = typeof activities.$inferSelect;

const typeLabels = { email: 'Email', call: 'Call', meeting: 'Meeting', note: 'Note' } as const;

export interface ResolvedLink {
  kind: 'account' | 'contact' | 'deal' | 'lead' | 'project';
  id: string;
  label: string;
}

/** Validate every referenced record exists in this org (RLS scopes the lookups). */
async function resolveLinks(tx: Tx, links: ActivityLinksInput): Promise<ResolvedLink[]> {
  const resolved: ResolvedLink[] = [];
  const check = async (
    kind: ResolvedLink['kind'],
    ids: string[] | undefined,
    fetch: (ids: string[]) => Promise<{ id: string; label: string }[]>,
  ) => {
    if (!ids || ids.length === 0) return;
    const unique = [...new Set(ids)];
    const rows = await fetch(unique);
    if (rows.length !== unique.length) {
      throw new ValidationError(`one or more linked ${kind}s do not exist in this organization`);
    }
    resolved.push(...rows.map((r) => ({ kind, ...r })));
  };

  await check('account', links.accounts, async (ids) =>
    tx
      .select({ id: accounts.id, label: accounts.name })
      .from(accounts)
      .where(and(inArray(accounts.id, ids), isNull(accounts.deletedAt))),
  );
  await check('contact', links.contacts, async (ids) =>
    (
      await tx
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts)
        .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt)))
    ).map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`.trim() })),
  );
  await check('deal', links.deals, async (ids) =>
    tx
      .select({ id: deals.id, label: deals.name })
      .from(deals)
      .where(and(inArray(deals.id, ids), isNull(deals.deletedAt))),
  );
  await check('lead', links.leads, async (ids) =>
    (
      await tx
        .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, company: leads.company })
        .from(leads)
        .where(and(inArray(leads.id, ids), isNull(leads.deletedAt)))
    ).map((l) => ({
      id: l.id,
      label: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.company || 'Lead',
    })),
  );
  await check('project', links.projects, async (ids) =>
    tx
      .select({ id: projects.id, label: projects.name })
      .from(projects)
      .where(and(inArray(projects.id, ids), isNull(projects.deletedAt))),
  );
  return resolved;
}

function linkColumn(kind: ResolvedLink['kind']) {
  return {
    account: 'accountId',
    contact: 'contactId',
    deal: 'dealId',
    lead: 'leadId',
    project: 'projectId',
  }[kind] as 'accountId' | 'contactId' | 'dealId' | 'leadId' | 'projectId';
}

async function insertLinkRows(tx: Tx, activityId: string, resolved: ResolvedLink[]): Promise<void> {
  if (resolved.length === 0) return;
  await tx.insert(activityLinks).values(
    resolved.map((link) => ({ activityId, [linkColumn(link.kind)]: link.id })),
  );
}

/**
 * Timeline rows for an activity are projections of it (one per linked record).
 * They are (re)built here — the one deliberate exception to append-only, so an
 * edited subject or occurred-at never leaves stale history behind.
 */
async function rebuildTimelineRows(
  tx: Tx,
  ctx: AuthContext,
  activity: ActivityRow,
  resolved: ResolvedLink[],
): Promise<void> {
  await tx.delete(timelineEntries).where(eq(timelineEntries.activityId, activity.id));
  for (const link of resolved) {
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: `activity.${activity.type}`,
      summary: `${typeLabels[activity.type]}: ${activity.subject}`,
      actorUserId: activity.createdBy,
      occurredAt: activity.occurredAt,
      detail: { direction: activity.direction, linkKind: link.kind },
      targets: { [linkColumn(link.kind)]: link.id } as TimelineTargets,
      activityId: activity.id,
    });
  }
}

async function loadLinkRefs(
  tx: Tx,
  activityIds: string[],
): Promise<Map<string, ActivityDto['links']>> {
  const map = new Map<string, ActivityDto['links']>();
  if (activityIds.length === 0) return map;
  const empty = (): ActivityDto['links'] => ({
    accounts: [],
    contacts: [],
    deals: [],
    leads: [],
    projects: [],
  });
  const rows = await tx
    .select({
      activityId: activityLinks.activityId,
      accountId: activityLinks.accountId,
      accountName: accounts.name,
      contactId: activityLinks.contactId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      dealId: activityLinks.dealId,
      dealName: deals.name,
      leadId: activityLinks.leadId,
      leadFirst: leads.firstName,
      leadLast: leads.lastName,
      leadCompany: leads.company,
      projectId: activityLinks.projectId,
      projectName: projects.name,
    })
    .from(activityLinks)
    .leftJoin(accounts, eq(accounts.id, activityLinks.accountId))
    .leftJoin(contacts, eq(contacts.id, activityLinks.contactId))
    .leftJoin(deals, eq(deals.id, activityLinks.dealId))
    .leftJoin(leads, eq(leads.id, activityLinks.leadId))
    .leftJoin(projects, eq(projects.id, activityLinks.projectId))
    .where(inArray(activityLinks.activityId, activityIds));

  for (const row of rows) {
    const links = map.get(row.activityId) ?? empty();
    if (row.accountId) links.accounts.push({ id: row.accountId, label: row.accountName ?? '' });
    if (row.contactId)
      links.contacts.push({ id: row.contactId, label: `${row.contactFirst ?? ''} ${row.contactLast ?? ''}`.trim() });
    if (row.dealId) links.deals.push({ id: row.dealId, label: row.dealName ?? '' });
    if (row.leadId)
      links.leads.push({
        id: row.leadId,
        label: [row.leadFirst, row.leadLast].filter(Boolean).join(' ') || row.leadCompany || 'Lead',
      });
    if (row.projectId) links.projects.push({ id: row.projectId, label: row.projectName ?? '' });
    map.set(row.activityId, links);
  }
  return map;
}

function toDto(row: ActivityRow, links: ActivityDto['links']): ActivityDto {
  return {
    id: row.id,
    type: row.type,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt.toISOString(),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    links,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function createActivity(
  db: Db,
  ctx: AuthContext,
  input: ActivityCreateInput,
): Promise<ActivityDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const resolved = await resolveLinks(tx, input.links);
    const [row] = await tx
      .insert(activities)
      .values({
        organizationId: ctx.organizationId,
        type: input.type,
        direction: input.direction ?? null,
        subject: input.subject,
        body: input.body ?? null,
        ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
        metadata: input.metadata ?? {},
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await insertLinkRows(tx, row!.id, resolved);
    await rebuildTimelineRows(tx, ctx, row!, resolved);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'activity',
      entityId: row!.id,
      changes: input as unknown as Record<string, unknown>,
    });
    const linkMap = await loadLinkRefs(tx, [row!.id]);
    return toDto(row!, linkMap.get(row!.id)!);
  });
}

export async function getActivity(db: Db, ctx: AuthContext, id: string): Promise<ActivityDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx.select().from(activities).where(eq(activities.id, id)).limit(1);
    if (!row) throw new NotFoundError('activity not found');
    const linkMap = await loadLinkRefs(tx, [id]);
    return toDto(row, linkMap.get(id) ?? { accounts: [], contacts: [], deals: [], leads: [], projects: [] });
  });
}

export async function listActivities(
  db: Db,
  ctx: AuthContext,
  query: ActivityQuery,
): Promise<Paginated<ActivityDto>> {
  const conditions: SQL[] = [isNull(activities.deletedAt)];
  if (query.type) conditions.push(eq(activities.type, query.type));
  if (query.query) {
    const pattern = `%${query.query.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(or(ilike(activities.subject, pattern), ilike(activities.body, pattern))!);
  }
  const entityFilters: [keyof ActivityQuery, AnyPgColumn][] = [
    ['accountId', activityLinks.accountId],
    ['contactId', activityLinks.contactId],
    ['dealId', activityLinks.dealId],
    ['leadId', activityLinks.leadId],
    ['projectId', activityLinks.projectId],
  ];
  for (const [key, column] of entityFilters) {
    const value = query[key];
    if (typeof value === 'string') {
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(activityLinks)
            .where(and(eq(activityLinks.activityId, activities.id), eq(column, value))),
        ),
      );
    }
  }
  const where = and(...conditions)!;
  const orderBy = query.order === 'asc' ? asc(activities.occurredAt) : desc(activities.occurredAt);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [rows, totalRow] = await Promise.all([
      tx
        .select()
        .from(activities)
        .where(where)
        .orderBy(orderBy, desc(activities.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(activities).where(where),
    ]);
    const linkMap = await loadLinkRefs(tx, rows.map((r) => r.id));
    return {
      items: rows.map((r) =>
        toDto(r, linkMap.get(r.id) ?? { accounts: [], contacts: [], deals: [], leads: [], projects: [] }),
      ),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function updateActivity(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: ActivityUpdateInput,
): Promise<ActivityDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), isNull(activities.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('activity not found');

    const patch: Partial<typeof activities.$inferInsert> = { updatedBy: ctx.userId };
    if (input.direction !== undefined) patch.direction = input.direction;
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.body !== undefined) patch.body = input.body;
    if (input.occurredAt !== undefined) patch.occurredAt = new Date(input.occurredAt);
    if (input.metadata !== undefined) patch.metadata = input.metadata;

    const [row] = await tx.update(activities).set(patch).where(eq(activities.id, id)).returning();

    let resolved: ResolvedLink[];
    if (input.links !== undefined) {
      resolved = await resolveLinks(tx, input.links);
      await tx.delete(activityLinks).where(eq(activityLinks.activityId, id));
      await insertLinkRows(tx, id, resolved);
    } else {
      const linkMap = await loadLinkRefs(tx, [id]);
      const links = linkMap.get(id) ?? { accounts: [], contacts: [], deals: [], leads: [], projects: [] };
      resolved = (
        [
          ...links.accounts.map((l) => ({ kind: 'account' as const, ...l })),
          ...links.contacts.map((l) => ({ kind: 'contact' as const, ...l })),
          ...links.deals.map((l) => ({ kind: 'deal' as const, ...l })),
          ...links.leads.map((l) => ({ kind: 'lead' as const, ...l })),
          ...links.projects.map((l) => ({ kind: 'project' as const, ...l })),
        ]
      );
    }
    await rebuildTimelineRows(tx, ctx, row!, resolved);

    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'activity',
      entityId: id,
      changes: { ...changes, ...(input.links !== undefined ? { links: { from: null, to: input.links } } : {}) },
    });

    const linkMap = await loadLinkRefs(tx, [id]);
    return toDto(row!, linkMap.get(id) ?? { accounts: [], contacts: [], deals: [], leads: [], projects: [] });
  });
}

export async function archiveActivity(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.id, id), isNull(activities.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('activity not found');
    await tx
      .update(activities)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(activities.id, id));
    // projections go with it; recreated on restore
    await tx.delete(timelineEntries).where(eq(timelineEntries.activityId, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'activity',
      entityId: id,
    });
  });
}

export async function restoreActivity(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(activities).where(eq(activities.id, id)).limit(1);
    if (!existing || !existing.deletedAt) throw new NotFoundError('archived activity not found');
    const [row] = await tx
      .update(activities)
      .set({ deletedAt: null, updatedBy: ctx.userId })
      .where(eq(activities.id, id))
      .returning();
    const linkMap = await loadLinkRefs(tx, [id]);
    const links = linkMap.get(id) ?? { accounts: [], contacts: [], deals: [], leads: [], projects: [] };
    await rebuildTimelineRows(tx, ctx, row!, [
      ...links.accounts.map((l) => ({ kind: 'account' as const, ...l })),
      ...links.contacts.map((l) => ({ kind: 'contact' as const, ...l })),
      ...links.deals.map((l) => ({ kind: 'deal' as const, ...l })),
      ...links.leads.map((l) => ({ kind: 'lead' as const, ...l })),
      ...links.projects.map((l) => ({ kind: 'project' as const, ...l })),
    ]);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'restore',
      entityType: 'activity',
      entityId: id,
    });
  });
}
