import { desc, eq } from 'drizzle-orm';
import type {
  WorkflowAction,
  WorkflowCondition,
  WorkflowCreateInput,
  WorkflowDto,
  WorkflowRunDto,
  WorkflowTemplateDto,
  WorkflowTriggerType,
  WorkflowUpdateInput,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { workflowRuns, workflows } from '../../db/schema/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import { invalidateWorkflowTriggerCache } from './engine.js';
import type { AuthContext } from '../auth/service.js';

function toDto(row: typeof workflows.$inferSelect): WorkflowDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    triggerType: row.triggerType as WorkflowTriggerType,
    conditions: row.conditions as WorkflowCondition[],
    actions: row.actions as WorkflowAction[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listWorkflows(db: Db, ctx: AuthContext): Promise<WorkflowDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx.select().from(workflows).orderBy(workflows.name),
  );
  return rows.map(toDto);
}

export async function createWorkflow(
  db: Db,
  ctx: AuthContext,
  input: WorkflowCreateInput,
): Promise<WorkflowDto> {
  invalidateWorkflowTriggerCache(ctx.organizationId);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .insert(workflows)
      .values({
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled,
        triggerType: input.triggerType,
        conditions: input.conditions,
        actions: input.actions,
        createdBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'workflow',
      entityId: row!.id,
      changes: input as unknown as Record<string, unknown>,
    });
    return toDto(row!);
  });
}

export async function updateWorkflow(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: WorkflowUpdateInput,
): Promise<WorkflowDto> {
  invalidateWorkflowTriggerCache(ctx.organizationId);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!existing) throw new NotFoundError('workflow not found');
    const [row] = await tx
      .update(workflows)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
        ...(input.actions !== undefined ? { actions: input.actions } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      })
      .where(eq(workflows.id, id))
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'workflow',
      entityId: id,
      changes: input as unknown as Record<string, unknown>,
    });
    return toDto(row!);
  });
}

export async function deleteWorkflow(db: Db, ctx: AuthContext, id: string): Promise<void> {
  invalidateWorkflowTriggerCache(ctx.organizationId);
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!existing) throw new NotFoundError('workflow not found');
    await tx.delete(workflows).where(eq(workflows.id, id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'workflow',
      entityId: id,
    });
  });
}

export async function listWorkflowRuns(
  db: Db,
  ctx: AuthContext,
  workflowId: string,
): Promise<WorkflowRunDto[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
    if (!workflow) throw new NotFoundError('workflow not found');
    const rows = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflowId,
      triggerType: r.triggerType,
      status: r.status as WorkflowRunDto['status'],
      actionsExecuted: r.actionsExecuted as { type: string; note?: string }[],
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/** Reusable starting points; created through the normal create endpoint. */
export const WORKFLOW_TEMPLATES: WorkflowTemplateDto[] = [
  {
    key: 'won-deal-onboarding',
    name: 'Won deal → onboarding',
    description: 'When a deal is won: notify the owner and spin up the onboarding project.',
    definition: {
      name: 'Won deal → onboarding',
      triggerType: 'deal.won',
      conditions: [],
      actions: [
        { type: 'notify', recipient: 'owner', message: '🎉 Deal "{{deal.name}}" was won!' },
        { type: 'create_onboarding_project' },
      ],
      enabled: true,
    },
  },
  {
    key: 'big-deal-alert',
    name: 'Big deal alert',
    description: 'Notify the owner and re-run AI analysis when a deal over $50k changes stage.',
    definition: {
      name: 'Big deal alert',
      triggerType: 'deal.stage_changed',
      conditions: [{ field: 'deal.amount', op: 'gt', value: 50000 }],
      actions: [
        { type: 'notify', recipient: 'owner', message: 'Big deal "{{deal.name}}" moved stages' },
        { type: 'analyze_deal' },
      ],
      enabled: true,
    },
  },
  {
    key: 'new-lead-followup',
    name: 'New lead follow-up',
    description: 'Create a follow-up task within a day for every new lead.',
    definition: {
      name: 'New lead follow-up',
      triggerType: 'lead.created',
      conditions: [],
      actions: [
        {
          type: 'create_task',
          title: 'Follow up with new lead {{lead.firstName}} {{lead.lastName}}',
          priority: 'high',
          dueInDays: 1,
        },
      ],
      enabled: true,
    },
  },
  {
    key: 'won-deal-slack',
    name: 'Won deal → Slack',
    description: 'Post to the team Slack channel whenever a deal is won (needs the Slack integration).',
    definition: {
      name: 'Won deal → Slack',
      triggerType: 'deal.won',
      conditions: [],
      actions: [
        { type: 'post_message', target: 'slack', message: '🎉 {{deal.name}} closed won — ${{deal.amount}}!' },
      ],
      enabled: true,
    },
  },
  {
    key: 'lost-deal-review',
    name: 'Lost deal review',
    description: 'Email the owner a loss-review prompt when a deal is lost.',
    definition: {
      name: 'Lost deal review',
      triggerType: 'deal.lost',
      conditions: [],
      actions: [
        {
          type: 'send_email',
          to: 'owner',
          subject: 'Loss review: {{deal.name}}',
          body: 'Deal "{{deal.name}}" was lost ({{deal.winLossReason}}). Take five minutes to log what we could have done differently.',
        },
      ],
      enabled: true,
    },
  },
];
