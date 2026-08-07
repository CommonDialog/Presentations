import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createProjectFromDealSchema,
  dependencySchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  paginationSchema,
  projectCreateSchema,
  projectQuerySchema,
  projectUpdateSchema,
} from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { getTimeline } from '../timeline/service.js';
import {
  addTaskDependency,
  createMilestone,
  createProject,
  createProjectFromDeal,
  deleteMilestone,
  getProject,
  getProjectBoard,
  getProjectGantt,
  listMilestones,
  listProjects,
  removeTaskDependency,
  updateMilestone,
  updateProject,
} from './service.js';
import { disablePortal, enablePortal, getPortalView } from './portal.js';
import { emitWorkflowEvent } from '../workflows/engine.js';

const idParam = z.object({ id: z.uuid() });

export const projectRoutes: FastifyPluginAsync = async (app) => {
  const read = { preHandler: [app.requirePermission('projects:read')] };
  const write = { preHandler: [app.requirePermission('projects:write')] };

  app.get('/projects', read, async (req) =>
    listProjects(app.db, req.auth!, parse(projectQuerySchema, req.query)),
  );

  app.post('/projects', write, async (req, reply) => {
    const project = await createProject(app.db, req.auth!, parse(projectCreateSchema, req.body));
    await emitWorkflowEvent(app, req.auth!, { type: 'project.created', context: { project } });
    return reply.code(201).send(project);
  });

  app.get('/projects/:id', read, async (req) =>
    getProject(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.patch('/projects/:id', write, async (req) =>
    updateProject(app.db, req.auth!, parse(idParam, req.params).id, parse(projectUpdateSchema, req.body)),
  );

  app.get('/projects/:id/timeline', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const { page, pageSize } = parse(paginationSchema, req.query);
    await getProject(app.db, req.auth!, id);
    return withOrg(app.db, req.auth!.organizationId, (tx) =>
      getTimeline(tx, 'project', id, page, pageSize),
    );
  });

  // milestones
  app.get('/projects/:id/milestones', read, async (req) => ({
    milestones: await listMilestones(app.db, req.auth!, parse(idParam, req.params).id),
  }));

  app.post('/projects/:id/milestones', write, async (req, reply) => {
    const milestone = await createMilestone(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(milestoneCreateSchema, req.body),
    );
    return reply.code(201).send(milestone);
  });

  app.patch('/milestones/:id', write, async (req) =>
    updateMilestone(app.db, req.auth!, parse(idParam, req.params).id, parse(milestoneUpdateSchema, req.body)),
  );

  app.delete('/milestones/:id', write, async (req, reply) => {
    await deleteMilestone(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  // dependencies
  app.post('/tasks/:id/dependencies', { preHandler: [app.requirePermission('tasks:write')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { dependsOnTaskId } = parse(dependencySchema, req.body);
    await addTaskDependency(app.db, req.auth!, id, dependsOnTaskId);
    return reply.code(204).send();
  });

  app.delete(
    '/tasks/:id/dependencies/:dependsOnTaskId',
    { preHandler: [app.requirePermission('tasks:write')] },
    async (req, reply) => {
      const params = parse(z.object({ id: z.uuid(), dependsOnTaskId: z.uuid() }), req.params);
      await removeTaskDependency(app.db, req.auth!, params.id, params.dependsOnTaskId);
      return reply.code(204).send();
    },
  );

  // board & gantt
  app.get('/projects/:id/board', read, async (req) =>
    getProjectBoard(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.get('/projects/:id/gantt', read, async (req) =>
    getProjectGantt(app.db, req.auth!, parse(idParam, req.params).id),
  );

  // onboarding from a won deal
  app.post('/deals/:id/create-project', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { name } = parse(createProjectFromDealSchema, req.body ?? {});
    const project = await createProjectFromDeal(app.db, req.auth!, id, name);
    return reply.code(201).send(project);
  });

  // customer portal management
  app.post('/projects/:id/portal', write, async (req) =>
    enablePortal(app.db, req.auth!, parse(idParam, req.params).id),
  );

  app.delete('/projects/:id/portal', write, async (req, reply) => {
    await disablePortal(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  // PUBLIC portal view — token is the capability, no session required
  app.get('/portal/:token', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.params);
    return getPortalView(app.db, token);
  });
};
