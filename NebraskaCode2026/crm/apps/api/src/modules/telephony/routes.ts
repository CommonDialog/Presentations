import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { completeCallSchema, dispositionSchema, initiateCallSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { triggerDealAnalysis } from '../active/routes.js';
import { getActivity } from '../activities/service.js';
import { completeCall, initiateCall, setCallDisposition } from './service.js';

const idParam = z.object({ activityId: z.uuid() });

export const telephonyRoutes: FastifyPluginAsync = async (app) => {
  const write = { preHandler: [app.requirePermission('activities:write')] };

  app.post('/calls', write, async (req, reply) => {
    const result = await initiateCall(
      app.db,
      app.telephony,
      req.auth!,
      parse(initiateCallSchema, req.body),
    );
    return reply.code(201).send(result);
  });

  app.post('/calls/:activityId/complete', write, async (req, reply) => {
    const { activityId } = parse(idParam, req.params);
    const input = parse(completeCallSchema, req.body);
    const result = await completeCall(app.db, app.ai, app.jobs, req.auth!, activityId, input);
    // a finished call is a deal interaction — schedule (debounced) re-analysis
    const call = await getActivity(app.db, req.auth!, activityId);
    for (const deal of call.links.deals) {
      await triggerDealAnalysis(app, req.auth!.organizationId, req.auth!.userId, deal.id);
    }
    return reply.code(result.analysisQueued ? 202 : 200).send(result);
  });

  app.post('/calls/:activityId/disposition', write, async (req, reply) => {
    const { activityId } = parse(idParam, req.params);
    const { disposition, notes } = parse(dispositionSchema, req.body);
    await setCallDisposition(app.db, req.auth!, activityId, disposition, notes);
    return reply.code(204).send();
  });
};
