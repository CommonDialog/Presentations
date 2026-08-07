import { and, asc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { canTransition, milestoneTransitions, projectTransitions, taskStatuses } from '@crm/shared';
import type {
  GanttDto,
  MilestoneDto,
  Paginated,
  ProjectBoardDto,
  ProjectCreateInput,
  ProjectDto,
  ProjectQuery,
  ProjectTaskDto,
  ProjectUpdateInput,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import {
  accounts,
  deals,
  milestones,
  portalTokens,
  projects,
  taskDependencies,
  tasks,
} from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { assertValidCustom } from '../customization/service.js';
import { recordTimeline } from '../timeline/service.js';
import { assertActiveOwner } from '../accounts/service.js';
import type { AuthContext } from '../auth/service.js';

type ProjectRow = typeof projects.$inferSelect;
type MilestoneRow = typeof milestones.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

function toDto(row: ProjectRow, accountName: string, portalEnabled: boolean): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    accountId: row.accountId,
    accountName,
    description: row.description,
    status: row.status,
    startDate: row.startDate,
    dueDate: row.dueDate,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    ownerId: row.ownerId,
    portalEnabled,
    custom: (row.custom ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function milestoneDto(row: MilestoneRow): MilestoneDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    dueDate: row.dueDate,
    status: row.status,
    displayOrder: row.displayOrder,
  };
}

async function portalEnabledFor(tx: Tx, projectIds: string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await tx
    .select({ projectId: portalTokens.projectId })
    .from(portalTokens)
    .where(and(inArray(portalTokens.projectId, projectIds), isNull(portalTokens.revokedAt)));
  return new Set(rows.map((r) => r.projectId));
}

async function loadProject(tx: Tx, id: string): Promise<{ project: ProjectRow; accountName: string }> {
  const [row] = await tx
    .select({ project: projects, accountName: accounts.name })
    .from(projects)
    .innerJoin(accounts, eq(accounts.id, projects.accountId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!row) throw new NotFoundError('project not found');
  return row;
}

export async function getProject(db: Db, ctx: AuthContext, id: string): Promise<ProjectDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const { project, accountName } = await loadProject(tx, id);
    const portal = await portalEnabledFor(tx, [id]);
    return toDto(project, accountName, portal.has(id));
  });
}

export async function listProjects(
  db: Db,
  ctx: AuthContext,
  query: ProjectQuery,
): Promise<Paginated<ProjectDto>> {
  const conditions: SQL[] = [isNull(projects.deletedAt)];
  if (query.query) conditions.push(ilike(projects.name, `%${query.query.replace(/[%_]/g, '\\$&')}%`));
  if (query.status) conditions.push(eq(projects.status, query.status));
  if (query.accountId) conditions.push(eq(projects.accountId, query.accountId));
  const where = and(...conditions)!;

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [rows, totalRow] = await Promise.all([
      tx
        .select({ project: projects, accountName: accounts.name })
        .from(projects)
        .innerJoin(accounts, eq(accounts.id, projects.accountId))
        .where(where)
        .orderBy(asc(projects.name), asc(projects.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(projects).where(where),
    ]);
    const portal = await portalEnabledFor(tx, rows.map((r) => r.project.id));
    return {
      items: rows.map((r) => toDto(r.project, r.accountName, portal.has(r.project.id))),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

/** In-transaction creation, reused by won-deal onboarding. */
export async function insertProject(
  tx: Tx,
  ctx: AuthContext,
  input: ProjectCreateInput & { dealId?: string | undefined },
): Promise<ProjectRow> {
  const [account] = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
    .limit(1);
  if (!account) throw new ValidationError('account does not exist in this organization');
  if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
    throw new ValidationError('start date must not be after due date');
  }
  await assertValidCustom(tx, 'project', input.custom, { isCreate: true });

  const [row] = await tx
    .insert(projects)
    .values({
      organizationId: ctx.organizationId,
      accountId: input.accountId,
      name: input.name,
      custom: input.custom ?? {},
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      ownerId: input.ownerId ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  await recordAudit(tx, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'create',
    entityType: 'project',
    entityId: row!.id,
    changes: input as Record<string, unknown>,
  });
  await recordTimeline(tx, {
    organizationId: ctx.organizationId,
    entryType: 'project.created',
    summary: `Project "${row!.name}" created for ${account.name}`,
    actorUserId: ctx.userId,
    targets: { projectId: row!.id, accountId: account.id, dealId: input.dealId ?? null },
  });
  return row!;
}

export async function createProject(
  db: Db,
  ctx: AuthContext,
  input: ProjectCreateInput,
): Promise<ProjectDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);
  const row = await withOrg(db, ctx.organizationId, (tx) => insertProject(tx, ctx, input));
  return getProject(db, ctx, row.id);
}

export async function updateProject(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: ProjectUpdateInput,
): Promise<ProjectDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('project not found');

    const patch: Partial<typeof projects.$inferInsert> = { updatedBy: ctx.userId };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.custom !== undefined) {
      await assertValidCustom(tx, 'project', input.custom, { isCreate: false });
      patch.custom = input.custom;
    }

    if (input.status !== undefined && input.status !== existing.status) {
      if (!canTransition(projectTransitions, existing.status, input.status)) {
        throw new ValidationError(`a ${existing.status} project cannot become ${input.status}`);
      }
      if (input.status === 'completed' && !input.waiveMilestones) {
        const open = await tx
          .select({ id: milestones.id })
          .from(milestones)
          .where(and(eq(milestones.projectId, id), sql`${milestones.status} <> 'completed'`));
        if (open.length > 0) {
          throw new ValidationError(
            `project has ${open.length} incomplete milestone(s) — complete them or pass waiveMilestones`,
          );
        }
      }
      patch.status = input.status;
      patch.completedAt = input.status === 'completed' ? new Date() : null;
    }

    const [row] = await tx.update(projects).set(patch).where(eq(projects.id, id)).returning();
    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'project',
        entityId: id,
        changes,
      });
      const statusChanged = input.status !== undefined && input.status !== existing.status;
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: statusChanged
          ? input.status === 'completed'
            ? 'project.completed'
            : 'project.status_changed'
          : 'project.updated',
        summary: statusChanged
          ? `Project "${row!.name}" ${input.status === 'completed' ? 'completed 🎉' : `moved to ${input.status}`}`
          : `Project "${row!.name}" updated (${Object.keys(changes).join(', ')})`,
        actorUserId: ctx.userId,
        detail: { changes },
        targets: { projectId: id, accountId: row!.accountId },
      });
    }
  });
  return getProject(db, ctx, id);
}

// ---------- milestones ----------

export async function createMilestone(
  db: Db,
  ctx: AuthContext,
  projectId: string,
  input: { name: string; dueDate?: string | undefined; displayOrder?: number | undefined },
): Promise<MilestoneDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    await loadProject(tx, projectId);
    const [maxOrder] = await tx
      .select({ max: sql<number>`coalesce(max(display_order), -1)::int` })
      .from(milestones)
      .where(eq(milestones.projectId, projectId));
    const [row] = await tx
      .insert(milestones)
      .values({
        organizationId: ctx.organizationId,
        projectId,
        name: input.name,
        dueDate: input.dueDate ?? null,
        displayOrder: input.displayOrder ?? (maxOrder?.max ?? -1) + 1,
      })
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'milestone',
      entityId: row!.id,
      changes: input as Record<string, unknown>,
    });
    return milestoneDto(row!);
  });
}

export async function updateMilestone(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: {
    name?: string | undefined;
    dueDate?: string | null | undefined;
    displayOrder?: number | undefined;
    status?: MilestoneRow['status'] | undefined;
  },
): Promise<MilestoneDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(milestones).where(eq(milestones.id, id)).limit(1);
    if (!existing) throw new NotFoundError('milestone not found');

    const patch: Partial<typeof milestones.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;

    if (input.status !== undefined && input.status !== existing.status) {
      if (!canTransition(milestoneTransitions, existing.status, input.status)) {
        throw new ValidationError(`a ${existing.status} milestone cannot become ${input.status}`);
      }
      if (input.status === 'completed') {
        const open = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.milestoneId, id),
              isNull(tasks.deletedAt),
              inArray(tasks.status, ['open', 'in_progress']),
            ),
          );
        if (open.length > 0) {
          throw new ValidationError(`milestone has ${open.length} open task(s)`);
        }
      }
      patch.status = input.status;
    }

    const [row] = await tx.update(milestones).set(patch).where(eq(milestones.id, id)).returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'milestone',
      entityId: id,
      changes: input as Record<string, unknown>,
    });
    if (input.status === 'completed') {
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'project.milestone_completed',
        summary: `Milestone "${row!.name}" completed`,
        actorUserId: ctx.userId,
        targets: { projectId: row!.projectId },
      });
    }
    return milestoneDto(row!);
  });
}

export async function deleteMilestone(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(milestones).where(eq(milestones.id, id)).limit(1);
    if (!existing) throw new NotFoundError('milestone not found');
    await tx.delete(milestones).where(eq(milestones.id, id)); // tasks detach via FK set-null
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'milestone',
      entityId: id,
    });
  });
}

export async function listMilestones(db: Db, ctx: AuthContext, projectId: string): Promise<MilestoneDto[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    await loadProject(tx, projectId);
    const rows = await tx
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.displayOrder), asc(milestones.id));
    return rows.map(milestoneDto);
  });
}

// ---------- task dependencies ----------

async function projectDependencyEdges(tx: Tx, projectId: string): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(eq(tasks.projectId, projectId));
  const edges = new Map<string, string[]>();
  for (const row of rows) {
    edges.set(row.taskId, [...(edges.get(row.taskId) ?? []), row.dependsOnTaskId]);
  }
  return edges;
}

export async function addTaskDependency(
  db: Db,
  ctx: AuthContext,
  taskId: string,
  dependsOnTaskId: string,
): Promise<void> {
  if (taskId === dependsOnTaskId) throw new ValidationError('a task cannot depend on itself');
  await withOrg(db, ctx.organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(inArray(tasks.id, [taskId, dependsOnTaskId]), isNull(tasks.deletedAt)));
    const task = rows.find((r) => r.id === taskId);
    const dependency = rows.find((r) => r.id === dependsOnTaskId);
    if (!task || !dependency) throw new NotFoundError('task not found');
    if (!task.projectId || task.projectId !== dependency.projectId) {
      throw new ValidationError('dependencies must connect tasks in the same project');
    }

    // cycle check: can we reach taskId starting from dependsOnTaskId?
    const edges = await projectDependencyEdges(tx, task.projectId);
    const stack = [dependsOnTaskId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === taskId) {
        throw new ValidationError('dependency would create a cycle');
      }
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(edges.get(current) ?? []));
    }

    await tx
      .insert(taskDependencies)
      .values({ taskId, dependsOnTaskId })
      .onConflictDoNothing();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'task',
      entityId: taskId,
      changes: { addedDependency: dependsOnTaskId },
    });
  });
}

export async function removeTaskDependency(
  db: Db,
  ctx: AuthContext,
  taskId: string,
  dependsOnTaskId: string,
): Promise<void> {
  await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
        ),
      ),
  );
}

// ---------- board & gantt ----------

interface TaskWithDeps {
  row: TaskRow;
  dependsOn: string[];
  blocked: boolean;
  milestoneName: string | null;
}

async function loadProjectTasks(tx: Tx, projectId: string): Promise<TaskWithDeps[]> {
  const rows = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.createdAt), asc(tasks.id));
  const edges = await projectDependencyEdges(tx, projectId);
  const statusById = new Map(rows.map((r) => [r.id, r.status]));
  const milestoneRows = await tx.select().from(milestones).where(eq(milestones.projectId, projectId));
  const milestoneNames = new Map(milestoneRows.map((m) => [m.id, m.name]));

  return rows.map((row) => {
    const dependsOn = edges.get(row.id) ?? [];
    const blocked = dependsOn.some((depId) => {
      const status = statusById.get(depId);
      return status !== 'completed' && status !== 'canceled';
    });
    return {
      row,
      dependsOn,
      blocked,
      milestoneName: row.milestoneId ? (milestoneNames.get(row.milestoneId) ?? null) : null,
    };
  });
}

function projectTaskDto(t: TaskWithDeps): ProjectTaskDto {
  const row = t.row;
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
    dependsOn: t.dependsOn,
    blocked: t.blocked,
    milestoneName: t.milestoneName,
  };
}

export async function getProjectBoard(db: Db, ctx: AuthContext, projectId: string): Promise<ProjectBoardDto> {
  const project = await getProject(db, ctx, projectId);
  const taskDtos = await withOrg(db, ctx.organizationId, async (tx) =>
    (await loadProjectTasks(tx, projectId)).map(projectTaskDto),
  );
  return {
    project,
    columns: taskStatuses.map((status) => ({
      status,
      tasks: taskDtos.filter((t) => t.status === status),
    })),
  };
}

export async function getProjectGantt(db: Db, ctx: AuthContext, projectId: string): Promise<GanttDto> {
  const project = await getProject(db, ctx, projectId);
  const { milestoneDtos, taskDtos } = await withOrg(db, ctx.organizationId, async (tx) => {
    const milestoneRows = await tx
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.displayOrder));
    const taskList = await loadProjectTasks(tx, projectId);
    return { milestoneDtos: milestoneRows.map(milestoneDto), taskDtos: taskList };
  });

  const dates: number[] = [];
  if (project.startDate) dates.push(new Date(project.startDate).getTime());
  if (project.dueDate) dates.push(new Date(project.dueDate).getTime());
  for (const m of milestoneDtos) if (m.dueDate) dates.push(new Date(m.dueDate).getTime());
  for (const t of taskDtos) {
    dates.push(t.row.createdAt.getTime());
    if (t.row.dueAt) dates.push(t.row.dueAt.getTime());
  }
  const rangeStart = dates.length > 0 ? new Date(Math.min(...dates)) : new Date();
  const rangeEnd =
    dates.length > 0 ? new Date(Math.max(...dates)) : new Date(Date.now() + 30 * 86_400_000);

  return {
    project,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    milestones: milestoneDtos,
    tasks: taskDtos.map((t) => ({
      id: t.row.id,
      title: t.row.title,
      status: t.row.status,
      startAt: t.row.createdAt.toISOString(),
      dueAt: t.row.dueAt ? t.row.dueAt.toISOString() : null,
      milestoneId: t.row.milestoneId,
      dependsOn: t.dependsOn,
    })),
  };
}

// ---------- onboarding from a won deal ----------

const ONBOARDING_MILESTONES = [
  { name: 'Kickoff', offsetDays: 7 },
  { name: 'Implementation', offsetDays: 30 },
  { name: 'Training', offsetDays: 45 },
  { name: 'Go-live', offsetDays: 60 },
];

export async function createProjectFromDeal(
  db: Db,
  ctx: AuthContext,
  dealId: string,
  name?: string,
): Promise<ProjectDto> {
  const projectId = await withOrg(db, ctx.organizationId, async (tx) => {
    const [deal] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), isNull(deals.deletedAt)))
      .limit(1);
    if (!deal) throw new NotFoundError('deal not found');
    if (deal.status !== 'won') throw new ValidationError('onboarding projects start from won deals');

    const today = Date.now();
    const iso = (offsetDays: number) => new Date(today + offsetDays * 86_400_000).toISOString().slice(0, 10);
    const project = await insertProject(tx, ctx, {
      name: name ?? `${deal.name} — onboarding`,
      accountId: deal.accountId,
      startDate: iso(0),
      dueDate: iso(60),
      ...(deal.ownerId ? { ownerId: deal.ownerId } : {}),
      dealId,
    });
    await tx.insert(milestones).values(
      ONBOARDING_MILESTONES.map((m, i) => ({
        organizationId: ctx.organizationId,
        projectId: project.id,
        name: m.name,
        dueDate: iso(m.offsetDays),
        displayOrder: i,
      })),
    );
    return project.id;
  });
  return getProject(db, ctx, projectId);
}
