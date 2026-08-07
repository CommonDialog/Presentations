import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { FakeHttpPoster } from '../src/lib/http.js';
import { registerOrg, resetDb, testConfig, type TestOrg } from './helpers/testApp.js';

// Behavioral tests for the perf caches: they must serve from memory on the
// hot path and invalidate immediately on the mutations that matter.

let app: FastifyInstance;
let db: Db;
let closePool: () => Promise<void>;
let http: FakeHttpPoster;
let org: TestOrg;

beforeAll(async () => {
  const config = { ...testConfig(), AUTH_CACHE_TTL_MS: 15_000 }; // cache ON here
  const created = createDb(config.DATABASE_URL);
  db = created.db;
  closePool = () => created.pool.end();
  http = new FakeHttpPoster();
  app = buildApp({ config, db, logger: false, http });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb(db);
  http.posts.length = 0;
  org = await registerOrg(app);
});

describe('auth context cache', () => {
  it('serves cached sessions and logout invalidates immediately', async () => {
    // warm the cache
    const first = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: org.cookies });
    expect(first.statusCode).toBe(200);

    // delete the session row behind the cache's back: the cached context
    // still authenticates — proof requests are served from memory
    await db.execute(sql`delete from sessions`);
    const cached = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: org.cookies });
    expect(cached.statusCode).toBe(200);

    // logout drops the cache entry — invalidation takes effect instantly
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: org.cookies });
    expect(logout.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: org.cookies });
    expect(after.statusCode).toBe(401);
  });
});

describe('automation dispatch caches', () => {
  it('workflow trigger cache: warm miss, then create invalidates and fires', async () => {
    // warm: this lead sees "no workflows for lead.created" and caches it
    await app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'Warm', lastName: 'Up' },
    });

    // creating a workflow must invalidate the cached summary…
    await app.inject({
      method: 'POST',
      url: '/api/workflows',
      cookies: org.cookies,
      payload: {
        name: 'Lead task',
        triggerType: 'lead.created',
        actions: [{ type: 'create_task', title: 'Call {{lead.lastName}}' }],
      },
    });

    // …so the very next event executes it
    await app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'After', lastName: 'Invalidate' },
    });
    const tasks = await app.inject({ method: 'GET', url: '/api/tasks', cookies: org.cookies });
    const titles = tasks.json().items.map((t: { title: string }) => t.title);
    expect(titles).toContain('Call Invalidate');
  });

  it('webhook cache: warm miss, then create invalidates and delivers', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'No', lastName: 'Hooks' },
    });
    expect(http.posts).toHaveLength(0);

    await app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      cookies: org.cookies,
      payload: { url: 'https://example.test/perf-hook', events: ['lead.created'] },
    });

    await app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'Now', lastName: 'Hooked' },
    });
    expect(http.posts.filter((p) => p.url === 'https://example.test/perf-hook')).toHaveLength(1);
  });
});
