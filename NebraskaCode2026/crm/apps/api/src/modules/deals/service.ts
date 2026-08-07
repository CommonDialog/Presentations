import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, ilike, isNull, sql, type SQL } from 'drizzle-orm';
import { canTransition, dealStatusTransitions } from '@crm/shared';
import type {
  BoardDto,
  DealContactDto,
  DealCreateInput,
  DealDto,
  DealMoveInput,
  DealQuery,
  DealUpdateInput,
  ForecastDto,
  Paginated,
  PipelineStageDto,
  StageHistoryDto,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import {
  accounts,
  contacts,
  dealContacts,
  deals,
  dealStageHistory,
  pipelineStages,
} from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { shallowDiff } from '../../lib/diff.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { assertValidCustom } from '../customization/service.js';
import { recordTimeline } from '../timeline/service.js';
import { assertActiveOwner } from '../accounts/service.js';
import { getDefaultPipeline, getPipelineWithStages } from '../pipelines/service.js';
import type { AuthContext } from '../auth/service.js';

type DealRow = typeof deals.$inferSelect;
type StageRow = typeof pipelineStages.$inferSelect;

function money(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toDto(row: DealRow, stageProbability: number, accountName: string): DealDto {
  const amount = money(row.amount);
  const effectiveProbability = row.probability ?? stageProbability;
  return {
    id: row.id,
    name: row.name,
    accountId: row.accountId,
    accountName,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    status: row.status,
    amount,
    currency: row.currency,
    probability: row.probability,
    effectiveProbability,
    expectedRevenue:
      amount === null ? null : Math.round(amount * effectiveProbability) / 100,
    expectedCloseDate: row.expectedCloseDate,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    winLossReason: row.winLossReason,
    ownerId: row.ownerId,
    custom: (row.custom ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toStageDto(row: StageRow): PipelineStageDto {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.displayOrder,
    probability: row.probability,
    isWon: row.isWon,
    isLost: row.isLost,
  };
}

/** In-transaction deal creation. Reused by lead conversion. */
export async function insertDeal(
  tx: Tx,
  ctx: AuthContext,
  input: DealCreateInput,
): Promise<DealRow> {
  const [account] = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
    .limit(1);
  if (!account) throw new ValidationError('account does not exist in this organization');

  const pipelineId = input.pipelineId ?? (await getDefaultPipeline(tx)).id;
  const { stages } = await getPipelineWithStages(tx, pipelineId);

  let stage: StageRow | undefined;
  if (input.stageId) {
    stage = stages.find((s) => s.id === input.stageId);
    if (!stage) throw new ValidationError('stage does not belong to the pipeline');
  } else {
    stage = stages.find((s) => !s.isWon && !s.isLost);
    if (!stage) throw new ValidationError('pipeline has no open stage');
  }
  if (stage.isWon || stage.isLost) {
    throw new ValidationError('deals are created in an open stage; move them to close');
  }

  await assertValidCustom(tx, 'deal', input.custom, { isCreate: true });
  const [row] = await tx
    .insert(deals)
    .values({
      organizationId: ctx.organizationId,
      accountId: input.accountId,
      name: input.name,
      pipelineId,
      stageId: stage.id,
      status: 'open',
      amount: input.amount !== undefined ? input.amount.toFixed(2) : null,
      currency: input.currency ?? 'USD',
      probability: input.probability ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerId: input.ownerId ?? null,
      custom: input.custom ?? {},
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();

  await tx.insert(dealStageHistory).values({
    organizationId: ctx.organizationId,
    dealId: row!.id,
    fromStageId: null,
    toStageId: stage.id,
    changedBy: ctx.userId,
  });
  await recordAudit(tx, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'create',
    entityType: 'deal',
    entityId: row!.id,
    changes: input as Record<string, unknown>,
  });
  await recordTimeline(tx, {
    organizationId: ctx.organizationId,
    entryType: 'deal.created',
    summary: `Deal "${row!.name}" created in ${stage.name}`,
    actorUserId: ctx.userId,
    targets: { dealId: row!.id, accountId: account.id },
  });
  return row!;
}

async function loadDealDto(tx: Tx, id: string): Promise<DealDto | undefined> {
  const [row] = await tx
    .select({ deal: deals, stageProbability: pipelineStages.probability, accountName: accounts.name })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(accounts, eq(accounts.id, deals.accountId))
    .where(eq(deals.id, id))
    .limit(1);
  return row ? toDto(row.deal, row.stageProbability, row.accountName) : undefined;
}

export async function createDeal(db: Db, ctx: AuthContext, input: DealCreateInput): Promise<DealDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const row = await insertDeal(tx, ctx, input);
    return (await loadDealDto(tx, row.id))!;
  });
}

const sortColumns = {
  name: deals.name,
  amount: deals.amount,
  expectedCloseDate: deals.expectedCloseDate,
  createdAt: deals.createdAt,
} as const;

export async function listDeals(db: Db, ctx: AuthContext, query: DealQuery): Promise<Paginated<DealDto>> {
  const conditions: SQL[] = [isNull(deals.deletedAt)];
  if (query.query) {
    conditions.push(ilike(deals.name, `%${query.query.replace(/[%_]/g, '\\$&')}%`));
  }
  if (query.pipelineId) conditions.push(eq(deals.pipelineId, query.pipelineId));
  if (query.stageId) conditions.push(eq(deals.stageId, query.stageId));
  if (query.status) conditions.push(eq(deals.status, query.status));
  if (query.accountId) conditions.push(eq(deals.accountId, query.accountId));
  if (query.ownerId) conditions.push(eq(deals.ownerId, query.ownerId));
  const where = and(...conditions)!;
  const orderCol = sortColumns[query.sort];
  const orderBy = query.order === 'asc' ? asc(orderCol) : desc(orderCol);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [rows, totalRow] = await Promise.all([
      tx
        .select({ deal: deals, stageProbability: pipelineStages.probability, accountName: accounts.name })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .innerJoin(accounts, eq(accounts.id, deals.accountId))
        .where(where)
        .orderBy(orderBy, asc(deals.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      tx.select({ count: sql<number>`count(*)::int` }).from(deals).where(where),
    ]);
    return {
      items: rows.map((r) => toDto(r.deal, r.stageProbability, r.accountName)),
      total: totalRow[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function getDeal(db: Db, ctx: AuthContext, id: string): Promise<DealDto> {
  const dto = await withOrg(db, ctx.organizationId, (tx) => loadDealDto(tx, id));
  if (!dto) throw new NotFoundError('deal not found');
  return dto;
}

export async function updateDeal(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: DealUpdateInput,
): Promise<DealDto> {
  if (input.ownerId) await assertActiveOwner(db, ctx.organizationId, input.ownerId);

  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('deal not found');

    const patch: Partial<typeof deals.$inferInsert> = { updatedBy: ctx.userId };
    if (input.name !== undefined) patch.name = input.name;
    if (input.amount !== undefined) patch.amount = input.amount === null ? null : input.amount.toFixed(2);
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.probability !== undefined) patch.probability = input.probability;
    if (input.expectedCloseDate !== undefined) patch.expectedCloseDate = input.expectedCloseDate;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.custom !== undefined) {
      await assertValidCustom(tx, 'deal', input.custom, { isCreate: false });
      patch.custom = input.custom;
    }

    const [row] = await tx.update(deals).set(patch).where(eq(deals.id, id)).returning();

    const changes = shallowDiff(
      existing as unknown as Record<string, unknown>,
      Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'updatedBy')),
    );
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'deal',
        entityId: id,
        changes,
      });
      await recordTimeline(tx, {
        organizationId: ctx.organizationId,
        entryType: 'deal.updated',
        summary: `Deal "${row!.name}" updated (${Object.keys(changes).join(', ')})`,
        actorUserId: ctx.userId,
        detail: { changes },
        targets: { dealId: id, accountId: row!.accountId },
      });
    }
    return (await loadDealDto(tx, id))!;
  });
}

export async function moveDealStage(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: DealMoveInput,
): Promise<DealDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [deal] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
      .limit(1);
    if (!deal) throw new NotFoundError('deal not found');

    const [stage] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.pipelineId, deal.pipelineId)))
      .limit(1);
    if (!stage) throw new ValidationError('stage does not belong to the deal\'s pipeline');
    if (stage.id === deal.stageId) return (await loadDealDto(tx, id))!;

    const newStatus = stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open';
    if (deal.status !== newStatus && !canTransition(dealStatusTransitions, deal.status, newStatus)) {
      throw new ValidationError(`cannot move a ${deal.status} deal to a ${newStatus} stage; reopen it first`);
    }
    if (newStatus === 'won' && deal.amount === null) {
      throw new ValidationError('a deal needs an amount before it can be won');
    }
    if (newStatus === 'lost' && !input.winLossReason) {
      throw new ValidationError('a loss reason is required to close a deal as lost');
    }

    const closing = newStatus !== 'open';
    const reopening = deal.status !== 'open' && newStatus === 'open';
    const [row] = await tx
      .update(deals)
      .set({
        stageId: stage.id,
        status: newStatus,
        closedAt: closing ? new Date() : null,
        winLossReason: closing ? (input.winLossReason ?? null) : null,
        updatedBy: ctx.userId,
      })
      .where(eq(deals.id, id))
      .returning();

    await tx.insert(dealStageHistory).values({
      organizationId: ctx.organizationId,
      dealId: id,
      fromStageId: deal.stageId,
      toStageId: stage.id,
      changedBy: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'deal',
      entityId: id,
      changes: { stageId: { from: deal.stageId, to: stage.id }, status: { from: deal.status, to: newStatus } },
    });

    const entryType =
      newStatus === 'won'
        ? 'deal.won'
        : newStatus === 'lost'
          ? 'deal.lost'
          : reopening
            ? 'deal.reopened'
            : 'deal.stage_changed';
    const summary =
      newStatus === 'won'
        ? `Deal "${deal.name}" won 🎉`
        : newStatus === 'lost'
          ? `Deal "${deal.name}" lost — ${input.winLossReason}`
          : reopening
            ? `Deal "${deal.name}" reopened into ${stage.name}`
            : `Deal "${deal.name}" moved to ${stage.name}`;
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType,
      summary,
      actorUserId: ctx.userId,
      detail: { fromStageId: deal.stageId, toStageId: stage.id },
      targets: { dealId: id, accountId: row!.accountId },
    });
    return (await loadDealDto(tx, id))!;
  });
}

export async function archiveDeal(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: deals.id, name: deals.name, accountId: deals.accountId })
      .from(deals)
      .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
      .limit(1);
    if (!existing) throw new NotFoundError('deal not found');
    await tx.update(deals).set({ deletedAt: new Date(), updatedBy: ctx.userId }).where(eq(deals.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'deal',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'deal.archived',
      summary: `Deal "${existing.name}" archived`,
      actorUserId: ctx.userId,
      targets: { dealId: id, accountId: existing.accountId },
    });
  });
}

export async function restoreDeal(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
    if (!existing || !existing.deletedAt) throw new NotFoundError('archived deal not found');
    await tx.update(deals).set({ deletedAt: null, updatedBy: ctx.userId }).where(eq(deals.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'restore',
      entityType: 'deal',
      entityId: id,
    });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'deal.restored',
      summary: `Deal "${existing.name}" restored`,
      actorUserId: ctx.userId,
      targets: { dealId: id, accountId: existing.accountId },
    });
  });
}

// ---------- deal contacts ----------

export async function listDealContacts(db: Db, ctx: AuthContext, dealId: string): Promise<DealContactDto[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal) throw new NotFoundError('deal not found');
    const rows = await tx
      .select({
        contactId: dealContacts.contactId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        role: dealContacts.role,
        isPrimary: dealContacts.isPrimary,
      })
      .from(dealContacts)
      .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
      .where(eq(dealContacts.dealId, dealId))
      .orderBy(desc(dealContacts.isPrimary), asc(contacts.lastName));
    return rows;
  });
}

export async function addDealContact(
  db: Db,
  ctx: AuthContext,
  dealId: string,
  input: { contactId: string; role?: string | undefined; isPrimary?: boolean | undefined },
): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [deal] = await tx
      .select({ id: deals.id, name: deals.name, accountId: deals.accountId })
      .from(deals)
      .where(and(eq(deals.id, dealId), isNull(deals.deletedAt)))
      .limit(1);
    if (!deal) throw new NotFoundError('deal not found');
    const [contact] = await tx
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) throw new ValidationError('contact does not exist in this organization');

    if (input.isPrimary) {
      await tx.update(dealContacts).set({ isPrimary: false }).where(eq(dealContacts.dealId, dealId));
    }
    await tx
      .insert(dealContacts)
      .values({
        dealId,
        contactId: input.contactId,
        role: input.role ?? null,
        isPrimary: input.isPrimary ?? false,
      })
      .onConflictDoUpdate({
        target: [dealContacts.dealId, dealContacts.contactId],
        set: { role: input.role ?? null, isPrimary: input.isPrimary ?? false },
      });
    await recordTimeline(tx, {
      organizationId: ctx.organizationId,
      entryType: 'deal.contact_linked',
      summary: `${contact.firstName} ${contact.lastName} linked to deal "${deal.name}"`,
      actorUserId: ctx.userId,
      targets: { dealId, contactId: contact.id },
    });
  });
}

export async function removeDealContact(
  db: Db,
  ctx: AuthContext,
  dealId: string,
  contactId: string,
): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    await tx
      .delete(dealContacts)
      .where(and(eq(dealContacts.dealId, dealId), eq(dealContacts.contactId, contactId)));
  });
}

// ---------- stage history / board / forecast ----------

export async function getStageHistory(db: Db, ctx: AuthContext, dealId: string): Promise<StageHistoryDto[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal) throw new NotFoundError('deal not found');
    const fromStage = alias(pipelineStages, 'from_stage');
    const toStage = alias(pipelineStages, 'to_stage');
    const rows = await tx
      .select({
        id: dealStageHistory.id,
        fromStageId: dealStageHistory.fromStageId,
        fromStageName: fromStage.name,
        toStageId: dealStageHistory.toStageId,
        toStageName: toStage.name,
        changedBy: dealStageHistory.changedBy,
        changedAt: dealStageHistory.changedAt,
      })
      .from(dealStageHistory)
      .leftJoin(fromStage, eq(fromStage.id, dealStageHistory.fromStageId))
      .leftJoin(toStage, eq(toStage.id, dealStageHistory.toStageId))
      .where(eq(dealStageHistory.dealId, dealId))
      .orderBy(asc(dealStageHistory.changedAt), asc(dealStageHistory.id));
    return rows.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() }));
  });
}

export async function getBoard(db: Db, ctx: AuthContext, pipelineId?: string): Promise<BoardDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const resolvedId = pipelineId ?? (await getDefaultPipeline(tx)).id;
    const { pipeline, stages } = await getPipelineWithStages(tx, resolvedId);

    const rows = await tx
      .select({ deal: deals, stageProbability: pipelineStages.probability, accountName: accounts.name })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .innerJoin(accounts, eq(accounts.id, deals.accountId))
      .where(and(eq(deals.pipelineId, resolvedId), isNull(deals.deletedAt)))
      .orderBy(desc(deals.createdAt));

    const dtos = rows.map((r) => toDto(r.deal, r.stageProbability, r.accountName));
    const columns = stages.map((stage) => {
      const stageDeals = dtos.filter((d) => d.stageId === stage.id);
      return {
        stage: toStageDto(stage),
        deals: stageDeals,
        totalAmount: round2(stageDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0)),
        weightedAmount: round2(stageDeals.reduce((sum, d) => sum + (d.expectedRevenue ?? 0), 0)),
      };
    });
    return {
      pipeline: {
        id: pipeline.id,
        name: pipeline.name,
        isDefault: pipeline.isDefault,
        stages: stages.map(toStageDto),
      },
      columns,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getForecast(db: Db, ctx: AuthContext, pipelineId?: string): Promise<ForecastDto> {
  const board = await getBoard(db, ctx, pipelineId);
  const openColumns = board.columns.filter((c) => !c.stage.isWon && !c.stage.isLost);
  const wonDeals = board.columns.filter((c) => c.stage.isWon).flatMap((c) => c.deals);
  const lostDeals = board.columns.filter((c) => c.stage.isLost).flatMap((c) => c.deals);
  return {
    pipelineId: board.pipeline.id,
    stages: openColumns.map((c) => ({
      stageId: c.stage.id,
      stageName: c.stage.name,
      count: c.deals.length,
      totalAmount: c.totalAmount,
      weightedAmount: c.weightedAmount,
    })),
    openCount: openColumns.reduce((sum, c) => sum + c.deals.length, 0),
    openAmount: round2(openColumns.reduce((sum, c) => sum + c.totalAmount, 0)),
    weightedForecast: round2(openColumns.reduce((sum, c) => sum + c.weightedAmount, 0)),
    wonCount: wonDeals.length,
    wonAmount: round2(wonDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0)),
    lostCount: lostDeals.length,
  };
}
