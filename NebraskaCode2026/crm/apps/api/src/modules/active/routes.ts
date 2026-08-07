import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/errors.js';
import {
  ANALYZE_DEBOUNCE_SECONDS,
  ANALYZE_JOB,
  analyzeDeal,
  getLatestInsight,
  type AnalyzeJobData,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

/** Fire-and-forget trigger used wherever deal-related interactions happen. */
export async function triggerDealAnalysis(
  app: FastifyInstance,
  organizationId: string,
  userId: string,
  dealId: string,
): Promise<void> {
  if (!app.jobs) return; // inline mode: analysis is on-demand only
  await app.jobs.enqueue(
    ANALYZE_JOB,
    { organizationId, userId, dealId } satisfies AnalyzeJobData,
    { singletonKey: `analyze:${dealId}`, singletonSeconds: ANALYZE_DEBOUNCE_SECONDS },
  );
}

export const activeRoutes: FastifyPluginAsync = async (app) => {
  const use = { preHandler: [app.requirePermission('ai:use')] };

  app.post('/deals/:id/analyze', use, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    if (app.jobs) {
      await app.jobs.enqueue(ANALYZE_JOB, {
        organizationId: req.auth!.organizationId,
        userId: req.auth!.userId,
        dealId: id,
      } satisfies AnalyzeJobData);
      return reply.code(202).send({ dealId: id, status: 'queued' });
    }
    const insight = await analyzeDeal(app.db, app.ai, req.auth!, id);
    return reply.code(200).send(insight);
  });

  app.get('/deals/:id/insight', use, async (req) => {
    const { id } = parse(idParam, req.params);
    const insight = await getLatestInsight(app.db, req.auth!, id);
    return { insight };
  });
};
