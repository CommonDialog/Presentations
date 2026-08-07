import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WorkflowAction, WorkflowCondition, WorkflowTriggerType } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { users, workflowRuns, workflows } from '../../db/schema/index.js';
import { withOrg } from '../../lib/tenant.js';
import { createTask } from '../tasks/service.js';
import { sendEmail } from '../email/service.js';
import { pushNotification } from '../notifications/service.js';
import { analyzeDeal, ANALYZE_JOB, type AnalyzeJobData } from '../active/service.js';
import { createProjectFromDeal } from '../projects/service.js';
import { dispatchWebhooks, postChatMessage } from '../integrations/service.js';
import { cacheTtl, TtlCache } from '../../lib/cache.js';
import { systemContext, type AuthContext } from '../auth/service.js';

// Per-org summary of enabled workflow trigger types, so entity writes skip
// the workflow machinery when nothing is listening — the common case. CRUD
// invalidates in-process; other instances converge within the TTL.
const triggerCache = new TtlCache<string[]>(cacheTtl(10_000));

export function invalidateWorkflowTriggerCache(organizationId: string): void {
  triggerCache.delete(organizationId);
}

async function orgHasWorkflowFor(db: Db, organizationId: string, triggerType: string): Promise<boolean> {
  let triggers = triggerCache.get(organizationId);
  if (triggers === undefined) {
    const rows = await withOrg(db, organizationId, (tx) =>
      tx
        .selectDistinct({ triggerType: workflows.triggerType })
        .from(workflows)
        .where(eq(workflows.enabled, true)),
    );
    triggers = rows.map((r) => r.triggerType);
    triggerCache.set(organizationId, triggers);
  }
  return triggers.includes(triggerType);
}

/** Trigger context: whatever the emitting site knows about the event. */
export interface WorkflowEvent {
  type: WorkflowTriggerType;
  context: Record<string, unknown>;
}

export interface WorkflowJobData {
  organizationId: string;
  userId: string;
  event: WorkflowEvent;
}

export const WORKFLOW_JOB = 'workflow.execute';

function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function evaluateConditions(
  conditions: WorkflowCondition[],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => {
    const actual = getPath(context, condition.field);
    switch (condition.op) {
      case 'exists':
        return actual !== undefined && actual !== null && actual !== '';
      case 'eq':
        return actual == condition.value; // eslint-disable-line eqeqeq -- '5000' == 5000 intended
      case 'neq':
        return actual != condition.value; // eslint-disable-line eqeqeq
      case 'gt':
        return Number(actual) > Number(condition.value);
      case 'gte':
        return Number(actual) >= Number(condition.value);
      case 'lt':
        return Number(actual) < Number(condition.value);
      case 'lte':
        return Number(actual) <= Number(condition.value);
      case 'contains':
        return String(actual ?? '').toLowerCase().includes(String(condition.value ?? '').toLowerCase());
      default:
        return false;
    }
  });
}

/** {{deal.name}}-style template rendering against the trigger context. */
export function renderContextTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_m, path: string) => {
    const value = getPath(context, path);
    return value === undefined || value === null ? '' : String(value);
  });
}

function entityLinks(context: Record<string, unknown>): {
  accountId?: string;
  contactId?: string;
  dealId?: string;
  leadId?: string;
  projectId?: string;
} {
  const deal = context.deal as { id?: string; accountId?: string } | undefined;
  const contact = context.contact as { id?: string; accountId?: string } | undefined;
  const lead = context.lead as { id?: string } | undefined;
  const project = context.project as { id?: string; accountId?: string } | undefined;
  return {
    ...(deal?.id ? { dealId: deal.id } : {}),
    ...(contact?.id ? { contactId: contact.id } : {}),
    ...(lead?.id ? { leadId: lead.id } : {}),
    ...(project?.id ? { projectId: project.id } : {}),
    ...(deal?.accountId ?? contact?.accountId ?? project?.accountId
      ? { accountId: (deal?.accountId ?? contact?.accountId ?? project?.accountId)! }
      : {}),
  };
}

function ownerId(context: Record<string, unknown>, fallback: string): string {
  for (const key of ['deal', 'project', 'lead', 'contact']) {
    const entity = context[key] as { ownerId?: string | null } | undefined;
    if (entity?.ownerId) return entity.ownerId;
  }
  return fallback;
}

async function resolveEmail(db: Db, ctx: AuthContext, to: string, context: Record<string, unknown>): Promise<string | null> {
  if (to.includes('@')) return to.toLowerCase();
  if (to === 'contact') {
    const contact = context.contact as { email?: string | null } | undefined;
    return contact?.email ?? null;
  }
  if (to === 'owner') {
    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, ownerId(context, ctx.userId)), eq(users.organizationId, ctx.organizationId)))
      .limit(1);
    return owner?.email ?? null;
  }
  return null;
}

async function executeAction(
  app: FastifyInstance,
  ctx: AuthContext,
  action: WorkflowAction,
  context: Record<string, unknown>,
): Promise<{ type: string; note?: string }> {
  const links = entityLinks(context);

  if (action.type === 'create_task') {
    await createTask(app.db, ctx, {
      title: renderContextTemplate(action.title, context),
      ...(action.description ? { description: renderContextTemplate(action.description, context) } : {}),
      priority: action.priority ?? 'normal',
      ...(action.dueInDays !== undefined
        ? { dueAt: new Date(Date.now() + action.dueInDays * 86_400_000).toISOString() }
        : {}),
      assigneeId: ownerId(context, ctx.userId),
      ...links,
    });
    return { type: action.type };
  }

  if (action.type === 'send_email') {
    const to = await resolveEmail(app.db, ctx, action.to, context);
    if (!to) return { type: action.type, note: 'skipped: no recipient email resolvable' };
    await sendEmail(app.db, app.mail, ctx, {
      to: [to],
      subject: renderContextTemplate(action.subject, context),
      body: renderContextTemplate(action.body, context),
      ...(links.contactId ? { contactId: links.contactId } : {}),
      ...(links.accountId ? { accountId: links.accountId } : {}),
      ...(links.dealId ? { dealId: links.dealId } : {}),
    });
    return { type: action.type, note: `sent to ${to}` };
  }

  if (action.type === 'notify') {
    const recipient = action.recipient === 'owner' ? ownerId(context, ctx.userId) : ctx.userId;
    await pushNotification(
      app.db,
      ctx.organizationId,
      recipient,
      renderContextTemplate(action.message, context),
      links.dealId ? `/deals/${links.dealId}` : links.projectId ? `/projects/${links.projectId}` : undefined,
    );
    return { type: action.type };
  }

  if (action.type === 'analyze_deal') {
    if (!links.dealId) return { type: action.type, note: 'skipped: no deal in context' };
    if (app.jobs) {
      await app.jobs.enqueue(ANALYZE_JOB, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        dealId: links.dealId,
      } satisfies AnalyzeJobData);
      return { type: action.type, note: 'queued' };
    }
    await analyzeDeal(app.db, app.ai, ctx, links.dealId);
    return { type: action.type };
  }

  if (action.type === 'create_onboarding_project') {
    if (!links.dealId) return { type: action.type, note: 'skipped: no deal in context' };
    const project = await createProjectFromDeal(app.db, ctx, links.dealId);
    return { type: action.type, note: `project ${project.name}` };
  }

  if (action.type === 'post_message') {
    const result = await postChatMessage(
      app.db,
      app.http,
      ctx.organizationId,
      action.target,
      renderContextTemplate(action.message, context),
    );
    return { type: action.type, ...(result.posted ? {} : { note: `skipped: ${result.note}` }) };
  }

  return { type: (action as { type: string }).type, note: 'unknown action' };
}

/** Run every enabled workflow matching this event; each gets a run-log row. */
export async function executeWorkflowsForEvent(
  app: FastifyInstance,
  organizationId: string,
  userId: string,
  event: WorkflowEvent,
): Promise<void> {
  const ctx = systemContext(organizationId, userId);
  const matching = await withOrg(app.db, organizationId, (tx) =>
    tx
      .select()
      .from(workflows)
      .where(and(eq(workflows.triggerType, event.type), eq(workflows.enabled, true))),
  );

  for (const workflow of matching) {
    const conditions = workflow.conditions as WorkflowCondition[];
    const actions = workflow.actions as WorkflowAction[];
    let status: 'executed' | 'skipped' | 'failed' = 'executed';
    let error: string | null = null;
    const actionsExecuted: { type: string; note?: string }[] = [];

    if (!evaluateConditions(conditions, event.context)) {
      status = 'skipped';
    } else {
      for (const action of actions) {
        try {
          actionsExecuted.push(await executeAction(app, ctx, action, event.context));
        } catch (actionError) {
          status = 'failed';
          error = actionError instanceof Error ? actionError.message : String(actionError);
          actionsExecuted.push({ type: action.type, note: `failed: ${error}` });
          break; // remaining actions are not attempted
        }
      }
    }

    await withOrg(app.db, organizationId, (tx) =>
      tx.insert(workflowRuns).values({
        organizationId,
        workflowId: workflow.id,
        triggerType: event.type,
        status,
        context: event.context,
        actionsExecuted,
        error,
      }),
    );
  }
}

/** Emit from route handlers: async via jobs when available, inline otherwise. */
export async function emitWorkflowEvent(
  app: FastifyInstance,
  ctx: AuthContext,
  event: WorkflowEvent,
): Promise<void> {
  // External subscribers see the same events workflows do.
  await dispatchWebhooks(app, ctx.organizationId, event.type, event.context);
  // Nothing listening → skip the queue/execution entirely.
  if (!(await orgHasWorkflowFor(app.db, ctx.organizationId, event.type))) return;
  if (app.jobs) {
    await app.jobs.enqueue(WORKFLOW_JOB, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      event,
    } satisfies WorkflowJobData);
    return;
  }
  await executeWorkflowsForEvent(app, ctx.organizationId, ctx.userId, event);
}
