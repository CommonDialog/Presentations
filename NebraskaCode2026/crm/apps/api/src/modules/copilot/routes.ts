import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { copilotAskSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { getConversation, listConversations } from '../../ai/conversations.js';
import { copilotAsk } from './service.js';

export const copilotRoutes: FastifyPluginAsync = async (app) => {
  const use = { preHandler: [app.requirePermission('ai:use')] };

  app.post('/copilot/ask', use, async (req) =>
    copilotAsk(app, req.auth!, parse(copilotAskSchema, req.body)),
  );

  app.get('/copilot/conversations', use, async (req) => ({
    conversations: await listConversations(app.db, req.auth!),
  }));

  app.get('/copilot/conversations/:id', use, async (req) =>
    getConversation(app.db, req.auth!, parse(z.object({ id: z.uuid() }), req.params).id),
  );
};
