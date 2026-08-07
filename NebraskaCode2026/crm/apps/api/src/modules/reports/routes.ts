import type { FastifyPluginAsync } from 'fastify';
import { reportPeriodSchema, revenueQuerySchema, stalledQuerySchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import {
  activityReport,
  customerHealthReport,
  projectHealthReport,
  revenueReport,
  salesReport,
  stalledReport,
  velocityReport,
} from './service.js';

export const reportRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('reports:read')] };

  app.get('/reports/sales', read, async (req) => {
    const { days, pipelineId } = parse(reportPeriodSchema, req.query);
    return salesReport(app.db, req.auth!, days, pipelineId);
  });

  app.get('/reports/velocity', read, async (req) => {
    const { days, pipelineId } = parse(reportPeriodSchema, req.query);
    return velocityReport(app.db, req.auth!, days, pipelineId);
  });

  app.get('/reports/stalled', read, async (req) => {
    const { idleDays } = parse(stalledQuerySchema, req.query);
    return stalledReport(app.db, req.auth!, idleDays);
  });

  app.get('/reports/revenue', read, async (req) => {
    const { months } = parse(revenueQuerySchema, req.query);
    return revenueReport(app.db, req.auth!, months);
  });

  app.get('/reports/activity', read, async (req) => {
    const { days } = parse(reportPeriodSchema, req.query);
    return activityReport(app.db, req.auth!, days);
  });

  app.get('/reports/projects', read, async (req) => projectHealthReport(app.db, req.auth!));

  app.get('/reports/customers', read, async (req) => customerHealthReport(app.db, req.auth!));
};
