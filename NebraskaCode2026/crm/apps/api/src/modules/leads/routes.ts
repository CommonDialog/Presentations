import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  leadConvertSchema,
  leadCreateSchema,
  leadQuerySchema,
  leadStatusSchema,
  leadUpdateSchema,
  paginationSchema,
} from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { emitWorkflowEvent } from '../workflows/engine.js';
import { getTimeline } from '../timeline/service.js';
import {
  archiveLead,
  changeLeadStatus,
  convertLead,
  createLead,
  getLead,
  listLeads,
  restoreLead,
  updateLead,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const leadRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('leads:read')] };
  const write = { preHandler: [app.requirePermission('leads:write')] };

  app.get('/leads', read, async (req) =>
    listLeads(app.db, req.auth!, parse(leadQuerySchema, req.query)),
  );

  app.post('/leads', write, async (req, reply) => {
    const lead = await createLead(app.db, req.auth!, parse(leadCreateSchema, req.body));
    await emitWorkflowEvent(app, req.auth!, { type: 'lead.created', context: { lead } });
    return reply.code(201).send(lead);
  });

  app.get('/leads/:id', read, async (req) =>
    getLead(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/leads/:id', write, async (req) =>
    updateLead(app.db, req.auth!, parse(idParam, req.params).id, parse(leadUpdateSchema, req.body)),
  );

  app.post('/leads/:id/status', write, async (req) =>
    changeLeadStatus(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(leadStatusSchema, req.body).status,
    ),
  );

  app.post('/leads/:id/convert', write, async (req, reply) => {
    const result = await convertLead(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(leadConvertSchema, req.body ?? {}),
    );
    return reply.code(200).send(result);
  });

  app.delete('/leads/:id', write, async (req, reply) => {
    await archiveLead(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.post('/leads/:id/restore', write, async (req, reply) => {
    await restoreLead(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/leads/:id/timeline', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const { page, pageSize } = parse(paginationSchema, req.query);
    await getLead(app.db, req.auth!, id);
    return withOrg(app.db, req.auth!.organizationId, (tx) =>
      getTimeline(tx, 'lead', id, page, pageSize),
    );
  });
};
