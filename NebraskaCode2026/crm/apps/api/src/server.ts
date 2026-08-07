import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createJobRunner, type JobRunner } from './lib/jobs.js';
import { systemContext } from './modules/auth/service.js';
import { analyzeCapture } from './modules/knowledge/service.js';
import { CAPTURE_JOB, type CaptureJobData } from './modules/knowledge/routes.js';
import { ANALYZE_JOB, analyzeDeal, type AnalyzeJobData } from './modules/active/service.js';
import { executeWorkflowsForEvent, WORKFLOW_JOB, type WorkflowJobData } from './modules/workflows/engine.js';
import { deliverWebhook, WEBHOOK_JOB, type WebhookJobData } from './modules/integrations/service.js';

const config = loadConfig();

let jobs: JobRunner | undefined;
if (config.JOBS_ENABLED) {
  jobs = await createJobRunner(config.DATABASE_URL);
}

const app = buildApp({ config, ...(jobs ? { jobs } : {}) });

if (jobs) {
  await jobs.work<CaptureJobData>(CAPTURE_JOB, async (data) => {
    await analyzeCapture(app.db, app.ai, systemContext(data.organizationId, data.userId), {
      activityId: data.activityId,
      sourceType: data.sourceType,
      content: data.content,
      links: data.links,
    });
  });
  await jobs.work<AnalyzeJobData>(ANALYZE_JOB, async (data) => {
    await analyzeDeal(app.db, app.ai, systemContext(data.organizationId, data.userId), data.dealId);
  });
  await jobs.work<WorkflowJobData>(WORKFLOW_JOB, async (data) => {
    await executeWorkflowsForEvent(app, data.organizationId, data.userId, data.event);
  });
  // Webhook fan-out can spike (one event × N hooks); drain in batches.
  await jobs.work<WebhookJobData>(
    WEBHOOK_JOB,
    async (data) => {
      await deliverWebhook(app, data);
    },
    { batchSize: 10 },
  );
}

app.listen({ port: app.config.API_PORT, host: '127.0.0.1' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await jobs?.stop();
      process.exit(0);
    })();
  });
}
