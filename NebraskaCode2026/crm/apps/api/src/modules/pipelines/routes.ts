import type { FastifyPluginAsync } from 'fastify';
import { listPipelines } from './service.js';

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/pipelines', { preHandler: [app.requirePermission('deals:read')] }, async (req) => ({
    pipelines: await listPipelines(app.db, req.auth!.organizationId),
  }));
};
