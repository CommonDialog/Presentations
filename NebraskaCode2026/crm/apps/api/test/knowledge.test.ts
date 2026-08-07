import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureAnalysis } from '@crm/shared';
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
import type { FastifyInstance } from 'fastify';

let ctx: TestContext;
let fake: FakeLlmProvider;
let org: TestOrg;
let accountId: string;
let dealId: string;
let contactId: string;

// App with an injectable strict fake so tests script the analysis.
async function buildFakeApp(): Promise<TestContext & { fake: FakeLlmProvider }> {
  const config = testConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  const llm = new FakeLlmProvider();
  const app: FastifyInstance = buildApp({
    config,
    db,
    logger: false,
    llm,
    embedder: new FakeEmbeddingProvider(),
  });
  await app.ready();
  return {
    app,
    db,
    fake: llm,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

const emptyAnalysis: CaptureAnalysis = {
  summary: 'Customer discussed renewal.',
  actionItems: [],
  sentiment: 'neutral',
  suggestedUpdates: [],
  suggestedTasks: [],
  followUpEmail: null,
};

const richAnalysis: CaptureAnalysis = {
  summary: 'Maria confirmed budget of $75k and asked for a proposal by Friday.',
  actionItems: ['Send proposal by Friday', 'Loop in engineering for scoping'],
  sentiment: 'positive',
  suggestedUpdates: [
    { entityType: 'deal', field: 'amount', suggestedValue: '75000', reason: 'Maria stated the budget is $75k' },
    { entityType: 'contact', field: 'title', suggestedValue: 'VP of Operations', reason: 'Email signature' },
    { entityType: 'account', field: 'nuclear_codes', suggestedValue: 'x', reason: 'not whitelisted' },
  ],
  suggestedTasks: [
    { title: 'Send proposal', description: 'Include the scoping estimate', dueInDays: 3, priority: 'high' },
  ],
  followUpEmail: {
    subject: 'Re: Proposal timeline',
    body: 'Hi Maria, confirming we will send the proposal by Friday.',
  },
};

beforeAll(async () => {
  const built = await buildFakeApp();
  ctx = built;
  fake = built.fake;
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
      payload: { name: 'Capture Corp' },
    })
  ).json().id;
  contactId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Maria', lastName: 'Lopez', accountId },
    })
  ).json().contact.id;
  dealId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Big Renewal', accountId, amount: 50000 },
    })
  ).json().id;
});

async function capture(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/capture', cookies: org.cookies, payload });
}

describe('knowledge capture', () => {
  it('records the source as an activity and produces summary + timeline entry', async () => {
    fake.queueStructured(emptyAnalysis);
    const res = await capture({
      sourceType: 'email',
      subject: 'Renewal chat',
      content: 'Long email content about the renewal discussion goes here.',
      accountId,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('analyzed');
    expect(body.summary).toBe('Customer discussed renewal.');
    expect(body.proposals).toHaveLength(0);

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    const types = timeline.json().items.map((i: { entryType: string }) => i.entryType);
    expect(types).toContain('activity.email'); // the captured source
    expect(types).toContain('ai.summary'); // the AI summary

    const result = await ctx.app.inject({
      method: 'GET',
      url: `/api/captures/${body.activityId}`,
      cookies: org.cookies,
    });
    expect(result.json().summary).toBe('Customer discussed renewal.');
  });

  it('creates pending proposals, dropping non-whitelisted or unlinked suggestions', async () => {
    fake.queueStructured(richAnalysis);
    const res = await capture({
      sourceType: 'meeting_transcript',
      content: 'Transcript: Maria said the budget is 75k and asked for a proposal by Friday...',
      accountId,
      contactId,
      dealId,
    });
    const body = res.json();
    // 2 whitelisted updates + 1 task + 1 follow-up (nuclear_codes dropped)
    expect(body.proposals).toHaveLength(4);
    const titles = body.proposals.map((p: { title: string }) => p.title);
    expect(titles.some((t: string) => t.includes('amount'))).toBe(true);
    expect(titles.some((t: string) => t.includes('nuclear'))).toBe(false);
    expect(body.proposals.every((p: { status: string }) => p.status === 'pending')).toBe(true);
  });

  it('requires at least one linked record', async () => {
    const res = await capture({ sourceType: 'email', content: 'Orphan content that is long enough.' });
    expect(res.statusCode).toBe(400);
  });
});

describe('proposal approval workflow', () => {
  function byType(
    proposals: { proposalType: string; id: string; title: string }[],
    type: string,
  ) {
    return proposals.filter((p) => p.proposalType === type);
  }

  it('approving a field update applies it through the service layer', async () => {
    fake.queueStructured(richAnalysis);
    const res = await capture({
      sourceType: 'call_transcript',
      content: 'Call transcript with enough content to analyze in this test.',
      accountId,
      contactId,
      dealId,
    });
    const proposals = res.json().proposals;
    const amountProposal = byType(proposals, 'update_field').find((p: { title: string }) =>
      p.title.includes('amount'),
    )!;

    const approved = await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${amountProposal.id}/approve`,
      cookies: org.cookies,
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('applied');
    expect(approved.json().reviewedBy).toBe(org.userId);

    // the deal actually changed, via the normal update path (timeline included)
    const deal = await ctx.app.inject({ method: 'GET', url: `/api/deals/${dealId}`, cookies: org.cookies });
    expect(deal.json().amount).toBe(75000);
    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${dealId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { entryType: string }) => i.entryType === 'deal.updated'),
    ).toBe(true);
  });

  it('approving a task proposal creates the linked task', async () => {
    fake.queueStructured(richAnalysis);
    const res = await capture({
      sourceType: 'call_transcript',
      content: 'Another call transcript long enough for analysis to proceed.',
      accountId,
      dealId,
    });
    const taskProposal = byType(res.json().proposals, 'create_task')[0]!;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${taskProposal.id}/approve`,
      cookies: org.cookies,
    });
    const tasks = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks?dealId=${dealId}`,
      cookies: org.cookies,
    });
    expect(tasks.json().total).toBe(1);
    expect(tasks.json().items[0].title).toBe('Send proposal');
    expect(tasks.json().items[0].priority).toBe('high');
    expect(tasks.json().items[0].dueAt).not.toBeNull();
  });

  it('approving a follow-up email creates an outbound draft activity', async () => {
    fake.queueStructured(richAnalysis);
    const res = await capture({
      sourceType: 'email',
      content: 'Email content requesting a proposal, long enough to analyze.',
      accountId,
      contactId,
    });
    const emailProposal = byType(res.json().proposals, 'followup_email')[0]!;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${emailProposal.id}/approve`,
      cookies: org.cookies,
    });
    const activities = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities?contactId=${contactId}&type=email`,
      cookies: org.cookies,
    });
    const drafts = activities
      .json()
      .items.filter((a: { metadata: { draft?: boolean } }) => a.metadata.draft === true);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe('Re: Proposal timeline');
    expect(drafts[0].direction).toBe('outbound');
  });

  it('rejecting stores the reason and applies nothing', async () => {
    fake.queueStructured(richAnalysis);
    const res = await capture({
      sourceType: 'email',
      content: 'Content for the rejection path test, sufficiently long.',
      accountId,
      dealId,
    });
    const amountProposal = byType(res.json().proposals, 'update_field').find(
      (p: { title: string }) => p.title.includes('amount'),
    )!;
    const rejected = await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${amountProposal.id}/reject`,
      cookies: org.cookies,
      payload: { reason: 'number was hypothetical' },
    });
    expect(rejected.json().status).toBe('rejected');
    expect(rejected.json().payload.rejectReason).toBe('number was hypothetical');

    const deal = await ctx.app.inject({ method: 'GET', url: `/api/deals/${dealId}`, cookies: org.cookies });
    expect(deal.json().amount).toBe(50000); // unchanged
  });

  it('enforces the proposal state machine', async () => {
    fake.queueStructured(richAnalysis);
    const res = await capture({
      sourceType: 'email',
      content: 'Content for the state machine test, sufficiently long here.',
      accountId,
      dealId,
    });
    const proposal = byType(res.json().proposals, 'create_task')[0]!;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${proposal.id}/approve`,
      cookies: org.cookies,
    });
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${proposal.id}/approve`,
      cookies: org.cookies,
    });
    expect(again.statusCode).toBe(400);
    const rejectApplied = await ctx.app.inject({
      method: 'POST',
      url: `/api/proposals/${proposal.id}/reject`,
      cookies: org.cookies,
    });
    expect(rejectApplied.statusCode).toBe(400);
  });

  it('lists pending proposals and is tenant-isolated', async () => {
    fake.queueStructured(richAnalysis);
    await capture({
      sourceType: 'email',
      content: 'Content generating proposals for the listing test case.',
      accountId,
      dealId,
    });
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/proposals?status=pending',
      cookies: org.cookies,
    });
    expect(list.json().proposals.length).toBeGreaterThan(0);

    const orgB = await registerOrg(ctx.app);
    const listB = await ctx.app.inject({
      method: 'GET',
      url: '/api/proposals',
      cookies: orgB.cookies,
    });
    expect(listB.json().proposals).toHaveLength(0);
  });
});
