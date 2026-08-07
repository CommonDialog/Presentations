import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { ApiKeyDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { apiKeys, organizations, rolePermissions, userRoles, users } from '../../db/schema/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import type { AuthContext } from '../auth/service.js';

const TOKEN_PREFIX = 'crm_';

// last lastUsedAt write per key id, for throttling
const stampTimes = new Map<string, number>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toDto(row: typeof apiKeys.$inferSelect): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(db: Db, ctx: AuthContext): Promise<ApiKeyDto[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, ctx.organizationId))
    .orderBy(apiKeys.createdAt);
  return rows.map(toDto);
}

/** The full token is returned exactly once, at creation. */
export async function createApiKey(
  db: Db,
  ctx: AuthContext,
  name: string,
): Promise<{ key: ApiKeyDto; token: string }> {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      name,
      prefix: token.slice(0, 10),
      tokenHash: hashToken(token),
    })
    .returning();
  return { key: toDto(row!), token };
}

export async function revokeApiKey(db: Db, ctx: AuthContext, id: string): Promise<void> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, ctx.organizationId)))
    .returning({ id: apiKeys.id });
  if (!row) throw new NotFoundError('API key not found');
}

/**
 * Bearer-token authentication for the REST API. The key acts as the creating
 * user: same identity, same permissions. Like session lookup, this runs
 * before any tenant context exists.
 */
export async function getAuthContextForApiKey(db: Db, token: string): Promise<AuthContext | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const rows = await db
    .select({
      keyId: apiKeys.id,
      userId: users.id,
      userName: users.name,
      email: users.email,
      isActive: users.isActive,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(apiKeys.tokenHash, hashToken(token)), isNull(apiKeys.revokedAt)))
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

  // fire-and-forget usage stamp, throttled: at most one write per key per
  // minute so heavy API traffic doesn't turn every read into a write
  const lastStamp = stampTimes.get(row.keyId) ?? 0;
  if (Date.now() - lastStamp > 60_000) {
    stampTimes.set(row.keyId, Date.now());
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.keyId))
      .then(
        () => undefined,
        () => undefined,
      );
  }

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
