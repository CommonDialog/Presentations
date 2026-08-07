import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobRunner, type JobRunner } from '../src/lib/jobs.js';
import { testConfig } from './helpers/testApp.js';

let runner: JobRunner;

beforeAll(async () => {
  runner = await createJobRunner(testConfig().DATABASE_URL);
});
afterAll(async () => {
  await runner.stop();
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for job');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('background jobs (pg-boss)', () => {
  it('enqueues and processes a job', async () => {
    const processed: string[] = [];
    await runner.work<{ value: string }>('test-basic', async (data) => {
      processed.push(data.value);
    });
    const jobId = await runner.enqueue('test-basic', { value: 'hello' });
    expect(jobId).toBeTruthy();
    await waitFor(() => processed.includes('hello'), 15_000);
  }, 20_000);

  it('retries failed jobs per the retry policy until success', async () => {
    let attempts = 0;
    let succeeded = false;
    await runner.work<{ n: number }>(
      'test-retry',
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('boom');
        succeeded = true;
      },
      { pollingIntervalSeconds: 0.5 },
    );
    await runner.enqueue('test-retry', { n: 1 }, { retryLimit: 5, retryDelaySeconds: 1 });
    await waitFor(() => succeeded, 30_000);
    expect(attempts).toBe(3);
  }, 35_000);
});
