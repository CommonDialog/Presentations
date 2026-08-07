import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { accountCreateSchema, accountQuerySchema, accountUpdateSchema, paginationSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { getTimeline } from '../timeline/service.js';
import {
  archiveAccount,
  createAccount,
  getAccount,
  listAccounts,
  restoreAccount,
  updateAccount,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const accountRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('accounts:read')] };
  const write = { preHandler: [app.requirePermission('accounts:write')] };

  app.get('/accounts', read, async (req) =>
    listAccounts(app.db, req.auth!, parse(accountQuerySchema, req.query)),
  );

  app.post('/accounts', write, async (req, reply) => {
    const account = await createAccount(app.db, req.auth!, parse(accountCreateSchema, req.body));
    return reply.code(201).send(account);
  });

  app.get('/accounts/:id', read, async (req) =>
    getAccount(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/accounts/:id', write, async (req) =>
    updateAccount(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(accountUpdateSchema, req.body),
    ),
  );

  app.delete('/accounts/:id', write, async (req, reply) => {
    await archiveAccount(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.post('/accounts/:id/restore', write, async (req, reply) => {
    await restoreAccount(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/accounts/:id/timeline', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const { page, pageSize } = parse(paginationSchema, req.query);
    await getAccount(app.db, req.auth!, id); // 404 if not visible in this org
    return withOrg(app.db, req.auth!.organizationId, (tx) =>
      getTimeline(tx, 'account', id, page, pageSize),
    );
  });
};
