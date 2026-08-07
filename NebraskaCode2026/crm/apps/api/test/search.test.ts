import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PipelineDto, SearchResultDto } from '@crm/shared';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { FakeLlmProvider } from '../src/ai/fakeProvider.js';
import { aiArtifacts, documents } from '../src/db/schema/index.js';
import { withOrg } from '../src/lib/tenant.js';
import { registerOrg, resetDb, testConfig, type TestOrg } from './helpers/testApp.js';

let app: FastifyInstance;
let db: Db;
let closePool: () => Promise<void>;
let fake: FakeLlmProvider;
let org: TestOrg;
let pipeline: PipelineDto;
let accountId: string;

beforeAll(async () => {
  const config = testConfig();
  const created = createDb(config.DATABASE_URL);
  db = created.db;
  closePool = () => created.pool.end();
  // strict fake: NL parses must be queued, unqueued parses exercise the fallback
  fake = new FakeLlmProvider();
  app = buildApp({ config, db, logger: false, llm: fake });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb(db);
  org = await registerOrg(app);
  pipeline = (
    await app.inject({ method: 'GET', url: '/api/pipelines', cookies: org.cookies })
  ).json().pipelines[0];
  accountId = (
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Acme Rockets', domain: 'acme.test', industry: 'Aerospace' },
    })
  ).json().id;
});

async function search(q: string, extra = '') {
  const res = await app.inject({
    method: 'GET',
    url: `/api/search?q=${encodeURIComponent(q)}${extra}`,
    cookies: org.cookies,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { results: SearchResultDto[]; totalsByType: Record<string, number> };
}

function ofType(results: SearchResultDto[], type: string) {
  return results.filter((r) => r.type === type);
}

describe('global search', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=acme' });
    expect(res.statusCode).toBe(401);
  });

  it('finds accounts, contacts, deals, and projects by name', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Ada', lastName: 'Acmeworth', accountId, email: 'ada@acme.test' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Acme expansion', accountId, amount: 50000 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      cookies: org.cookies,
      payload: { name: 'Acme onboarding', accountId },
    });

    const { results, totalsByType } = await search('acme');
    expect(totalsByType.account).toBe(1);
    expect(totalsByType.contact).toBe(1);
    expect(totalsByType.deal).toBe(1);
    expect(totalsByType.project).toBe(1);
    expect(ofType(results, 'account')[0]!.title).toBe('Acme Rockets');
    expect(ofType(results, 'account')[0]!.meta).toContain('Aerospace');
    expect(ofType(results, 'deal')[0]!.meta).toContain('$50,000');
    expect(ofType(results, 'deal')[0]!.url).toMatch(/^\/deals\//);
  });

  it('separates emails from other activities and returns body snippets', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/activities',
      cookies: org.cookies,
      payload: {
        type: 'call',
        subject: 'Quarterly sync',
        body: 'Long discussion about the reactor budget and next steps for the pilot program.',
        links: { accounts: [accountId] },
      },
    });
    const sent = await app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: org.cookies,
      payload: {
        to: ['buyer@acme.test'],
        subject: 'Reactor proposal attached',
        body: 'Hi — the reactor budget breakdown is attached as discussed.',
        accountId,
      },
    });
    expect(sent.statusCode).toBe(201);

    const { results } = await search('reactor');
    const emails = ofType(results, 'email');
    const activities = ofType(results, 'activity');
    expect(emails).toHaveLength(1);
    expect(emails[0]!.title).toBe('Reactor proposal attached');
    expect(emails[0]!.meta).toContain('outbound');
    expect(activities).toHaveLength(1);
    expect(activities[0]!.title).toBe('Quarterly sync');
    expect(activities[0]!.snippet).toContain('reactor budget');
    expect(activities[0]!.url).toBe(`/accounts/${accountId}`);
  });

  it('finds documents and AI summaries', async () => {
    await withOrg(db, org.organizationId, async (tx) => {
      await tx.insert(documents).values({
        organizationId: org.organizationId,
        name: 'Acme MSA v3.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storagePath: '/tmp/msa.pdf',
        accountId,
      });
      await tx.insert(aiArtifacts).values({
        organizationId: org.organizationId,
        kind: 'summary',
        status: 'approved',
        title: 'Call summary: Acme pricing concerns',
        payload: { summary: 'Acme raised concerns about reactor pricing tiers.' },
        accountId,
      });
    });

    const { results } = await search('acme');
    const docs = ofType(results, 'document');
    const summaries = ofType(results, 'ai_summary');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('Acme MSA v3.pdf');
    expect(docs[0]!.url).toBe(`/accounts/${accountId}`);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.meta).toBe('AI summary');

    const priced = await search('pricing tiers');
    expect(ofType(priced.results, 'ai_summary')[0]!.snippet).toContain('pricing tiers');
  });

  it('honors the types filter', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Acme expansion', accountId, amount: 1000 },
    });
    const { results } = await search('acme', '&types=deal');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.type === 'deal')).toBe(true);
  });

  it('escapes ILIKE wildcards', async () => {
    const { results } = await search('%');
    expect(results).toHaveLength(0);
  });
});

describe('natural language search', () => {
  it('applies AI-parsed entity types, status, and amount filters', async () => {
    const big = (
      await app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Acme expansion', accountId, amount: 90000 },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Acme starter', accountId, amount: 2000 },
    });
    const wonStage = pipeline.stages.find((s) => s.isWon)!;
    await app.inject({
      method: 'POST',
      url: `/api/deals/${big.id}/move`,
      cookies: org.cookies,
      payload: { stageId: wonStage.id },
    });

    fake.queueStructured({
      entityTypes: ['deal'],
      keywords: ['Acme'],
      status: 'won',
      minAmount: 50000,
      timeframeDays: null,
      summary: 'Won Acme deals over $50,000',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/search/ask',
      cookies: org.cookies,
      payload: { query: 'which big acme deals did we win?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.interpretation.fallback).toBe(false);
    expect(body.interpretation.summary).toBe('Won Acme deals over $50,000');
    expect(body.results).toHaveLength(1);
    expect(body.results[0].title).toBe('Acme expansion');
    expect(body.results[0].type).toBe('deal');
  });

  it('falls back to keyword search when AI parsing is unavailable', async () => {
    // nothing queued on the strict fake → completeStructured throws
    const res = await app.inject({
      method: 'POST',
      url: '/api/search/ask',
      cookies: org.cookies,
      payload: { query: 'Acme' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.interpretation.fallback).toBe(true);
    expect(body.results.some((r: SearchResultDto) => r.title === 'Acme Rockets')).toBe(true);
  });
});
