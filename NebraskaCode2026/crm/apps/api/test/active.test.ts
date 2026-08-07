import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ActiveInsight } from '@crm/shared';
import { FakeEmbeddingProvider, FakeLlmProvider } from '../src/ai/fakeProvider.js';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import {
  registerOrg,
  resetDb,
  testConfig,
  type TestContext,
  type TestOrg,
} from './helpers/testApp.js';

let ctx: TestContext;
let fake: FakeLlmProvider;
let org: TestOrg;
let accountId: string;
let dealId: string;

function insightFixture(overrides: Partial<ActiveInsight> = {}): ActiveInsight {
  const pillar = (present: boolean, assessment: string) => ({ present, assessment });
  return {
    meddic: {
      metrics: pillar(true, 'ROI of 3x mentioned'),
      economicBuyer: pillar(false, 'No budget holder identified yet'),
      decisionCriteria: pillar(true, 'Security and integration are key'),
      decisionProcess: pillar(false, 'Process unclear'),
      identifyPain: pillar(true, 'Manual reporting wastes 10h/week'),
      champion: pillar(true, 'Maria advocates internally'),
    },
    bant: {
      budget: pillar(true, '$75k budget confirmed'),
      authority: pillar(false, 'Maria is not the final signer'),
      need: pillar(true, 'Clear operational pain'),
      timeline: pillar(true, 'Wants go-live before Q4'),
    },
    buyingSignals: ['Asked for a proposal by Friday', 'Requested security documentation'],
    risks: [{ description: 'CFO has not been engaged', severity: 'high' }],
    competitors: ['CompetitorX'],
    decisionMakers: [{ name: 'Maria Lopez', role: 'VP Operations', isChampion: true }],
    nextActions: [
      {
        title: 'Get intro to the CFO',
        description: 'Champion should broker a meeting with the economic buyer',
        dueInDays: 7,
        priority: 'high',
      },
    ],
    health: 'at_risk',
    confidence: 62,
    reasoning: 'Strong champion and budget, but no economic buyer engagement.',
    ...overrides,
  };
}

beforeAll(async () => {
  const config = testConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  fake = new FakeLlmProvider();
  const app = buildApp({ config, db, logger: false, llm: fake, embedder: new FakeEmbeddingProvider() });
  await app.ready();
  ctx = {
    app,
    db,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  org = await registerOrg(ctx.app);
  accountId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Active Corp' },
    })
  ).json().id;
  dealId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Active Deal', accountId, amount: 75000 },
    })
  ).json().id;
});

async function analyze() {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/deals/${dealId}/analyze`,
    cookies: org.cookies,
  });
}

describe('active CRM engine', () => {
  it('analyzes a deal into a full insight and proposes next actions', async () => {
    fake.queueStructured(insightFixture());
    const res = await analyze();
    expect(res.statusCode).toBe(200);
    const insight = res.json();
    expect(insight.analysis.health).toBe('at_risk');
    expect(insight.analysis.confidence).toBe(62);
    expect(insight.analysis.meddic.champion.present).toBe(true);
    expect(insight.analysis.bant.budget.present).toBe(true);
    expect(insight.analysis.competitors).toContain('CompetitorX');
    expect(insight.analysis.decisionMakers[0].name).toBe('Maria Lopez');

    // next action became a pending proposal — not a task
    const proposals = await ctx.app.inject({
      method: 'GET',
      url: '/api/proposals?status=pending',
      cookies: org.cookies,
    });
    const titles = proposals.json().proposals.map((p: { title: string }) => p.title);
    expect(titles).toContain('Create task "Get intro to the CFO"');

    const tasks = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks?dealId=${dealId}`,
      cookies: org.cookies,
    });
    expect(tasks.json().total).toBe(0); // nothing modified without approval
  });

  it('GET returns the latest insight; re-analysis supersedes', async () => {
    fake.queueStructured(insightFixture({ health: 'healthy', confidence: 80 }));
    await analyze();
    fake.queueStructured(insightFixture({ health: 'critical', confidence: 30, nextActions: [] }));
    await analyze();

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${dealId}/insight`,
      cookies: org.cookies,
    });
    expect(res.json().insight.analysis.health).toBe('critical');
    expect(res.json().insight.analysis.confidence).toBe(30);
  });

  it('writes a timeline entry only on first insight or health change', async () => {
    const timelineTypes = async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/deals/${dealId}/timeline?pageSize=50`,
        cookies: org.cookies,
      });
      return res
        .json()
        .items.filter((i: { entryType: string }) => i.entryType === 'ai.insight');
    };

    fake.queueStructured(insightFixture({ health: 'healthy', nextActions: [] }));
    await analyze();
    expect(await timelineTypes()).toHaveLength(1); // first insight

    fake.queueStructured(insightFixture({ health: 'healthy', nextActions: [] }));
    await analyze();
    expect(await timelineTypes()).toHaveLength(1); // same health → no spam

    fake.queueStructured(insightFixture({ health: 'critical', nextActions: [] }));
    await analyze();
    const entries = await timelineTypes();
    expect(entries).toHaveLength(2); // health change → new entry
    expect(entries[0].summary).toContain('changed to critical');
  });

  it('dedupes repeated next-action proposals across analyses', async () => {
    fake.queueStructured(insightFixture());
    await analyze();
    fake.queueStructured(insightFixture()); // same next action again
    await analyze();

    const proposals = await ctx.app.inject({
      method: 'GET',
      url: '/api/proposals?status=pending',
      cookies: org.cookies,
    });
    const matching = proposals
      .json()
      .proposals.filter((p: { title: string }) => p.title.includes('Get intro to the CFO'));
    expect(matching).toHaveLength(1);
  });

  it('clamps confidence into 0-100', async () => {
    fake.queueStructured(insightFixture({ confidence: 250, nextActions: [] }));
    const res = await analyze();
    expect(res.json().analysis.confidence).toBe(100);
  });

  it('approving a next-action proposal creates the task through the pipeline', async () => {
    fake.queueStructured(insightFixture());
    await analyze();
    const proposals = await ctx.app.inject({
      method: 'GET',
      url: '/api/proposals?status=pending',
      cookies: org.cookies,
    });
    const proposal = proposals
      .json()
      .proposals.find((p: { title: string }) => p.title.includes('Get intro to the CFO'));
    await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${proposal.id}/approve`,
      cookies: org.cookies,
    });
    const tasks = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks?dealId=${dealId}`,
      cookies: org.cookies,
    });
    expect(tasks.json().total).toBe(1);
    expect(tasks.json().items[0].title).toBe('Get intro to the CFO');
  });

  it('insight endpoint 404s for foreign deals and returns null before analysis', async () => {
    const empty = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${dealId}/insight`,
      cookies: org.cookies,
    });
    expect(empty.json().insight).toBeNull();

    const orgB = await registerOrg(ctx.app);
    const foreign = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${dealId}/insight`,
      cookies: orgB.cookies,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
