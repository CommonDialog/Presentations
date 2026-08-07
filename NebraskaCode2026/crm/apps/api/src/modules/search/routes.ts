import type { FastifyPluginAsync } from 'fastify';
import { nlSearchInputSchema, searchQuerySchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { globalSearch, nlSearch } from './service.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // Any signed-in user can search; per-type visibility is enforced by the
  // caller's read permissions inside the service.
  app.get('/search', { preHandler: [app.authenticate] }, async (req) => {
    const { q, types, limit } = parse(searchQuerySchema, req.query);
    return globalSearch(app.db, req.auth!, { q, types, limit });
  });

  app.post('/search/ask', { preHandler: [app.authenticate] }, async (req) => {
    const { query } = parse(nlSearchInputSchema, req.body);
    return nlSearch(app.db, app.ai, req.auth!, query);
  });
};
