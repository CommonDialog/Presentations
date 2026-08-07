import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loadConfig, type Config } from './config.js';
import { createDb, type Db } from './db/client.js';
import {
  ConflictError,
  NotFoundError,
  RequestValidationError,
  ValidationError,
} from './lib/errors.js';
import { authPlugin } from './modules/auth/plugin.js';
import { seedPermissions } from './modules/auth/service.js';
import { AiService } from './ai/service.js';
import { AnthropicProvider } from './ai/anthropicProvider.js';
import { FakeEmbeddingProvider, FakeLlmProvider } from './ai/fakeProvider.js';
import { seedPrompts } from './ai/prompts.js';
import { aiRoutes } from './ai/routes.js';
import type { EmbeddingProvider, LlmProvider } from './ai/types.js';
import type { JobRunner } from './lib/jobs.js';
import { knowledgeRoutes } from './modules/knowledge/routes.js';
import { proposalRoutes } from './modules/proposals/routes.js';
import { activeRoutes } from './modules/active/routes.js';
import { emailRoutes } from './modules/email/routes.js';
import { FakeMailProvider, type MailProvider } from './modules/email/provider.js';
import { calendarRoutes } from './modules/calendar/routes.js';
import { FakeCalendarProvider, type CalendarProvider } from './modules/calendar/provider.js';
import { telephonyRoutes } from './modules/telephony/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { FakeTelephonyProvider, type TelephonyProvider } from './modules/telephony/provider.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { pipelineRoutes } from './modules/pipelines/routes.js';
import { leadRoutes } from './modules/leads/routes.js';
import { dealRoutes } from './modules/deals/routes.js';
import { activityRoutes } from './modules/activities/routes.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { timelineRoutes } from './modules/timeline/routes.js';
import { workflowRoutes } from './modules/workflows/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { searchRoutes } from './modules/search/routes.js';
import { customizationRoutes } from './modules/customization/routes.js';
import { integrationRoutes } from './modules/integrations/routes.js';
import { transferRoutes } from './modules/transfer/routes.js';
import { enrichmentRoutes } from './modules/enrichment/routes.js';
import { copilotRoutes } from './modules/copilot/routes.js';
import { FetchHttpPoster, type HttpPoster } from './lib/http.js';
import { FakeLinkedInProvider, type EnrichmentProvider } from './modules/enrichment/provider.js';

export interface AppOptions {
  config?: Config;
  db?: Db;
  logger?: boolean;
  llm?: LlmProvider;
  embedder?: EmbeddingProvider;
  /** When provided, capture analysis runs as background jobs instead of inline. */
  jobs?: JobRunner;
  mail?: MailProvider;
  calendar?: CalendarProvider;
  telephony?: TelephonyProvider;
  http?: HttpPoster;
  enrichment?: EnrichmentProvider;
}

function resolveLlm(config: Config, override?: LlmProvider): LlmProvider {
  if (override) return override;
  const useAnthropic =
    config.AI_PROVIDER === 'anthropic' ||
    (config.AI_PROVIDER === 'auto' && Boolean(config.ANTHROPIC_API_KEY));
  if (useAnthropic) {
    if (!config.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
    return new AnthropicProvider(config.ANTHROPIC_API_KEY, config.AI_MODEL);
  }
  // Non-strict: without an API key the app still works end-to-end, returning
  // schema-valid placeholder output instead of erroring.
  return new FakeLlmProvider({ strictStructured: false });
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? config.NODE_ENV !== 'test' });

  app.decorate('config', config);

  if (options.db) {
    app.decorate('db', options.db);
  } else {
    const { db, pool } = createDb(config.DATABASE_URL, { poolMax: config.DB_POOL_MAX });
    app.decorate('db', db);
    app.addHook('onClose', async () => {
      await pool.end();
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof RequestValidationError) {
      return reply.code(400).send({ error: 'validation failed', issues: err.issues });
    }
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    const httpErr = err as { statusCode?: unknown; message?: unknown };
    if (typeof httpErr.statusCode === 'number' && httpErr.statusCode < 500) {
      return reply.code(httpErr.statusCode).send({ error: String(httpErr.message ?? 'error') });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal server error' });
  });

  app.register(cookie, { secret: config.SESSION_SECRET });
  app.register(rateLimit, { global: false });
  app.register(authPlugin);

  app.decorate(
    'ai',
    new AiService(app.db, resolveLlm(config, options.llm), options.embedder ?? new FakeEmbeddingProvider()),
  );
  app.decorate('jobs', options.jobs ?? null);
  app.decorate('mail', options.mail ?? new FakeMailProvider());
  app.decorate('calendar', options.calendar ?? new FakeCalendarProvider());
  app.decorate('telephony', options.telephony ?? new FakeTelephonyProvider());
  app.decorate('http', options.http ?? new FetchHttpPoster());
  app.decorate('enrichment', options.enrichment ?? new FakeLinkedInProvider());

  app.addHook('onReady', async () => {
    await seedPermissions(app.db);
    await seedPrompts(app.db);
  });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });
  app.register(userRoutes, { prefix: '/api' });
  app.register(accountRoutes, { prefix: '/api' });
  app.register(contactRoutes, { prefix: '/api' });
  app.register(pipelineRoutes, { prefix: '/api' });
  app.register(leadRoutes, { prefix: '/api' });
  app.register(dealRoutes, { prefix: '/api' });
  app.register(activityRoutes, { prefix: '/api' });
  app.register(taskRoutes, { prefix: '/api' });
  app.register(timelineRoutes, { prefix: '/api' });
  app.register(aiRoutes, { prefix: '/api' });
  app.register(knowledgeRoutes, { prefix: '/api' });
  app.register(proposalRoutes, { prefix: '/api' });
  app.register(activeRoutes, { prefix: '/api' });
  app.register(emailRoutes, { prefix: '/api' });
  app.register(calendarRoutes, { prefix: '/api' });
  app.register(telephonyRoutes, { prefix: '/api' });
  app.register(projectRoutes, { prefix: '/api' });
  app.register(workflowRoutes, { prefix: '/api' });
  app.register(notificationRoutes, { prefix: '/api' });
  app.register(reportRoutes, { prefix: '/api' });
  app.register(searchRoutes, { prefix: '/api' });
  app.register(customizationRoutes, { prefix: '/api' });
  app.register(integrationRoutes, { prefix: '/api' });
  app.register(transferRoutes, { prefix: '/api' });
  app.register(enrichmentRoutes, { prefix: '/api' });
  app.register(copilotRoutes, { prefix: '/api' });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    ai: AiService;
    jobs: JobRunner | null;
    mail: MailProvider;
    calendar: CalendarProvider;
    telephony: TelephonyProvider;
    http: HttpPoster;
    enrichment: EnrichmentProvider;
  }
}
