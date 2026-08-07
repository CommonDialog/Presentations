import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { createRole, createUser, listRoles, listUsers, updateUser } from './service.js';

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().toLowerCase(),
  password: z.string().min(10).max(200),
  roleIds: z.array(z.uuid()).min(1),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
    roleIds: z.array(z.uuid()).min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().max(300).optional(),
  permissionCodes: z.array(z.string()).min(1),
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.requirePermission('users:manage')] };

  app.get('/users', guard, async (req) => ({
    users: await listUsers(app.db, req.auth!.organizationId),
  }));

  app.post('/users', guard, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    }
    try {
      const id = await createUser(app.db, req.auth!, parsed.data);
      return reply.code(201).send({ id });
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.patch('/users/:id', guard, async (req, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid user id' });
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    }
    try {
      await updateUser(app.db, req.auth!, params.data.id, parsed.data);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get('/roles', guard, async (req) => ({
    roles: await listRoles(app.db, req.auth!.organizationId),
  }));

  app.post('/roles', guard, async (req, reply) => {
    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    }
    try {
      const id = await createRole(app.db, req.auth!, parsed.data);
      return reply.code(201).send({ id });
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get('/permissions', guard, async () => ({
    permissions: Object.entries(PERMISSIONS).map(([code, description]) => ({
      code,
      description,
    })),
  }));
};
