import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { RegisterInput, LoginInput } from '@crm/shared';
import type { Db } from '../../db/client.js';
import {
  organizations,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from '../../db/schema/index.js';
import { ConflictError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { withOrg } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { seedDefaultPipeline } from '../pipelines/service.js';
import { ALL_PERMISSION_CODES, PERMISSIONS, SYSTEM_ROLES } from './permissions.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Context for background workers acting on behalf of a user, outside a request. */
export function systemContext(organizationId: string, userId: string): AuthContext {
  return {
    userId,
    userName: 'system',
    email: 'system@internal',
    organizationId,
    organizationName: '',
    organizationSlug: '',
    permissions: new Set(),
  };
}

export interface AuthContext {
  userId: string;
  userName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  permissions: ReadonlySet<string>;
}

/** Idempotent: upserts the permission catalog. Runs at boot. */
export async function seedPermissions(db: Db): Promise<void> {
  await db
    .insert(permissions)
    .values(ALL_PERMISSION_CODES.map((code) => ({ code, description: PERMISSIONS[code] })))
    .onConflictDoUpdate({
      target: permissions.code,
      set: { description: sql`excluded.description` },
    });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'org';
}

export async function registerOrganization(
  db: Db,
  input: RegisterInput,
): Promise<{ userId: string; organizationId: string; sessionId: string }> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email))
    .limit(1);
  if (existing.length > 0) throw new ConflictError('email already registered');

  // Organization + slug uniqueness (retry with numeric suffix).
  const base = slugify(input.organizationName);
  let org: { id: string } | undefined;
  for (let attempt = 0; attempt < 20 && !org; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const inserted = await db
      .insert(organizations)
      .values({ name: input.organizationName, slug })
      .onConflictDoNothing({ target: organizations.slug })
      .returning({ id: organizations.id });
    org = inserted[0];
  }
  if (!org) throw new ConflictError('could not allocate organization slug');
  const organizationId = org.id;

  const passwordHash = await hashPassword(input.password);

  const userId = await withOrg(db, organizationId, async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ organizationId, email: input.email, name: input.name, passwordHash })
      .returning({ id: users.id });

    let adminRoleId: string | undefined;
    for (const template of SYSTEM_ROLES) {
      const [role] = await tx
        .insert(roles)
        .values({
          organizationId,
          name: template.name,
          description: template.description,
          isSystem: true,
        })
        .returning({ id: roles.id });
      await tx
        .insert(rolePermissions)
        .values(template.permissions.map((code) => ({ roleId: role!.id, permissionCode: code })));
      if (template.name === 'Admin') adminRoleId = role!.id;
    }
    await tx.insert(userRoles).values({ userId: user!.id, roleId: adminRoleId! });

    await seedDefaultPipeline(tx, organizationId);

    await recordAudit(tx, {
      organizationId,
      userId: user!.id,
      action: 'create',
      entityType: 'organization',
      entityId: organizationId,
      changes: { name: input.organizationName },
    });
    return user!.id;
  });

  const sessionId = await createSession(db, userId);
  return { userId, organizationId, sessionId };
}

async function createSession(db: Db, userId: string): Promise<string> {
  const [session] = await db
    .insert(sessions)
    .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .returning({ id: sessions.id });
  return session!.id;
}

export async function login(
  db: Db,
  input: LoginInput,
): Promise<{ sessionId: string; userId: string } | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email))
    .limit(1);

  if (!user || !user.isActive) return null;

  const ok = await verifyPassword(input.password, user.passwordHash);
  await withOrg(db, user.organizationId, (tx) =>
    recordAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: ok ? 'login' : 'login_failed',
      entityType: 'user',
      entityId: user.id,
    }),
  );
  if (!ok) return null;

  const sessionId = await createSession(db, user.id);
  return { sessionId, userId: user.id };
}

export async function logout(db: Db, sessionId: string, ctx: AuthContext): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await withOrg(db, ctx.organizationId, (tx) =>
    recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'logout',
      entityType: 'user',
      entityId: ctx.userId,
    }),
  );
}

export async function getAuthContext(db: Db, sessionId: string): Promise<AuthContext | null> {
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      email: users.email,
      isActive: users.isActive,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;

  const permissionRows = await withOrg(db, row.organizationId, (tx) =>
    tx
      .selectDistinct({ code: rolePermissions.permissionCode })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .where(eq(userRoles.userId, row.userId)),
  );

  return {
    userId: row.userId,
    userName: row.userName,
    email: row.email,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    permissions: new Set(permissionRows.map((p) => p.code)),
  };
}

/** Revoke every session for a user (deactivation, password change). */
export async function revokeSessions(db: Db, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.delete(sessions).where(inArray(sessions.userId, userIds));
}
