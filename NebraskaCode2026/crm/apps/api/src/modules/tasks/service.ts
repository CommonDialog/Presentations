import { and, asc, desc, eq, ilike, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { canTransition, taskTransitions } from '@crm/shared';
import type { Paginated, TaskCreateInput, TaskDto, TaskQuery, TaskUpdateInput } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, contacts, deals, leads, projects, taskDependencies, tasks } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { recordTimeline, type TimelineTargets } from '../timeline/service.js';
import { assertActiveOwner } from '../accounts/service.js';
import type { AuthContext } from '../auth/service.js';

type TaskRow = typeof tasks.$inferSelect;

function toDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    reminderAt: row.reminderAt ? row.reminderAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    assigneeId: row.assigneeId,
    accountId: row.accountId,
    contactId: row.contactId,
    dealId: row.dealId,
    leadId: row.leadId,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function taskTargets(row: TaskRow): TimelineTargets {
  return {
    accountId: row.accountId,
    contactId: row.contactId,
    dealId: row.dealId,
    leadId: row.leadId,
    projectId: row.projectId,
  };
}

function hasAnyTarget(row: TaskRow): boolean {
  return Boolean(row.accountId || row.contactId || row.dealId || row.leadId || row.projectId);
}

async function assertLinkedRecords(
  tx: Tx,
  input: {
    accountId?: string | null | undefined;
    contactId?: string | null | undefined;
    dealId?: string | null | undefined;
    leadId?: string | null | undefined;
    projectId?: string | null | undefined;
  },
): Promise<void> {
  const checks: [string, string | null | undefined, () => Promise<unknown[]>][] = [
    ['account', input.accountId, () => tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId!), isNull(accounts.deletedAt))).limit(1)],
    ['contact', input.contactId, () => tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.contactId!), isNull(contacts.deletedAt))).limit(1)],
    ['deal', input.dealId, () => tx.select({ id: deals.id }).from(deals).where(and(eq(deals.id, input.dealId!), isNull(deals.deletedAt))).limit(1)],
    ['lead', input.leadId, () => tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, input.leadId!), isNull(leads.deletedAt))).limit(1)],
    ['project', input.projectId, () => tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId!), isNull(projects.deletedAt))).limit(1)],
  ];
  for (const [kind, id, fetch] of checks) {
    if (id && (await fetch()).length === 0) {
      throw new ValidationError(`linked ${kind} does not exist in this organization`);
    }
  }
}

export async function createTask(db: Db, ctx: AuthContext, input: TaskCreateInput): Promise<TaskDto> {
  const assigneeId = input.assigneeId ?? ctx.userId;
  await assertActiveOwner(db, ctx.organizationId, assigneeId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    await assertLinkedRecords(tx, input);
    const [row] = await tx
      .insert(tasks)
      .values({
        organizationId: ctx.organizationId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'normal',
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
        assigneeId,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        leadId: input.leadId ?? null,
        projectId: input.projectId ?? null,
        milestoneId: input.milestoneId ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'task',
      entityId: row!.id,
      changes: input as unknown as Record<string, unknown>,
    });
    if (hasAnyTarget(row!)) {
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'task.created',
        summary: `Task "${row!.title}" created${row!.dueAt ? ` (due ${row!.dueAt.toLocaleDateString('en-US')})` : ''}`,
        actorUserId: ctx.userId,
        targets: taskTargets(row!),
      });
    }
    return toDto(row!);
  });
}

export async function getTask(db: Db, ctx: AuthContext, id: string): Promise<TaskDto> {
  const row = await withOrg(db, ctx.organizationId, async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return task;
  });
  if (!row) throw new NotFoundError('task not found');
  return toDto(row);
}

const sortColumns = {
  dueAt: tasks.dueAt,
  createdAt: tasks.createdAt,
  priority: tasks.priority,
} as const;

export async function listTasks(db: Db, ctx: AuthContext, query: TaskQuery): Promise<Paginated<TaskDto>> {
  const conditions: SQL[] = [isNull(tasks.deletedAt)];
  if (query.status) conditions.push(eq(tasks.status, query.status));
  if (query.open) conditions.push(inArray(tasks.status, ['open', 'in_progress']));
  if (query.assigneeId) conditions.push(eq(tasks.assigneeId, query.assigneeId));
  if (query.dueBefore) conditions.push(lte(tasks.dueAt, new Date(query.dueBefore)));
  if (query.query) conditions.push(ilike(tasks.title, `%${query.query.replace(/[%_]/g, '\\$&')}%`));
  if (query.accountId) conditions.push(eq(tasks.accountId, query.accountId));
  if (query.contactId) conditions.push(eq(tasks.contactId, query.contactId));
  if (query.dealId) conditions.push(eq(tasks.dealId, query.dealId));
  if (query.leadId) conditions.push(eq(tasks.leadId, query.leadId));
  if (query.projectId) conditions.push(eq(tasks.projectId, query.projectId));
  const where = and(...conditions)!;
  const orderCol = sortColumns[query.sort];
  const orderBy = query.order === 'asc' ? asc(orderCol) : desc(orderCol);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [items, totalRow] = await Promise.all([
      tx
        .select()
        .from(tasks)
        .where(where)
        .orderBy(sql`${orderCol} is null`, orderBy, asc(tasks.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where),
    ]);
    return {
      items: items.map(toDto),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function updateTask(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: TaskUpdateInput,
): Promise<TaskDto> {
  if (input.assigneeId) await assertActiveOwner(db, ctx.organizationId, input.assigneeId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('task not found');

    const patch: Partial<typeof tasks.$inferInsert> = { updatedBy: ctx.userId };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (input.reminderAt !== undefined) patch.reminderAt = input.reminderAt ? new Date(input.reminderAt) : null;
    if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
    if (input.accountId !== undefined) patch.accountId = input.accountId;
    if (input.contactId !== undefined) patch.contactId = input.contactId;
    if (input.dealId !== undefined) patch.dealId = input.dealId;
    if (input.leadId !== undefined) patch.leadId = input.leadId;
    if (input.projectId !== undefined) patch.projectId = input.projectId;
    if (input.milestoneId !== undefined) patch.milestoneId = input.milestoneId;

    if (input.status !== undefined && input.status !== existing.status) {
      if (!canTransition(taskTransitions, existing.status, input.status)) {
        throw new ValidationError(`a ${existing.status} task cannot become ${input.status}`);
      }
      // dependency gate (Prompt 14): a task cannot start or complete while a
      // dependency is still open
      if (input.status === 'in_progress' || input.status === 'completed') {
        const blockers = await tx
          .select({ id: tasks.id, title: tasks.title })
          .from(taskDependencies)
          .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
          .where(
            and(
              eq(taskDependencies.taskId, id),
              isNull(tasks.deletedAt),
              inArray(tasks.status, ['open', 'in_progress']),
            ),
          );
        if (blockers.length > 0) {
          throw new ValidationError(
            `task is blocked by incomplete dependencies: ${blockers.map((b) => b.title).join(', ')}`,
          );
        }
      }
      patch.status = input.status;
      patch.completedAt = input.status === 'completed' ? new Date() : null;
    }

    const merged = { ...existing, ...patch };
    if (merged.reminderAt && merged.dueAt && merged.reminderAt > merged.dueAt) {
      throw new ValidationError('reminder must not be after the due date');
    }
    await assertLinkedRecords(tx, merged);

    const [row] = await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();

    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'task',
        entityId: id,
        changes,
      });
    }
    if (input.status === 'completed' && existing.status !== 'completed' && hasAnyTarget(row!)) {
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'task.completed',
        summary: `Task "${row!.title}" completed`,
        actorUserId: ctx.userId,
        targets: taskTargets(row!),
      });
    }
    return toDto(row!);
  });
}

export async function archiveTask(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('task not found');
    await tx.update(tasks).set({ deletedAt: new Date(), updatedBy: ctx.userId }).where(eq(tasks.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'task',
      entityId: id,
    });
  });
}
