import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type {
  ChatIntegrationKind,
  IntegrationDto,
  IntegrationUpsertInput,
  WebhookCreateInput,
  WebhookDeliveryDto,
  WebhookDto,
  WebhookUpdateInput,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { integrations, webhookDeliveries, webhooks } from '../../db/schema/index.js';
import type { HttpPoster } from '../../lib/http.js';
import { cacheTtl, TtlCache } from '../../lib/cache.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import type { AuthContext } from '../auth/service.js';

// Per-org summary of subscribed webhook events ('*' = all-events hook), so
// the write path can skip the dispatch query entirely for orgs without
// webhooks — the overwhelmingly common case. CRUD invalidates in-process;
// other instances converge within the TTL.
const webhookEventCache = new TtlCache<string[]>(cacheTtl(10_000));

export function invalidateWebhookCache(organizationId: string): void {
  webhookEventCache.delete(organizationId);
}

// ---------- integration configs (Slack / Teams / LinkedIn) ----------

function integrationToDto(row: typeof integrations.$inferSelect): IntegrationDto {
  return {
    id: row.id,
    kind: row.kind as IntegrationDto['kind'],
    config: (row.config ?? {}) as IntegrationDto['config'],
    enabled: row.enabled,
  };
}

export async function listIntegrations(db: Db, ctx: AuthContext): Promise<IntegrationDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx.select().from(integrations).orderBy(integrations.kind),
  );
  return rows.map(integrationToDto);
}

export async function upsertIntegration(
  db: Db,
  ctx: AuthContext,
  input: IntegrationUpsertInput,
): Promise<IntegrationDto> {
  if ((input.kind === 'slack' || input.kind === 'teams') && input.enabled && !input.config.webhookUrl) {
    throw new ValidationError(`${input.kind} needs a webhookUrl`);
  }
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(eq(integrations.kind, input.kind))
      .limit(1);
    if (existing) {
      const [row] = await tx
        .update(integrations)
        .set({ config: input.config, enabled: input.enabled })
        .where(eq(integrations.id, existing.id))
        .returning();
      return integrationToDto(row!);
    }
    const [row] = await tx
      .insert(integrations)
      .values({
        organizationId: ctx.organizationId,
        kind: input.kind,
        config: input.config,
        enabled: input.enabled,
      })
      .returning();
    return integrationToDto(row!);
  });
}

/** Chat webhook URL for an org, or null when unconfigured/disabled. */
export async function getChatWebhookUrl(
  db: Db,
  organizationId: string,
  kind: ChatIntegrationKind,
): Promise<string | null> {
  const rows = await withOrg(db, organizationId, (tx) =>
    tx.select().from(integrations).where(and(eq(integrations.kind, kind), eq(integrations.enabled, true))).limit(1),
  );
  const config = rows[0] ? ((rows[0].config ?? {}) as { webhookUrl?: string }) : {};
  return config.webhookUrl ?? null;
}

/** Slack and Teams incoming webhooks both accept a simple {text} payload. */
export function chatPayload(message: string): string {
  return JSON.stringify({ text: message });
}

export async function postChatMessage(
  db: Db,
  http: HttpPoster,
  organizationId: string,
  kind: ChatIntegrationKind,
  message: string,
): Promise<{ posted: boolean; note?: string }> {
  const url = await getChatWebhookUrl(db, organizationId, kind);
  if (!url) return { posted: false, note: `${kind} is not configured` };
  const result = await http.post(url, chatPayload(message));
  if (!result.ok) {
    return { posted: false, note: `${kind} returned ${result.status}${result.error ? ` (${result.error})` : ''}` };
  }
  return { posted: true };
}

// ---------- outbound webhooks ----------

function webhookToDto(row: typeof webhooks.$inferSelect): WebhookDto {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: (row.events ?? []) as string[],
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listWebhooks(db: Db, ctx: AuthContext): Promise<WebhookDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx.select().from(webhooks).orderBy(webhooks.createdAt),
  );
  return rows.map(webhookToDto);
}

export async function createWebhook(
  db: Db,
  ctx: AuthContext,
  input: WebhookCreateInput,
): Promise<WebhookDto> {
  invalidateWebhookCache(ctx.organizationId);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .insert(webhooks)
      .values({
        organizationId: ctx.organizationId,
        url: input.url,
        secret: input.secret ?? randomBytes(24).toString('hex'),
        events: input.events,
        enabled: input.enabled,
        createdBy: ctx.userId,
      })
      .returning();
    return webhookToDto(row!);
  });
}

export async function updateWebhook(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: WebhookUpdateInput,
): Promise<WebhookDto> {
  invalidateWebhookCache(ctx.organizationId);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .update(webhooks)
      .set({
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      })
      .where(eq(webhooks.id, id))
      .returning();
    if (!row) throw new NotFoundError('webhook not found');
    return webhookToDto(row);
  });
}

export async function deleteWebhook(db: Db, ctx: AuthContext, id: string): Promise<void> {
  invalidateWebhookCache(ctx.organizationId);
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
    if (!row) throw new NotFoundError('webhook not found');
  });
}

export async function listWebhookDeliveries(
  db: Db,
  ctx: AuthContext,
  webhookId: string,
): Promise<WebhookDeliveryDto[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [hook] = await tx.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);
    if (!hook) throw new NotFoundError('webhook not found');
    const rows = await tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      status: r.status as 'delivered' | 'failed',
      statusCode: r.statusCode,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

// ---------- delivery ----------

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export interface WebhookJobData {
  organizationId: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
}

export const WEBHOOK_JOB = 'webhook.deliver';

/** POST one event to one webhook, recording the delivery. */
export async function deliverWebhook(
  app: FastifyInstance,
  data: WebhookJobData,
): Promise<void> {
  const [hook] = await withOrg(app.db, data.organizationId, (tx) =>
    tx.select().from(webhooks).where(eq(webhooks.id, data.webhookId)).limit(1),
  );
  if (!hook || !hook.enabled) return;

  const body = JSON.stringify({ event: data.event, data: data.payload });
  const result = await app.http.post(hook.url, body, {
    'X-CRM-Event': data.event,
    'X-CRM-Signature': signWebhookPayload(hook.secret, body),
  });

  await withOrg(app.db, data.organizationId, (tx) =>
    tx.insert(webhookDeliveries).values({
      organizationId: data.organizationId,
      webhookId: data.webhookId,
      event: data.event,
      payload: data.payload,
      status: result.ok ? 'delivered' : 'failed',
      statusCode: result.status || null,
      error: result.error ?? (result.ok ? null : `HTTP ${result.status}`),
    }),
  );
}

/** Cached: does this org have any enabled webhook subscribed to `event`? */
async function orgHasWebhookFor(db: Db, organizationId: string, event: string): Promise<boolean> {
  let summary = webhookEventCache.get(organizationId);
  if (summary === undefined) {
    const rows = await withOrg(db, organizationId, (tx) =>
      tx.select({ events: webhooks.events }).from(webhooks).where(eq(webhooks.enabled, true)),
    );
    summary = rows.flatMap((r) => {
      const events = (r.events ?? []) as string[];
      return events.length === 0 ? ['*'] : events;
    });
    webhookEventCache.set(organizationId, summary);
  }
  return summary.includes('*') || summary.includes(event);
}

/** Fan an event out to every subscribed webhook (async via jobs when available). */
export async function dispatchWebhooks(
  app: FastifyInstance,
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!(await orgHasWebhookFor(app.db, organizationId, event))) return;
  const hooks = await withOrg(app.db, organizationId, (tx) =>
    tx.select().from(webhooks).where(eq(webhooks.enabled, true)),
  );
  const matching = hooks.filter((h) => {
    const events = (h.events ?? []) as string[];
    return events.length === 0 || events.includes(event);
  });
  for (const hook of matching) {
    const data: WebhookJobData = { organizationId, webhookId: hook.id, event, payload };
    if (app.jobs) {
      await app.jobs.enqueue(WEBHOOK_JOB, data);
    } else {
      await deliverWebhook(app, data);
    }
  }
}
