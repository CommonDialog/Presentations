import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { inboundEmailSchema, sendEmailSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { getThread, ingestInboundEmail, sendDraft, sendEmail } from './service.js';

export const emailRoutes: FastifyPluginAsync = async (app) => {
  const write = { preHandler: [app.requirePermission('activities:write')] };
  const read = { preHandler: [app.requirePermission('activities:read')] };

  // Provider webhook stand-in: real adapters (Gmail/Graph) will authenticate
  // with signed webhooks and call the same ingest service.
  app.post('/email/inbound', write, async (req, reply) => {
    const result = await ingestInboundEmail(
      app.db,
      app.ai,
      app.jobs,
      req.auth!,
      parse(inboundEmailSchema, req.body),
    );
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.post('/email/send', write, async (req, reply) => {
    const result = await sendEmail(app.db, app.mail, req.auth!, parse(sendEmailSchema, req.body));
    return reply.code(201).send(result);
  });

  app.post('/email/drafts/:activityId/send', write, async (req) => {
    const { activityId } = parse(z.object({ activityId: z.uuid() }), req.params);
    const { to } = parse(z.object({ to: z.array(z.email().toLowerCase()).min(1).max(20) }), req.body);
    return sendDraft(app.db, app.mail, req.auth!, activityId, to);
  });

  app.get('/email/threads/:threadKey', read, async (req) => {
    const { threadKey } = parse(z.object({ threadKey: z.string().min(1).max(100) }), req.params);
    return { messages: await getThread(app.db, req.auth!, threadKey) };
  });
};
