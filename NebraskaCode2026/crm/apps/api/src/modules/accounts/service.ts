import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  AccountCreateInput,
  AccountDto,
  AccountQuery,
  AccountUpdateInput,
  Paginated,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, users } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { recordTimeline } from '../timeline/service.js';
import { assertValidCustom } from '../customization/service.js';
import type { AuthContext } from '../auth/service.js';

type AccountRow = typeof accounts.$inferSelect;

function toDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    website: row.website,
    industry: row.industry,
    phone: row.phone,
    description: row.description,
    ownerId: row.ownerId,
    custom: (row.custom ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/** Matching key for Prompt 11: bare lowercase hostname, no scheme/www/path. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

export async function assertActiveOwner(db: Db, organizationId: string, ownerId: string): Promise<void> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerId), eq(users.organizationId, organizationId), eq(users.isActive, true)))
    .limit(1);
  if (!owner) throw new ValidationError('owner must be an active user of this organization');
}

const sortColumns = {
  name: accounts.name,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
} as const;

export async function listAccounts(
  db: Db,
  ctx: AuthContext,
  query: AccountQuery,
): Promise<Paginated<AccountDto>> {
  const conditions: SQL[] = [isNull(accounts.deletedAt)];
  if (query.query) {
    const pattern = `%${query.query.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(or(ilike(accounts.name, pattern), ilike(accounts.domain, pattern))!);
  }
  if (query.industry) conditions.push(eq(accounts.industry, query.industry));
  if (query.ownerId) conditions.push(eq(accounts.ownerId, query.ownerId));
  const where = and(...conditions)!;
  const orderCol = sortColumns[query.sort];
  const orderBy = query.order === 'asc' ? asc(orderCol) : desc(orderCol);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [items, totalRow] = await Promise.all([
      tx
        .select()
        .from(accounts)
        .where(where)
        .orderBy(orderBy, asc(accounts.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(accounts).where(where),
    ]);
    return {
      items: items.map(toDto),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function getAccount(db: Db, ctx: AuthContext, id: string): Promise<AccountDto> {
  const row = await withOrg(db, ctx.organizationId, async (tx) => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return account;
  });
  if (!row) throw new NotFoundError('account not found');
  return toDto(row);
}

/** In-transaction account creation: insert + audit + timeline. Reused by lead conversion. */
export async function insertAccount(
  tx: Tx,
  ctx: AuthContext,
  input: AccountCreateInput,
): Promise<AccountRow> {
  await assertValidCustom(tx, 'account', input.custom, { isCreate: true });
  const [row] = await tx
    .insert(accounts)
    .values({
        organizationId: ctx.organizationId,
        name: input.name,
        domain: input.domain ? normalizeDomain(input.domain) : null,
        website: input.website ?? null,
        industry: input.industry ?? null,
        phone: input.phone ?? null,
        description: input.description ?? null,
        ownerId: input.ownerId ?? null,
        custom: input.custom ?? {},
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'account',
      entityId: row!.id,
      changes: input as Record<string, unknown>,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'account.created',
      summary: `Account "${row!.name}" created`,
      actorUserId: ctx.userId,
      targets: { accountId: row!.id },
    });
  return row!;
}

export async function createAccount(
  db: Db,
  ctx: AuthContext,
  input: AccountCreateInput,
): Promise<AccountDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);
  const row = await withOrg(db, ctx.organizationId, (tx) => insertAccount(tx, ctx, input));
  return toDto(row);
}

export async function updateAccount(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: AccountUpdateInput,
): Promise<AccountDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('account not found');

    const patch: Partial<typeof accounts.$inferInsert> = { updatedBy: ctx.userId };
    if (input.name !== undefined) patch.name = input.name;
    if (input.domain !== undefined) patch.domain = input.domain ? normalizeDomain(input.domain) : null;
    if (input.website !== undefined) patch.website = input.website;
    if (input.industry !== undefined) patch.industry = input.industry;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.description !== undefined) patch.description = input.description;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.custom !== undefined) {
      await assertValidCustom(tx, 'account', input.custom, { isCreate: false });
      patch.custom = input.custom;
    }

    const [row] = await tx.update(accounts).set(patch).where(eq(accounts.id, id)).returning();

    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'account',
        entityId: id,
        changes,
      });
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'account.updated',
        summary: `Account "${row!.name}" updated (${Object.keys(changes).join(', ')})`,
        actorUserId: ctx.userId,
        detail: { changes },
        targets: { accountId: id },
      });
    }
    return toDto(row!);
  });
}

export async function archiveAccount(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('account not found');
    await tx
      .update(accounts)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(accounts.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'account',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'account.archived',
      summary: `Account "${existing.name}" archived`,
      actorUserId: ctx.userId,
      targets: { accountId: id },
    });
  });
}

export async function restoreAccount(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: accounts.id, name: accounts.name, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    if (!existing || !existing.deletedAt) throw new NotFoundError('archived account not found');
    await tx.update(accounts).set({ deletedAt: null, updatedBy: ctx.userId }).where(eq(accounts.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'restore',
      entityType: 'account',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'account.restored',
      summary: `Account "${existing.name}" restored`,
      actorUserId: ctx.userId,
      targets: { accountId: id },
    });
  });
}
