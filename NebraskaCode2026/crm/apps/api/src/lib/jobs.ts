import { PgBoss, type Job } from 'pg-boss';

export interface EnqueueOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  /** Debounce: at most one queued job with this key per singletonSeconds window. */
  singletonKey?: string;
  singletonSeconds?: number;
}

export interface JobRunner {
  boss: PgBoss;
  enqueue(name: string, data: object, options?: EnqueueOptions): Promise<string | null>;
  /** Register a worker; failed handlers are retried per the job's retry policy. */
  work<T extends object>(
    name: string,
    handler: (data: T) => Promise<void>,
    options?: { pollingIntervalSeconds?: number; batchSize?: number },
  ): Promise<void>;
  stop(): Promise<void>;
}

// Default retry policy: 3 retries with exponential backoff.
const DEFAULT_RETRY = { retryLimit: 3, retryDelay: 2, retryBackoff: true };

/** Postgres-backed background jobs (pg-boss) — no extra infrastructure. */
export async function createJobRunner(connectionString: string): Promise<JobRunner> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', () => {
    /* connection-level errors surface via failed jobs; avoid crashing the process */
  });
  await boss.start();
  const knownQueues = new Set<string>();

  async function ensureQueue(name: string): Promise<void> {
    if (knownQueues.has(name)) return;
    await boss.createQueue(name);
    knownQueues.add(name);
  }

  return {
    boss,
    async enqueue(name, data, options = {}) {
      await ensureQueue(name);
      return boss.send(name, data, {
        ...DEFAULT_RETRY,
        ...(options.retryLimit !== undefined ? { retryLimit: options.retryLimit } : {}),
        ...(options.retryDelaySeconds !== undefined ? { retryDelay: options.retryDelaySeconds } : {}),
        ...(options.singletonKey !== undefined ? { singletonKey: options.singletonKey } : {}),
        ...(options.singletonSeconds !== undefined ? { singletonSeconds: options.singletonSeconds } : {}),
      });
    },
    async work<T extends object>(
      name: string,
      handler: (data: T) => Promise<void>,
      options: { pollingIntervalSeconds?: number; batchSize?: number } = {},
    ) {
      await ensureQueue(name);
      await boss.work<T>(
        name,
        {
          batchSize: options.batchSize ?? 1,
          pollingIntervalSeconds: options.pollingIntervalSeconds ?? 1,
        },
        async (jobs: Job<T>[]) => {
          for (const job of jobs) {
            await handler(job.data);
          }
        },
      );
    },
    async stop() {
      await boss.stop({ close: true, timeout: 5000 });
    },
  };
}
