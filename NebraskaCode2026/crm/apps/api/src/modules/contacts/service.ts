import { and, asc, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type {
  ContactCreateInput,
  ContactDto,
  ContactQuery,
  ContactUpdateInput,
  Paginated,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, contacts } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { assertValidCustom } from '../customization/service.js';
import { recordTimeline } from '../timeline/service.js';
import { assertActiveOwner } from '../accounts/service.js';
import type { AuthContext } from '../auth/service.js';

type ContactRow = typeof contacts.$inferSelect;

function toDto(row: ContactRow): ContactDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    title: row.title,
    accountId: row.accountId,
    ownerId: row.ownerId,
    custom: (row.custom ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function assertAccountInOrg(tx: Tx, accountId: string): Promise<{ id: string; name: string }> {
  const [account] = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
    .limit(1);
  if (!account) throw new ValidationError('account does not exist in this organization');
  return account;
}

async function duplicateEmailWarnings(tx: Tx, email: string, excludeId?: string): Promise<string[]> {
  const conditions: SQL[] = [
    eq(sql`lower(${contacts.email})`, email.toLowerCase()),
    isNull(contacts.deletedAt),
  ];
  if (excludeId) conditions.push(ne(contacts.id, excludeId));
  const dupes = await tx
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(...conditions));
  return dupes.map((d) => `a contact with this email already exists: ${d.firstName} ${d.lastName}`);
}

const sortColumns = {
  lastName: contacts.lastName,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
} as const;

export async function listContacts(
  db: Db,
  ctx: AuthContext,
  query: ContactQuery,
): Promise<Paginated<ContactDto>> {
  const conditions: SQL[] = [isNull(contacts.deletedAt)];
  if (query.query) {
    const pattern = `%${query.query.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(
      or(
        ilike(contacts.firstName, pattern),
        ilike(contacts.lastName, pattern),
        ilike(contacts.email, pattern),
      )!,
    );
  }
  if (query.accountId) conditions.push(eq(contacts.accountId, query.accountId));
  if (query.ownerId) conditions.push(eq(contacts.ownerId, query.ownerId));
  const where = and(...conditions)!;
  const orderCol = sortColumns[query.sort];
  const orderBy = query.order === 'asc' ? asc(orderCol) : desc(orderCol);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [items, totalRow] = await Promise.all([
      tx
        .select()
        .from(contacts)
        .where(where)
        .orderBy(orderBy, asc(contacts.firstName), asc(contacts.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(contacts).where(where),
    ]);
    return {
      items: items.map(toDto),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function getContact(db: Db, ctx: AuthContext, id: string): Promise<ContactDto> {
  const row = await withOrg(db, ctx.organizationId, async (tx) => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    return contact;
  });
  if (!row) throw new NotFoundError('contact not found');
  return toDto(row);
}

/** In-transaction contact creation: insert + audit + timeline. Reused by lead conversion. */
export async function insertContact(
  tx: Tx,
  ctx: AuthContext,
  input: ContactCreateInput,
): Promise<ContactRow> {
  const account = input.accountId ? await assertAccountInOrg(tx, input.accountId) : null;
  await assertValidCustom(tx, 'contact', input.custom, { isCreate: true });

  const [row] = await tx
    .insert(contacts)
    .values({
      organizationId: ctx.organizationId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      title: input.title ?? null,
      accountId: input.accountId ?? null,
      ownerId: input.ownerId ?? null,
      custom: input.custom ?? {},
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();

  const fullName = `${row!.firstName} ${row!.lastName}`.trim();
  await recordAudit(tx, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'create',
    entityType: 'contact',
    entityId: row!.id,
    changes: input as Record<string, unknown>,
  });
  await recordTimeline(tx, {
    organizationId: ctx.organizationId,
    entryType: 'contact.created',
    summary: account
      ? `Contact "${fullName}" added to ${account.name}`
      : `Contact "${fullName}" created`,
    actorUserId: ctx.userId,
    targets: { contactId: row!.id, accountId: row!.accountId },
  });
  return row!;
}

export async function createContact(
  db: Db,
  ctx: AuthContext,
  input: ContactCreateInput,
): Promise<{ contact: ContactDto; warnings: string[] }> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const warnings = input.email ? await duplicateEmailWarnings(tx, input.email) : [];
    const row = await insertContact(tx, ctx, input);
    return { contact: toDto(row), warnings };
  });
}

export async function updateContact(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: ContactUpdateInput,
): Promise<{ contact: ContactDto; warnings: string[] }> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('contact not found');

    if (input.accountId) await assertAccountInOrg(tx, input.accountId);
    const warnings = input.email ? await duplicateEmailWarnings(tx, input.email, id) : [];

    const patch: Partial<typeof contacts.$inferInsert> = { updatedBy: ctx.userId };
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.title !== undefined) patch.title = input.title;
    if (input.accountId !== undefined) patch.accountId = input.accountId;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.custom !== undefined) {
      await assertValidCustom(tx, 'contact', input.custom, { isCreate: false });
      patch.custom = input.custom;
    }

    const [row] = await tx.update(contacts).set(patch).where(eq(contacts.id, id)).returning();

    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    if (Object.keys(changes).length > 0) {
      const fullName = `${row!.firstName} ${row!.lastName}`;
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'contact',
        entityId: id,
        changes,
      });
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'contact.updated',
        summary: `Contact "${fullName}" updated (${Object.keys(changes).join(', ')})`,
        actorUserId: ctx.userId,
        detail: { changes },
        targets: { contactId: id, accountId: row!.accountId },
      });
    }
    return { contact: toDto(row!), warnings };
  });
}

export async function archiveContact(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        accountId: contacts.accountId,
      })
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('contact not found');
    await tx
      .update(contacts)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(contacts.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'contact',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'contact.archived',
      summary: `Contact "${existing.firstName} ${existing.lastName}" archived`,
      actorUserId: ctx.userId,
      targets: { contactId: id, accountId: existing.accountId },
    });
  });
}

export async function restoreContact(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);
    if (!existing || !existing.deletedAt) throw new NotFoundError('archived contact not found');
    await tx.update(contacts).set({ deletedAt: null, updatedBy: ctx.userId }).where(eq(contacts.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'restore',
      entityType: 'contact',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'contact.restored',
      summary: `Contact "${existing.firstName} ${existing.lastName}" restored`,
      actorUserId: ctx.userId,
      targets: { contactId: id, accountId: existing.accountId },
    });
  });
}
