import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAuthContext, type AuthContext } from './service.js';
import { getAuthContextForApiKey } from '../integrations/apiKeys.js';
import { TtlCache } from '../../lib/cache.js';
import type { PermissionCode } from './permissions.js';

export const SESSION_COOKIE = 'sid';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    sessionId: string | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      code: PermissionCode,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Drop a cached session context immediately (logout). */
    invalidateAuthCache: (sessionId: string) => void;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('auth', null);
  app.decorateRequest('sessionId', null);

  // Auth runs on every request: 1 join + a permission query in a transaction.
  // A short TTL cache turns that into a Map lookup for the hot path. Logout
  // deletes its entry; role/deactivation edits propagate within the TTL.
  const sessionCache = new TtlCache<AuthContext>(app.config.AUTH_CACHE_TTL_MS);
  const apiKeyCache = new TtlCache<AuthContext>(app.config.AUTH_CACHE_TTL_MS);

  app.decorate('invalidateAuthCache', (sessionId: string) => {
    sessionCache.delete(sessionId);
  });

  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // REST API access: Authorization: Bearer crm_<token>
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      let ctx = apiKeyCache.get(token) ?? null;
      if (!ctx) {
        ctx = await getAuthContextForApiKey(app.db, token);
        if (ctx) apiKeyCache.set(token, ctx);
      }
      if (ctx) {
        req.auth = ctx;
        return;
      }
      await reply.code(401).send({ error: 'invalid API key' });
      return;
    }

    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        let ctx = sessionCache.get(unsigned.value) ?? null;
        if (!ctx) {
          ctx = await getAuthContext(app.db, unsigned.value);
          if (ctx) sessionCache.set(unsigned.value, ctx);
        }
        if (ctx) {
          req.auth = ctx;
          req.sessionId = unsigned.value;
          return;
        }
      }
    }
    await reply.code(401).send({ error: 'authentication required' });
  }

  app.decorate('authenticate', authenticate);

  app.decorate('requirePermission', (code: PermissionCode) => {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await authenticate(req, reply);
      if (reply.sent) return;
      if (!req.auth!.permissions.has(code)) {
        await reply.code(403).send({ error: `missing permission: ${code}` });
      }
    };
  });
});
