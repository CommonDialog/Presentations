import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { loginSchema, registerSchema, type MeResponse } from '@crm/shared';
import { ConflictError } from '../../lib/errors.js';
import { login, logout, registerOrganization, SESSION_TTL_MS } from './service.js';
import { SESSION_COOKIE } from './plugin.js';

function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const loginRateLimit =
    app.config.NODE_ENV === 'test'
      ? {}
      : { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/auth/register', { config: loginRateLimit }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    }
    try {
      const result = await registerOrganization(app.db, parsed.data);
      setSessionCookie(reply, result.sessionId);
      return reply
        .code(201)
        .send({ userId: result.userId, organizationId: result.organizationId });
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post('/auth/login', { config: loginRateLimit }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    }
    const result = await login(app.db, parsed.data);
    if (!result) return reply.code(401).send({ error: 'invalid credentials' });
    setSessionCookie(reply, result.sessionId);
    return reply.code(200).send({ userId: result.userId });
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (req, reply) => {
    await logout(app.db, req.sessionId!, req.auth!);
    app.invalidateAuthCache(req.sessionId!);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req): Promise<MeResponse> => {
    const auth = req.auth!;
    return {
      user: { id: auth.userId, name: auth.userName, email: auth.email },
      organization: {
        id: auth.organizationId,
        name: auth.organizationName,
        slug: auth.organizationSlug,
      },
      permissions: [...auth.permissions].sort(),
    };
  });
};
