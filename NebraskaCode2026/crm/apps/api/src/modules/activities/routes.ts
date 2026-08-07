import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { activityCreateSchema, activityQuerySchema, activityUpdateSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { triggerDealAnalysis } from '../active/routes.js';
import {
  archiveActivity,
  createActivity,
  getActivity,
  listActivities,
  restoreActivity,
  updateActivity,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const activityRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('activities:read')] };
  const write = { preHandler: [app.requirePermission('activities:write')] };

  app.get('/activities', read, async (req) =>
    listActivities(app.db, req.auth!, parse(activityQuerySchema, req.query)),
  );

  app.post('/activities', write, async (req, reply) => {
    const input = parse(activityCreateSchema, req.body);
    const activity = await createActivity(app.db, req.auth!, input);
    // Active CRM: a new interaction on a deal schedules (debounced) re-analysis.
    for (const dealId of input.links.deals ?? []) {
      await triggerDealAnalysis(app, req.auth!.organizationId, req.auth!.userId, dealId);
    }
    return reply.code(201).send(activity);
  });

  app.get('/activities/:id', read, async (req) =>
    getActivity(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/activities/:id', write, async (req) =>
    updateActivity(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(activityUpdateSchema, req.body),
    ),
  );

  app.delete('/activities/:id', write, async (req, reply) => {
    await archiveActivity(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.post('/activities/:id/restore', write, async (req, reply) => {
    await restoreActivity(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });
};
