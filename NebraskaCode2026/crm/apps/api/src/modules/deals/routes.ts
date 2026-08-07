import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  dealContactAddSchema,
  dealCreateSchema,
  dealMoveSchema,
  dealQuerySchema,
  dealUpdateSchema,
  paginationSchema,
} from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { getTimeline } from '../timeline/service.js';
import { triggerDealAnalysis } from '../active/routes.js';
import { emitWorkflowEvent } from '../workflows/engine.js';
import {
  addDealContact,
  archiveDeal,
  createDeal,
  getBoard,
  getDeal,
  getForecast,
  getStageHistory,
  listDealContacts,
  listDeals,
  moveDealStage,
  removeDealContact,
  restoreDeal,
  updateDeal,
} from './service.js';

const idParam = z.object({ id: z.uuid() });
const boardQuery = z.object({ pipelineId: z.uuid().optional() });

export const dealRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('deals:read')] };
  const write = { preHandler: [app.requirePermission('deals:write')] };

  app.get('/deals', read, async (req) =>
    listDeals(app.db, req.auth!, parse(dealQuerySchema, req.query)),
  );

  app.get('/deals/board', read, async (req) =>
    getBoard(app.db, req.auth!, parse(boardQuery, req.query).pipelineId),
  );

  app.get('/deals/forecast', read, async (req) =>
    getForecast(app.db, req.auth!, parse(boardQuery, req.query).pipelineId),
  );

  app.post('/deals', write, async (req, reply) => {
    const deal = await createDeal(app.db, req.auth!, parse(dealCreateSchema, req.body));
    await emitWorkflowEvent(app, req.auth!, { type: 'deal.created', context: { deal } });
    return reply.code(201).send(deal);
  });

  app.get('/deals/:id', read, async (req) =>
    getDeal(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/deals/:id', write, async (req) =>
    updateDeal(app.db, req.auth!, parse(idParam, req.params).id, parse(dealUpdateSchema, req.body)),
  );

  app.post('/deals/:id/move', write, async (req) => {
    const { id } = parse(idParam, req.params);
    const deal = await moveDealStage(app.db, req.auth!, id, parse(dealMoveSchema, req.body));
    await triggerDealAnalysis(app, req.auth!.organizationId, req.auth!.userId, id);
    await emitWorkflowEvent(app, req.auth!, { type: 'deal.stage_changed', context: { deal } });
    if (deal.status === 'won') {
      await emitWorkflowEvent(app, req.auth!, { type: 'deal.won', context: { deal } });
    } else if (deal.status === 'lost') {
      await emitWorkflowEvent(app, req.auth!, { type: 'deal.lost', context: { deal } });
    }
    return deal;
  });

  app.delete('/deals/:id', write, async (req, reply) => {
    await archiveDeal(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.post('/deals/:id/restore', write, async (req, reply) => {
    await restoreDeal(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/deals/:id/history', read, async (req) => ({
    history: await getStageHistory(app.db, req.auth!, parse(idParam, req.params).id),
  }));

  app.get('/deals/:id/contacts', read, async (req) => ({
    contacts: await listDealContacts(app.db, req.auth!, parse(idParam, req.params).id),
  }));

  app.post('/deals/:id/contacts', write, async (req, reply) => {
    await addDealContact(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(dealContactAddSchema, req.body),
    );
    return reply.code(204).send();
  });

  app.delete('/deals/:id/contacts/:contactId', write, async (req, reply) => {
    const params = parse(z.object({ id: z.uuid(), contactId: z.uuid() }), req.params);
    await removeDealContact(app.db, req.auth!, params.id, params.contactId);
    return reply.code(204).send();
  });

  app.get('/deals/:id/timeline', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const { page, pageSize } = parse(paginationSchema, req.query);
    await getDeal(app.db, req.auth!, id);
    return withOrg(app.db, req.auth!.organizationId, (tx) =>
      getTimeline(tx, 'deal', id, page, pageSize),
    );
  });
};
