import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { proposalRejectSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { approveProposal, listProposals, rejectProposal } from './service.js';

const idParam = z.object({ id: z.uuid() });
const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'applied']).optional(),
});

export const proposalRoutes: FastifyPluginAsync = async (app) => {
  app.get('/proposals', { preHandler: [app.requirePermission('ai:use')] }, async (req) => ({
    proposals: await listProposals(app.db, req.auth!, parse(listQuery, req.query).status),
  }));

  app.post(
    '/proposals/:id/approve',
    { preHandler: [app.requirePermission('ai:review')] },
    async (req) => approveProposal(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.post(
    '/proposals/:id/reject',
    { preHandler: [app.requirePermission('ai:review')] },
    async (req) =>
      rejectProposal(
        app.db,
        req.auth!,
        parse(idParam, req.params).id,
        parse(proposalRejectSchema, req.body ?? {}).reason,
      ),
  );
};
