import type { FastifyPluginAsync } from 'fastify';
import { paginationSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { getOrgTimeline } from './service.js';

export const timelineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/timeline', { preHandler: [app.requirePermission('activities:read')] }, async (req) => {
    const { page, pageSize } = parse(paginationSchema, req.query);
    return withOrg(app.db, req.auth!.organizationId, (tx) => getOrgTimeline(tx, page, pageSize));
  });
};
