import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { exportEntityTypes, importEntityTypes, importRequestSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import type { PermissionCode } from '../auth/permissions.js';
import { exportCsv, importCsv } from './service.js';

const writePermissions: Record<string, PermissionCode> = {
  account: 'accounts:write',
  contact: 'contacts:write',
  lead: 'leads:write',
};

const readPermissions: Record<string, PermissionCode> = {
  account: 'accounts:read',
  contact: 'contacts:read',
  deal: 'deals:read',
  lead: 'leads:read',
  project: 'projects:read',
};

export const transferRoutes: FastifyPluginAsync = async (app) => {
  app.post('/import/:entityType', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { entityType } = parse(
      z.object({ entityType: z.enum(importEntityTypes) }),
      req.params,
    );
    if (!req.auth!.permissions.has(writePermissions[entityType]!)) {
      return reply.code(403).send({ error: `missing permission: ${writePermissions[entityType]}` });
    }
    const { csv } = parse(importRequestSchema, req.body);
    return importCsv(app.db, req.auth!, entityType, csv);
  });

  app.get('/export/:entityType', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { entityType } = parse(
      z.object({ entityType: z.enum(exportEntityTypes) }),
      req.params,
    );
    if (!req.auth!.permissions.has(readPermissions[entityType]!)) {
      return reply.code(403).send({ error: `missing permission: ${readPermissions[entityType]}` });
    }
    const { filename, csv } = await exportCsv(app.db, req.auth!, entityType);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });
};
