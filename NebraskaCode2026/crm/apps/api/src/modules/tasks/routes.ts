import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { taskCreateSchema, taskQuerySchema, taskUpdateSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { archiveTask, createTask, getTask, listTasks, updateTask } from './service.js';

const idParam = z.object({ id: z.uuid() });

export const taskRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('tasks:read')] };
  const write = { preHandler: [app.requirePermission('tasks:write')] };

  app.get('/tasks', read, async (req) =>
    listTasks(app.db, req.auth!, parse(taskQuerySchema, req.query)),
  );

  app.post('/tasks', write, async (req, reply) => {
    const task = await createTask(app.db, req.auth!, parse(taskCreateSchema, req.body));
    return reply.code(201).send(task);
  });

  app.get('/tasks/:id', read, async (req) =>
    getTask(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/tasks/:id', write, async (req) =>
    updateTask(app.db, req.auth!, parse(idParam, req.params).id, parse(taskUpdateSchema, req.body)),
  );

  app.delete('/tasks/:id', write, async (req, reply) => {
    await archiveTask(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });
};
