import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/errors.js';
import { enrichAccount, enrichContact } from './service.js';

const idParam = z.object({ id: z.uuid() });

export const enrichmentRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/enrich/accounts/:id',
    { preHandler: [app.requirePermission('accounts:write')] },
    async (req) => enrichAccount(app.db, app.enrichment, req.auth!, parse(idParam, req.params).id),
  );

  app.post(
    '/enrich/contacts/:id',
    { preHandler: [app.requirePermission('contacts:write')] },
    async (req) => enrichContact(app.db, app.enrichment, req.auth!, parse(idParam, req.params).id),
  );
};
