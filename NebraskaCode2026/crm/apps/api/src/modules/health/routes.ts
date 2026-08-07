import type { FastifyPluginCallback } from 'fastify';
import type { HealthResponse } from '@crm/shared';

export const healthRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));
  done();
};
