import { and, desc, eq } from 'drizzle-orm';
import { aiProposalTransitions, canTransition } from '@crm/shared';
import type { ProposalDto, ProposalType } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { aiArtifacts } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { updateAccount } from '../accounts/service.js';
import { updateContact } from '../contacts/service.js';
import { updateDeal } from '../deals/service.js';
import { createTask } from '../tasks/service.js';
import { createActivity } from '../activities/service.js';
import type { AuthContext } from '../auth/service.js';

type ArtifactRow = typeof aiArtifacts.$inferSelect;

// AI may only propose changes to these fields; anything else is rejected at
// apply time even if an artifact was hand-crafted into the table.
const FIELD_WHITELIST: Record<string, readonly string[]> = {
  account: ['industry', 'description', 'phone', 'website', 'domain'],
  contact: ['title', 'phone', 'email'],
  deal: ['amount', 'expectedCloseDate', 'probability', 'name'],
};

export function isWhitelistedField(entityType: string, field: string): boolean {
  return FIELD_WHITELIST[entityType]?.includes(field) ?? false;
}

export function toProposalDto(row: ArtifactRow): ProposalDto {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    proposalType: payload.proposalType as ProposalType,
    payload,
    accountId: row.accountId,
    contactId: row.contactId,
    dealId: row.dealId,
    leadId: row.leadId,
    sourceActivityId: row.sourceActivityId,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProposals(
  db: Db,
  ctx: AuthContext,
  status?: 'pending' | 'approved' | 'rejected' | 'applied',
): Promise<ProposalDto[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(aiArtifacts)
      .where(
        status
          ? and(eq(aiArtifacts.kind, 'proposal'), eq(aiArtifacts.status, status))
          : eq(aiArtifacts.kind, 'proposal'),
      )
      .orderBy(desc(aiArtifacts.createdAt))
      .limit(200);
    return rows.map(toProposalDto);
  });
}

async function getProposal(db: Db, ctx: AuthContext, id: string): Promise<ArtifactRow> {
  const [row] = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(aiArtifacts)
      .where(and(eq(aiArtifacts.id, id), eq(aiArtifacts.kind, 'proposal')))
      .limit(1),
  );
  if (!row) throw new NotFoundError('proposal not found');
  return row;
}

function coerceDealValue(field: string, value: string): number | string | null {
  if (field === 'amount') {
    const n = Number(value.replace(/[$,]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new ValidationError(`"${value}" is not a valid amount`);
    return n;
  }
  if (field === 'probability') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      throw new ValidationError(`"${value}" is not a valid probability (0-100)`);
    }
    return n;
  }
  if (field === 'expectedCloseDate') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ValidationError(`"${value}" is not a valid date (YYYY-MM-DD)`);
    }
    return value;
  }
  return value;
}

/**
 * Executes an approved proposal THROUGH the normal service layer, so every
 * apply carries the same validation, audit trail, and timeline entries as a
 * human doing it by hand. AI never touches tables directly.
 */
async function applyProposal(db: Db, ctx: AuthContext, artifact: ArtifactRow): Promise<void> {
  const payload = (artifact.payload ?? {}) as Record<string, unknown>;
  const proposalType = payload.proposalType as ProposalType;

  if (proposalType === 'update_field') {
    const entityType = String(payload.entityType);
    const field = String(payload.field);
    const value = String(payload.suggestedValue);
    if (!isWhitelistedField(entityType, field)) {
      throw new ValidationError(`field "${field}" on ${entityType} is not AI-updatable`);
    }
    if (entityType === 'account') {
      if (!artifact.accountId) throw new ValidationError('proposal has no linked account');
      await updateAccount(db, ctx, artifact.accountId, { [field]: value });
    } else if (entityType === 'contact') {
      if (!artifact.contactId) throw new ValidationError('proposal has no linked contact');
      await updateContact(db, ctx, artifact.contactId, { [field]: value });
    } else if (entityType === 'deal') {
      if (!artifact.dealId) throw new ValidationError('proposal has no linked deal');
      await updateDeal(db, ctx, artifact.dealId, { [field]: coerceDealValue(field, value) });
    } else {
      throw new ValidationError(`unknown entity type "${entityType}"`);
    }
    return;
  }

  if (proposalType === 'create_task') {
    const dueInDays = Number(payload.dueInDays ?? 3);
    await createTask(db, ctx, {
      title: String(payload.title),
      ...(payload.description ? { description: String(payload.description) } : {}),
      priority: (payload.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
      dueAt: new Date(Date.now() + Math.min(Math.max(dueInDays, 1), 60) * 86_400_000).toISOString(),
      ...(artifact.accountId ? { accountId: artifact.accountId } : {}),
      ...(artifact.contactId ? { contactId: artifact.contactId } : {}),
      ...(artifact.dealId ? { dealId: artifact.dealId } : {}),
      ...(artifact.leadId ? { leadId: artifact.leadId } : {}),
    });
    return;
  }

  if (proposalType === 'followup_email') {
    // Real sending arrives with Prompt 11; until then an approved follow-up
    // becomes an outbound draft activity on the record.
    await createActivity(db, ctx, {
      type: 'email',
      direction: 'outbound',
      subject: String(payload.subject),
      body: String(payload.body),
      metadata: { draft: true, generatedBy: 'ai' },
      links: {
        ...(artifact.accountId ? { accounts: [artifact.accountId] } : {}),
        ...(artifact.contactId ? { contacts: [artifact.contactId] } : {}),
        ...(artifact.dealId ? { deals: [artifact.dealId] } : {}),
        ...(artifact.leadId ? { leads: [artifact.leadId] } : {}),
      },
    });
    return;
  }

  throw new ValidationError(`unknown proposal type "${String(proposalType)}"`);
}

export async function approveProposal(db: Db, ctx: AuthContext, id: string): Promise<ProposalDto> {
  const artifact = await getProposal(db, ctx, id);
  if (!canTransition(aiProposalTransitions, artifact.status, 'approved')) {
    throw new ValidationError(`proposal is already ${artifact.status}`);
  }

  await applyProposal(db, ctx, artifact); // throws → proposal stays pending

  const [updated] = await withOrg(db, ctx.organizationId, async (tx) => {
    const rows = await tx
      .update(aiArtifacts)
      .set({ status: 'applied', reviewedBy: ctx.userId, reviewedAt: new Date() })
      .where(eq(aiArtifacts.id, id))
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'ai_artifact',
      entityId: id,
      changes: { status: { from: 'pending', to: 'applied' } },
    });
    return rows;
  });
  return toProposalDto(updated!);
}

export async function rejectProposal(
  db: Db,
  ctx: AuthContext,
  id: string,
  reason?: string,
): Promise<ProposalDto> {
  const artifact = await getProposal(db, ctx, id);
  if (!canTransition(aiProposalTransitions, artifact.status, 'rejected')) {
    throw new ValidationError(`proposal is already ${artifact.status}`);
  }
  const payload = {
    ...((artifact.payload ?? {}) as Record<string, unknown>),
    ...(reason ? { rejectReason: reason } : {}),
  };
  const [updated] = await withOrg(db, ctx.organizationId, async (tx) => {
    const rows = await tx
      .update(aiArtifacts)
      .set({ status: 'rejected', reviewedBy: ctx.userId, reviewedAt: new Date(), payload })
      .where(eq(aiArtifacts.id, id))
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'ai_artifact',
      entityId: id,
      changes: { status: { from: 'pending', to: 'rejected' }, reason: reason ?? null },
    });
    return rows;
  });
  return toProposalDto(updated!);
}
