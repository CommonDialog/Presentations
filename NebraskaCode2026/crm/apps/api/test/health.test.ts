import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestContext } from './helpers/testApp.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('GET /api/health', () => {
  it('returns ok with version and timestamp', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });
});
