import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { canTransition, leadTransitions, type LeadStatus } from '@crm/shared';
import type {
  LeadConvertInput,
  LeadConvertResult,
  LeadCreateInput,
  LeadDto,
  LeadQuery,
  LeadUpdateInput,
  Paginated,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, dealContacts, leads } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { assertValidCustom } from '../customization/service.js';
import { recordTimeline } from '../timeline/service.js';
import { assertActiveOwner, insertAccount } from '../accounts/service.js';
import { insertContact } from '../contacts/service.js';
import { insertDeal } from '../deals/service.js';
import type { AuthContext } from '../auth/service.js';

type LeadRow = typeof leads.$inferSelect;

function toDto(row: LeadRow): LeadDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    email: row.email,
    phone: row.phone,
    source: row.source,
    status: row.status,
    ownerId: row.ownerId,
    custom: (row.custom ?? {}) as Record<string, unknown>,
    convertedAccountId: row.convertedAccountId,
    convertedContactId: row.convertedContactId,
    convertedDealId: row.convertedDealId,
    convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function leadLabel(row: Pick<LeadRow, 'firstName' | 'lastName' | 'company'>): string {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ');
  return name || row.company || 'Unnamed lead';
}

const sortColumns = {
  createdAt: leads.createdAt,
  company: leads.company,
  lastName: leads.lastName,
} as const;

export async function listLeads(db: Db, ctx: AuthContext, query: LeadQuery): Promise<Paginated<LeadDto>> {
  const conditions: SQL[] = [isNull(leads.deletedAt)];
  if (query.query) {
    const pattern = `%${query.query.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(
      or(
        ilike(leads.firstName, pattern),
        ilike(leads.lastName, pattern),
        ilike(leads.company, pattern),
        ilike(leads.email, pattern),
      )!,
    );
  }
  if (query.status) conditions.push(eq(leads.status, query.status));
  if (query.ownerId) conditions.push(eq(leads.ownerId, query.ownerId));
  const where = and(...conditions)!;
  const orderCol = sortColumns[query.sort];
  const orderBy = query.order === 'asc' ? asc(orderCol) : desc(orderCol);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [items, totalRow] = await Promise.all([
      tx
        .select()
        .from(leads)
        .where(where)
        .orderBy(orderBy, asc(leads.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(leads).where(where),
    ]);
    return {
      items: items.map(toDto),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function getLead(db: Db, ctx: AuthContext, id: string): Promise<LeadDto> {
  const row = await withOrg(db, ctx.organizationId, async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1);
    return lead;
  });
  if (!row) throw new NotFoundError('lead not found');
  return toDto(row);
}

export async function createLead(db: Db, ctx: AuthContext, input: LeadCreateInput): Promise<LeadDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    await assertValidCustom(tx, 'lead', input.custom, { isCreate: true });
    const [row] = await tx
      .insert(leads)
      .values({
        organizationId: ctx.organizationId,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        company: input.company ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source ?? null,
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
      entityType: 'lead',
      entityId: row!.id,
      changes: input as Record<string, unknown>,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'lead.created',
      summary: `Lead "${leadLabel(row!)}" created${row!.source ? ` (source: ${row!.source})` : ''}`,
      actorUserId: ctx.userId,
      targets: { leadId: row!.id },
    });
    return toDto(row!);
  });
}

export async function updateLead(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: LeadUpdateInput,
): Promise<LeadDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('lead not found');
    if (existing.status === 'converted') {
      throw new ValidationError('converted leads are frozen');
    }

    const patch: Partial<typeof leads.$inferInsert> = { updatedBy: ctx.userId };
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.company !== undefined) patch.company = input.company;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.source !== undefined) patch.source = input.source;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.custom !== undefined) {
      await assertValidCustom(tx, 'lead', input.custom, { isCreate: false });
      patch.custom = input.custom;
    }

    const merged = { ...existing, ...patch };
    if (!merged.firstName?.trim() && !merged.lastName?.trim() && !merged.company?.trim()) {
      throw new ValidationError('a lead needs at least a name or a company');
    }

    const [row] = await tx.update(leads).set(patch).where(eq(leads.id, id)).returning();
    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'lead',
        entityId: id,
        changes,
      });
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'lead.updated',
        summary: `Lead "${leadLabel(row!)}" updated (${Object.keys(changes).join(', ')})`,
        actorUserId: ctx.userId,
        detail: { changes },
        targets: { leadId: id },
      });
    }
    return toDto(row!);
  });
}

export async function changeLeadStatus(
  db: Db,
  ctx: AuthContext,
  id: string,
  status: LeadStatus,
): Promise<LeadDto> {
  if (status === 'converted') {
    throw new ValidationError('use the convert endpoint to convert a lead');
  }
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('lead not found');
    if (existing.status === status) return toDto(existing);
    if (!canTransition(leadTransitions, existing.status, status)) {
      throw new ValidationError(`a ${existing.status} lead cannot become ${status}`);
    }
    const [row] = await tx.update(leads).set({ status, updatedBy: ctx.userId }).where(eq(leads.id, id)).returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'lead',
      entityId: id,
      changes: { status: { from: existing.status, to: status } },
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'lead.status_changed',
      summary: `Lead "${leadLabel(row!)}" moved to ${status}`,
      actorUserId: ctx.userId,
      targets: { leadId: id },
    });
    return toDto(row!);
  });
}

/**
 * One-way, atomic conversion (docs/03): creates/links account, contact, optional
 * deal in a single transaction, then freezes the lead.
 */
export async function convertLead(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: LeadConvertInput,
): Promise<LeadConvertResult> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    if (!lead) throw new NotFoundError('lead not found');
    if (lead.status !== 'qualified') {
      throw new ValidationError('only qualified leads can be converted');
    }

    let accountId: string;
    if (input.accountId) {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
        .limit(1);
      if (!account) throw new ValidationError('account does not exist in this organization');
      accountId = account.id;
    } else {
      const account = await insertAccount(tx, ctx, {
        name: lead.company ?? leadLabel(lead),
        ...(lead.phone ? { phone: lead.phone } : {}),
        ...(lead.ownerId ? { ownerId: lead.ownerId } : {}),
      });
      accountId = account.id;
    }

    let contactId: string | null = null;
    if (lead.firstName?.trim() || lead.lastName?.trim()) {
      const contact = await insertContact(tx, ctx, {
        firstName: lead.firstName ?? '',
        lastName: lead.lastName ?? '',
        accountId,
        ...(lead.email ? { email: lead.email } : {}),
        ...(lead.phone ? { phone: lead.phone } : {}),
        ...(lead.ownerId ? { ownerId: lead.ownerId } : {}),
      });
      contactId = contact.id;
    }

    let dealId: string | null = null;
    if (input.deal) {
      const deal = await insertDeal(tx, ctx, {
        name: input.deal.name,
        accountId,
        ...(input.deal.amount !== undefined ? { amount: input.deal.amount } : {}),
        ...(input.deal.expectedCloseDate ? { expectedCloseDate: input.deal.expectedCloseDate } : {}),
        ...(lead.ownerId ? { ownerId: lead.ownerId } : {}),
      });
      dealId = deal.id;
      if (contactId) {
        await tx.insert(dealContacts).values({ dealId, contactId, isPrimary: true });
      }
    }

    const [row] = await tx
      .update(leads)
      .set({
        status: 'converted',
        convertedAccountId: accountId,
        convertedContactId: contactId,
        convertedDealId: dealId,
        convertedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(leads.id, id))
      .returning();

    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'lead',
      entityId: id,
      changes: { status: { from: lead.status, to: 'converted' }, accountId, contactId, dealId },
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'lead.converted',
      summary: `Lead "${leadLabel(lead)}" converted`,
      actorUserId: ctx.userId,
      detail: { accountId, contactId, dealId },
      targets: { leadId: id, accountId },
    });
    return { lead: toDto(row!), accountId, contactId, dealId };
  });
}

export async function archiveLead(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('lead not found');
    await tx.update(leads).set({ deletedAt: new Date(), updatedBy: ctx.userId }).where(eq(leads.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'lead',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'lead.archived',
      summary: `Lead "${leadLabel(existing)}" archived`,
      actorUserId: ctx.userId,
      targets: { leadId: id },
    });
  });
}

export async function restoreLead(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!existing || !existing.deletedAt) throw new NotFoundError('archived lead not found');
    await tx.update(leads).set({ deletedAt: null, updatedBy: ctx.userId }).where(eq(leads.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'restore',
      entityType: 'lead',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'lead.restored',
      summary: `Lead "${leadLabel(existing)}" restored`,
      actorUserId: ctx.userId,
      targets: { leadId: id },
    });
  });
}
