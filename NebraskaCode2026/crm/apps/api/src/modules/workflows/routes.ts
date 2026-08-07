import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { workflowCreateSchema, workflowUpdateSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflowRuns,
  listWorkflows,
  updateWorkflow,
  WORKFLOW_TEMPLATES,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: [app.requirePermission('workflows:manage')] };

  app.get('/workflows', manage, async (req) => ({
    workflows: await listWorkflows(app.db, req.auth!),
  }));

  app.get('/workflows/templates', manage, async () => ({ templates: WORKFLOW_TEMPLATES }));

  app.post('/workflows', manage, async (req, reply) => {
    const workflow = await createWorkflow(app.db, req.auth!, parse(workflowCreateSchema, req.body));
    return reply.code(201).send(workflow);
  });

  app.patch('/workflows/:id', manage, async (req) =>
    updateWorkflow(app.db, req.auth!, parse(idParam, req.params).id, parse(workflowUpdateSchema, req.body)),
  );

  app.delete('/workflows/:id', manage, async (req, reply) => {
    await deleteWorkflow(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/workflows/:id/runs', manage, async (req) => ({
    runs: await listWorkflowRuns(app.db, req.auth!, parse(idParam, req.params).id),
  }));
};
