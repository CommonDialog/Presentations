import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  apiKeyCreateSchema,
  chatIntegrationKinds,
  integrationUpsertSchema,
  webhookCreateSchema,
  webhookUpdateSchema,
} from '@crm/shared';
import { parse } from '../../lib/errors.js';
import { createApiKey, listApiKeys, revokeApiKey } from './apiKeys.js';
import {
  createWebhook,
  deleteWebhook,
  listIntegrations,
  listWebhookDeliveries,
  listWebhooks,
  postChatMessage,
  updateWebhook,
  upsertIntegration,
} from './service.js';

const idParam = z.object({ id: z.uuid() });

export const integrationRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: [app.requirePermission('settings:manage')] };

  // ---- chat + provider configs ----
  app.get('/integrations', manage, async (req) => ({
    integrations: await listIntegrations(app.db, req.auth!),
    enrichmentProvider: app.enrichment.name,
  }));

  app.put('/integrations', manage, async (req) =>
    upsertIntegration(app.db, req.auth!, parse(integrationUpsertSchema, req.body)),
  );

  app.post('/integrations/:kind/test', manage, async (req) => {
    const { kind } = parse(z.object({ kind: z.enum(chatIntegrationKinds) }), req.params);
    return postChatMessage(
      app.db,
      app.http,
      req.auth!.organizationId,
      kind,
      `👋 Test message from ${req.auth!.organizationName} CRM`,
    );
  });

  // ---- API keys (REST API access) ----
  app.get('/integrations/api-keys', manage, async (req) => ({
    keys: await listApiKeys(app.db, req.auth!),
  }));

  app.post('/integrations/api-keys', manage, async (req, reply) => {
    const { name } = parse(apiKeyCreateSchema, req.body);
    return reply.code(201).send(await createApiKey(app.db, req.auth!, name));
  });

  app.delete('/integrations/api-keys/:id', manage, async (req, reply) => {
    await revokeApiKey(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  // ---- outbound webhooks ----
  app.get('/integrations/webhooks', manage, async (req) => ({
    webhooks: await listWebhooks(app.db, req.auth!),
  }));

  app.post('/integrations/webhooks', manage, async (req, reply) =>
    reply.code(201).send(await createWebhook(app.db, req.auth!, parse(webhookCreateSchema, req.body))),
  );

  app.patch('/integrations/webhooks/:id', manage, async (req) =>
    updateWebhook(app.db, req.auth!, parse(idParam, req.params).id, parse(webhookUpdateSchema, req.body)),
  );

  app.delete('/integrations/webhooks/:id', manage, async (req, reply) => {
    await deleteWebhook(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/integrations/webhooks/:id/deliveries', manage, async (req) => ({
    deliveries: await listWebhookDeliveries(app.db, req.auth!, parse(idParam, req.params).id),
  }));
};
