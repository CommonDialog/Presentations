import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { rolePermissions, roles, userRoles, users } from '../../db/schema/index.js';
import { withOrg } from '../../lib/tenant.js';
import { hashPassword } from '../../lib/password.js';
import { recordAudit } from '../audit/service.js';
import { revokeSessions, type AuthContext } from '../auth/service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { PERMISSIONS, type PermissionCode } from '../auth/permissions.js';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: { id: string; name: string }[];
}

export async function listUsers(db: Db, organizationId: string): Promise<UserSummary[]> {
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.organizationId, organizationId))
    .orderBy(users.name);

  const roleRows = await withOrg(db, organizationId, (tx) =>
    tx
      .select({ userId: userRoles.userId, roleId: roles.id, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId)),
  );

  const byUser = new Map<string, { id: string; name: string }[]>();
  for (const r of roleRows) {
    const list = byUser.get(r.userId) ?? [];
    list.push({ id: r.roleId, name: r.roleName });
    byUser.set(r.userId, list);
  }
  return userRows.map((u) => ({ ...u, roles: byUser.get(u.id) ?? [] }));
}

async function assertRolesInOrg(db: Db, organizationId: string, roleIds: string[]): Promise<void> {
  const found = await withOrg(db, organizationId, (tx) =>
    tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds)),
  );
  if (found.length !== new Set(roleIds).size) {
    throw new ValidationError('one or more roles do not exist in this organization');
  }
}

export async function createUser(
  db: Db,
  ctx: AuthContext,
  input: { name: string; email: string; password: string; roleIds: string[] },
): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) throw new ConflictError('email already registered');

  await assertRolesInOrg(db, ctx.organizationId, input.roleIds);
  const passwordHash = await hashPassword(input.password);

  const [user] = await db
    .insert(users)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
    })
    .returning({ id: users.id });

  await withOrg(db, ctx.organizationId, async (tx) => {
    await tx.insert(userRoles).values(input.roleIds.map((roleId) => ({ userId: user!.id, roleId })));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'user',
      entityId: user!.id,
      changes: { name: input.name, email: input.email, roleIds: input.roleIds },
    });
  });
  return user!.id;
}

/** Would this update leave the organization without an active Admin? */
async function assertNotLastAdmin(
  db: Db,
  organizationId: string,
  targetUserId: string,
  update: { isActive?: boolean | undefined; roleIds?: string[] | undefined },
): Promise<void> {
  const [adminRole] = await withOrg(db, organizationId, (tx) =>
    tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.name, 'Admin'), eq(roles.isSystem, true)))
      .limit(1),
  );
  if (!adminRole) return;

  const targetIsAdmin = await withOrg(db, organizationId, (tx) =>
    tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.roleId, adminRole.id), eq(userRoles.userId, targetUserId)))
      .limit(1),
  );
  if (targetIsAdmin.length === 0) return;

  const losesAdmin =
    update.isActive === false || (update.roleIds !== undefined && !update.roleIds.includes(adminRole.id));
  if (!losesAdmin) return;

  const otherAdmins = await withOrg(db, organizationId, (tx) =>
    tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(userRoles.roleId, adminRole.id),
          ne(userRoles.userId, targetUserId),
          eq(users.isActive, true),
        ),
      ),
  );
  if (otherAdmins.length === 0) {
    throw new ValidationError('organization must retain at least one active Admin');
  }
}

export async function updateUser(
  db: Db,
  ctx: AuthContext,
  targetUserId: string,
  update: { name?: string | undefined; isActive?: boolean | undefined; roleIds?: string[] | undefined },
): Promise<void> {
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.organizationId, ctx.organizationId)))
    .limit(1);
  if (!target) throw new NotFoundError('user not found');

  if (update.roleIds !== undefined) {
    if (update.roleIds.length === 0) throw new ValidationError('user needs at least one role');
    await assertRolesInOrg(db, ctx.organizationId, update.roleIds);
  }
  await assertNotLastAdmin(db, ctx.organizationId, targetUserId, update);

  if (update.name !== undefined || update.isActive !== undefined) {
    await db
      .update(users)
      .set({
        ...(update.name !== undefined ? { name: update.name } : {}),
        ...(update.isActive !== undefined ? { isActive: update.isActive } : {}),
      })
      .where(eq(users.id, targetUserId));
  }

  await withOrg(db, ctx.organizationId, async (tx) => {
    if (update.roleIds !== undefined) {
      await tx.delete(userRoles).where(eq(userRoles.userId, targetUserId));
      await tx
        .insert(userRoles)
        .values(update.roleIds.map((roleId) => ({ userId: targetUserId, roleId })));
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'user',
      entityId: targetUserId,
      changes: update as Record<string, unknown>,
    });
  });

  if (update.isActive === false) await revokeSessions(db, [targetUserId]);
}

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export async function listRoles(db: Db, organizationId: string): Promise<RoleSummary[]> {
  return withOrg(db, organizationId, async (tx) => {
    const roleRows = await tx
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .orderBy(roles.name);
    const permRows = await tx
      .select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode })
      .from(rolePermissions);
    const byRole = new Map<string, string[]>();
    for (const p of permRows) {
      const list = byRole.get(p.roleId) ?? [];
      list.push(p.code);
      byRole.set(p.roleId, list);
    }
    return roleRows.map((r) => ({ ...r, permissions: (byRole.get(r.id) ?? []).sort() }));
  });
}

export async function createRole(
  db: Db,
  ctx: AuthContext,
  input: { name: string; description?: string | undefined; permissionCodes: string[] },
): Promise<string> {
  const invalid = input.permissionCodes.filter((c) => !(c in PERMISSIONS));
  if (invalid.length > 0) throw new ValidationError(`unknown permissions: ${invalid.join(', ')}`);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, input.name))
      .limit(1);
    if (existing) throw new ConflictError('role name already exists');

    const [role] = await tx
      .insert(roles)
      .values({
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      })
      .returning({ id: roles.id });
    await tx.insert(rolePermissions).values(
      [...new Set(input.permissionCodes)].map((code) => ({
        roleId: role!.id,
        permissionCode: code as PermissionCode,
      })),
    );
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'role',
      entityId: role!.id,
      changes: input as unknown as Record<string, unknown>,
    });
    return role!.id;
  });
}
