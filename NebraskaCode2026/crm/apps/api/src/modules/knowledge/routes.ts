import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { captureInputSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { triggerDealAnalysis } from '../active/routes.js';
import { analyzeCapture, captureSource, getCaptureResult } from './service.js';

export interface CaptureJobData {
  organizationId: string;
  userId: string;
  activityId: string;
  sourceType: 'email' | 'meeting_transcript' | 'call_transcript';
  content: string;
  links: {
    accountId?: string | undefined;
    contactId?: string | undefined;
    dealId?: string | undefined;
    leadId?: string | undefined;
  };
}

export const CAPTURE_JOB = 'knowledge.capture';

export const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  const use = { preHandler: [app.requirePermission('ai:use')] };

  app.post('/capture', use, async (req, reply) => {
    const input = parse(captureInputSchema, req.body);
    const { activityId } = await captureSource(app.db, req.auth!, input);
    if (input.dealId) {
      await triggerDealAnalysis(app, req.auth!.organizationId, req.auth!.userId, input.dealId);
    }
    const links = {
      accountId: input.accountId,
      contactId: input.contactId,
      dealId: input.dealId,
      leadId: input.leadId,
    };

    if (app.jobs) {
      await app.jobs.enqueue(CAPTURE_JOB, {
        organizationId: req.auth!.organizationId,
        userId: req.auth!.userId,
        activityId,
        sourceType: input.sourceType,
        content: input.content,
        links,
      } satisfies CaptureJobData);
      return reply.code(202).send({ activityId, status: 'queued' });
    }

    const result = await analyzeCapture(app.db, app.ai, req.auth!, {
      activityId,
      sourceType: input.sourceType,
      content: input.content,
      links,
    });
    return reply.code(200).send(result);
  });

  app.get('/captures/:activityId', use, async (req) => {
    const { activityId } = parse(z.object({ activityId: z.uuid() }), req.params);
    return getCaptureResult(app.db, req.auth!, activityId);
  });
};
