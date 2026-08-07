import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, gte, sql } from 'drizzle-orm';
import { aiCalls } from '../db/schema/index.js';
import { parse } from '../lib/errors.js';
import { withOrg } from '../lib/tenant.js';
import { listPrompts, updatePrompt } from './prompts.js';

const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

const promptUpdateSchema = z
  .object({
    systemTemplate: z.string().min(1).max(20000).optional(),
    userTemplate: z.string().min(1).max(20000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ai/usage', { preHandler: [app.requirePermission('ai:use')] }, async (req) => {
    const { days } = parse(usageQuery, req.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return withOrg(app.db, req.auth!.organizationId, async (tx) => {
      const [totals] = await tx
        .select({
          calls: sql<number>`count(*)::int`,
          failures: sql<number>`count(*) filter (where not success)::int`,
          inputTokens: sql<number>`coalesce(sum(input_tokens), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(output_tokens), 0)::int`,
          costUsd: sql<string>`coalesce(sum(cost_usd), 0)::text`,
        })
        .from(aiCalls)
        .where(and(gte(aiCalls.createdAt, since)));
      const byPurpose = await tx
        .select({
          purpose: aiCalls.purpose,
          calls: sql<number>`count(*)::int`,
          costUsd: sql<string>`coalesce(sum(cost_usd), 0)::text`,
        })
        .from(aiCalls)
        .where(and(gte(aiCalls.createdAt, since)))
        .groupBy(aiCalls.purpose)
        .orderBy(sql`sum(cost_usd) desc nulls last`);
      return { days, totals, byPurpose };
    });
  });

  app.get('/ai/prompts', { preHandler: [app.requirePermission('settings:manage')] }, async () => ({
    prompts: await listPrompts(app.db),
  }));

  app.put(
    '/ai/prompts/:name',
    { preHandler: [app.requirePermission('settings:manage')] },
    async (req) => {
      const { name } = parse(z.object({ name: z.string().min(1) }), req.params);
      const body = parse(promptUpdateSchema, req.body);
      return updatePrompt(app.db, name, body);
    },
  );
};
