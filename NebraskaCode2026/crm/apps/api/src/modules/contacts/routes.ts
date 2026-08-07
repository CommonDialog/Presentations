import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { contactCreateSchema, contactQuerySchema, contactUpdateSchema, paginationSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { emitWorkflowEvent } from '../workflows/engine.js';
import { getTimeline } from '../timeline/service.js';
import {
  archiveContact,
  createContact,
  getContact,
  listContacts,
  restoreContact,
  updateContact,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const contactRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('contacts:read')] };
  const write = { preHandler: [app.requirePermission('contacts:write')] };

  app.get('/contacts', read, async (req) =>
    listContacts(app.db, req.auth!, parse(contactQuerySchema, req.query)),
  );

  app.post('/contacts', write, async (req, reply) => {
    const result = await createContact(app.db, req.auth!, parse(contactCreateSchema, req.body));
    await emitWorkflowEvent(app, req.auth!, {
      type: 'contact.created',
      context: { contact: result.contact },
    });
    return reply.code(201).send(result);
  });

  app.get('/contacts/:id', read, async (req) =>
    getContact(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/contacts/:id', write, async (req) =>
    updateContact(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(contactUpdateSchema, req.body),
    ),
  );

  app.delete('/contacts/:id', write, async (req, reply) => {
    await archiveContact(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.post('/contacts/:id/restore', write, async (req, reply) => {
    await restoreContact(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/contacts/:id/timeline', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const { page, pageSize } = parse(paginationSchema, req.query);
    await getContact(app.db, req.auth!, id);
    return withOrg(app.db, req.auth!.organizationId, (tx) =>
      getTimeline(tx, 'contact', id, page, pageSize),
    );
  });
};
