import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/errors.js';
import { listNotifications, markNotificationRead } from './service.js';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notifications', { preHandler: [app.authenticate] }, async (req) =>
    listNotifications(app.db, req.auth!),
  );

  app.post('/notifications/:id/read', { preHandler: [app.authenticate] }, async (req, reply) => {
    await markNotificationRead(app.db, req.auth!, parse(z.object({ id: z.uuid() }), req.params).id);
    return reply.code(204).send();
  });
};
