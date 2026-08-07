import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PortalViewDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, milestones, portalTokens, projects, tasks } from '../../db/schema/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import type { AuthContext } from '../auth/service.js';

/** Enable (or rotate) the customer portal link for a project. */
export async function enablePortal(
  db: Db,
  ctx: AuthContext,
  projectId: string,
): Promise<{ token: string }> {
  // verify project visibility inside the tenant first
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new NotFoundError('project not found');
  });

  const token = randomBytes(24).toString('base64url');
  // portal_tokens is outside RLS (capability table) — plain queries
  await db
    .update(portalTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(portalTokens.projectId, projectId), isNull(portalTokens.revokedAt)));
  await db.insert(portalTokens).values({ token, organizationId: ctx.organizationId, projectId });
  return { token };
}

export async function disablePortal(db: Db, ctx: AuthContext, projectId: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundError('project not found');
  });
  await db
    .update(portalTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(portalTokens.projectId, projectId), isNull(portalTokens.revokedAt)));
}

/**
 * Public, unauthenticated read view. The token is the capability: it resolves
 * the organization, and everything after runs under normal RLS. Only
 * customer-safe fields leave this function.
 */
export async function getPortalView(db: Db, token: string): Promise<PortalViewDto> {
  const [grant] = await db
    .select()
    .from(portalTokens)
    .where(and(eq(portalTokens.token, token), isNull(portalTokens.revokedAt)))
    .limit(1);
  if (!grant) throw new NotFoundError('portal link not found or revoked');

  return withOrg(db, grant.organizationId, async (tx) => {
    const [row] = await tx
      .select({ project: projects, accountName: accounts.name })
      .from(projects)
      .innerJoin(accounts, eq(accounts.id, projects.accountId))
      .where(and(eq(projects.id, grant.projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundError('portal link not found or revoked');
    // portal visibility rule from the domain model
    if (!['active', 'on_hold', 'completed'].includes(row.project.status)) {
      throw new NotFoundError('portal link not found or revoked');
    }

    const milestoneRows = await tx
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, grant.projectId))
      .orderBy(milestones.displayOrder);
    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, grant.projectId), isNull(tasks.deletedAt)));

    return {
      projectName: row.project.name,
      accountName: row.accountName,
      status: row.project.status,
      startDate: row.project.startDate,
      dueDate: row.project.dueDate,
      milestones: milestoneRows.map((m) => ({
        name: m.name,
        status: m.status,
        dueDate: m.dueDate,
      })),
      taskCounts: { total: counts?.total ?? 0, completed: counts?.completed ?? 0 },
    };
  });
}
