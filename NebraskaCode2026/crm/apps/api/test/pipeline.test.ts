import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineDto } from '@crm/shared';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

let ctx: TestContext;
let org: TestOrg;
let pipeline: PipelineDto;
let accountId: string;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  org = await registerOrg(ctx.app);
  const pipelines = await ctx.app.inject({ method: 'GET', url: '/api/pipelines', cookies: org.cookies });
  pipeline = pipelines.json().pipelines[0];
  const account = await ctx.app.inject({
    method: 'POST',
    url: '/api/accounts',
    cookies: org.cookies,
    payload: { name: 'Deal Corp' },
  });
  accountId = account.json().id;
});

function stage(name: string) {
  return pipeline.stages.find((s) => s.name === name)!;
}

async function createDeal(payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/deals',
    cookies: org.cookies,
    payload: { name: 'Test Deal', accountId, ...payload },
  });
}

describe('pipeline seeding', () => {
  it('every new org gets a default pipeline with won/lost stages', () => {
    expect(pipeline.name).toBe('Sales Pipeline');
    expect(pipeline.isDefault).toBe(true);
    expect(pipeline.stages).toHaveLength(6);
    expect(pipeline.stages.some((s) => s.isWon)).toBe(true);
    expect(pipeline.stages.some((s) => s.isLost)).toBe(true);
    expect(stage('Qualification').probability).toBe(10);
    expect(stage('Closed Won').probability).toBe(100);
  });
});

describe('deals', () => {
  it('creates in the first open stage with effective probability from the stage', async () => {
    const res = await createDeal({ amount: 10000 });
    expect(res.statusCode).toBe(201);
    const deal = res.json();
    expect(deal.stageId).toBe(stage('Qualification').id);
    expect(deal.status).toBe('open');
    expect(deal.effectiveProbability).toBe(10);
    expect(deal.expectedRevenue).toBe(1000);
    expect(deal.accountName).toBe('Deal Corp');
  });

  it('probability override beats stage probability', async () => {
    const res = await createDeal({ amount: 1000, probability: 80 });
    expect(res.json().expectedRevenue).toBe(800);
  });

  it('cannot be created directly in a closed stage', async () => {
    const res = await createDeal({ stageId: stage('Closed Won').id });
    expect(res.statusCode).toBe(400);
  });

  it('records stage history and timeline on movement', async () => {
    const deal = (await createDeal({ amount: 5000 })).json();
    const move = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Proposal').id },
    });
    expect(move.statusCode).toBe(200);
    expect(move.json().effectiveProbability).toBe(50);

    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${deal.id}/history`,
      cookies: org.cookies,
    });
    const rows = history.json().history;
    expect(rows).toHaveLength(2); // creation + move
    expect(rows[0].fromStageName).toBeNull();
    expect(rows[1].fromStageName).toBe('Qualification');
    expect(rows[1].toStageName).toBe('Proposal');

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${deal.id}/timeline`,
      cookies: org.cookies,
    });
    expect(timeline.json().items[0].entryType).toBe('deal.stage_changed');
  });

  it('winning requires an amount; sets closedAt', async () => {
    const noAmount = (await createDeal({})).json();
    const failed = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${noAmount.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Closed Won').id },
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error).toMatch(/amount/);

    const withAmount = (await createDeal({ amount: 9000 })).json();
    const won = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${withAmount.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Closed Won').id },
    });
    expect(won.statusCode).toBe(200);
    expect(won.json().status).toBe('won');
    expect(won.json().closedAt).not.toBeNull();
  });

  it('losing requires a reason; reopening clears closed fields', async () => {
    const deal = (await createDeal({ amount: 1234 })).json();
    const noReason = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Closed Lost').id },
    });
    expect(noReason.statusCode).toBe(400);

    const lost = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Closed Lost').id, winLossReason: 'chose competitor' },
    });
    expect(lost.json().status).toBe('lost');
    expect(lost.json().winLossReason).toBe('chose competitor');

    // lost → won directly is forbidden
    const jump = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Closed Won').id },
    });
    expect(jump.statusCode).toBe(400);

    const reopened = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Discovery').id },
    });
    expect(reopened.json().status).toBe('open');
    expect(reopened.json().closedAt).toBeNull();
    expect(reopened.json().winLossReason).toBeNull();

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${deal.id}/timeline`,
      cookies: org.cookies,
    });
    const types = timeline.json().items.map((i: { entryType: string }) => i.entryType);
    expect(types).toContain('deal.lost');
    expect(types).toContain('deal.reopened');
  });

  it('PATCH cannot change stage or status', async () => {
    const deal = (await createDeal({})).json();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/deals/${deal.id}`,
      cookies: org.cookies,
      payload: { stageId: stage('Proposal').id },
    });
    expect(res.statusCode).toBe(400); // unknown key → strict schema rejects? no: schema ignores extra keys unless strict
  });

  it('manages deal contacts with a single primary', async () => {
    const deal = (await createDeal({})).json();
    const mk = async (first: string) =>
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/contacts',
          cookies: org.cookies,
          payload: { firstName: first, lastName: 'Person', accountId },
        })
      ).json().contact.id;
    const c1 = await mk('One');
    const c2 = await mk('Two');

    await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/contacts`,
      cookies: org.cookies,
      payload: { contactId: c1, role: 'Champion', isPrimary: true },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/contacts`,
      cookies: org.cookies,
      payload: { contactId: c2, role: 'Decision Maker', isPrimary: true },
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${deal.id}/contacts`,
      cookies: org.cookies,
    });
    const rows = list.json().contacts;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r: { isPrimary: boolean }) => r.isPrimary)).toHaveLength(1);
    expect(rows.find((r: { isPrimary: boolean }) => r.isPrimary).firstName).toBe('Two');
  });
});

describe('board & forecast', () => {
  it('groups deals by stage with totals and weighted amounts', async () => {
    await createDeal({ name: 'D1', amount: 10000 }); // Qualification 10%
    const d2 = (await createDeal({ name: 'D2', amount: 20000 })).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${d2.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Proposal').id },
    });
    const d3 = (await createDeal({ name: 'D3', amount: 5000 })).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${d3.id}/move`,
      cookies: org.cookies,
      payload: { stageId: stage('Closed Won').id },
    });

    const board = (
      await ctx.app.inject({ method: 'GET', url: '/api/deals/board', cookies: org.cookies })
    ).json();
    expect(board.columns).toHaveLength(6);
    const qual = board.columns.find((c: { stage: { name: string } }) => c.stage.name === 'Qualification');
    expect(qual.deals).toHaveLength(1);
    expect(qual.totalAmount).toBe(10000);
    expect(qual.weightedAmount).toBe(1000);
    const proposal = board.columns.find((c: { stage: { name: string } }) => c.stage.name === 'Proposal');
    expect(proposal.weightedAmount).toBe(10000);

    const forecast = (
      await ctx.app.inject({ method: 'GET', url: '/api/deals/forecast', cookies: org.cookies })
    ).json();
    expect(forecast.openCount).toBe(2);
    expect(forecast.openAmount).toBe(30000);
    expect(forecast.weightedForecast).toBe(11000);
    expect(forecast.wonCount).toBe(1);
    expect(forecast.wonAmount).toBe(5000);
  });
});

describe('leads', () => {
  async function createLead(payload: Record<string, unknown>) {
    return ctx.app.inject({ method: 'POST', url: '/api/leads', cookies: org.cookies, payload });
  }

  it('requires a name or company', async () => {
    expect((await createLead({ email: 'x@y.com' })).statusCode).toBe(400);
    expect((await createLead({ company: 'Solo Co' })).statusCode).toBe(201);
  });

  it('enforces the status state machine', async () => {
    const lead = (await createLead({ firstName: 'Lea', lastName: 'Der', company: 'LeadCo' })).json();
    const toQualified = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/status`,
      cookies: org.cookies,
      payload: { status: 'qualified' },
    });
    expect(toQualified.statusCode).toBe(200);

    // qualified → working is not a legal transition
    const back = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/status`,
      cookies: org.cookies,
      payload: { status: 'working' },
    });
    expect(back.statusCode).toBe(400);

    // converted only via convert endpoint
    const direct = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/status`,
      cookies: org.cookies,
      payload: { status: 'converted' },
    });
    expect(direct.statusCode).toBe(400);
  });

  it('refuses to convert an unqualified lead', async () => {
    const lead = (await createLead({ company: 'NotReady Inc' })).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/convert`,
      cookies: org.cookies,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/qualified/);
  });

  it('converts atomically: account + contact + deal + frozen lead', async () => {
    const lead = (
      await createLead({
        firstName: 'Con',
        lastName: 'Vert',
        company: 'Convert Industries',
        email: 'con@convert.example',
      })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/status`,
      cookies: org.cookies,
      payload: { status: 'qualified' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/convert`,
      cookies: org.cookies,
      payload: { deal: { name: 'Convert Deal', amount: 42000 } },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.lead.status).toBe('converted');
    expect(result.accountId).toBeTruthy();
    expect(result.contactId).toBeTruthy();
    expect(result.dealId).toBeTruthy();

    const account = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${result.accountId}`,
      cookies: org.cookies,
    });
    expect(account.json().name).toBe('Convert Industries');

    const deal = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${result.dealId}`,
      cookies: org.cookies,
    });
    expect(deal.json().amount).toBe(42000);

    const dealContacts = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${result.dealId}/contacts`,
      cookies: org.cookies,
    });
    expect(dealContacts.json().contacts[0].isPrimary).toBe(true);

    // frozen: no edits, no re-convert
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      cookies: org.cookies,
      payload: { company: 'Changed' },
    });
    expect(edit.statusCode).toBe(400);
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/convert`,
      cookies: org.cookies,
      payload: {},
    });
    expect(again.statusCode).toBe(400);
  });

  it('converts into an existing account when given', async () => {
    const lead = (await createLead({ firstName: 'Exist', lastName: 'Ing' })).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/status`,
      cookies: org.cookies,
      payload: { status: 'qualified' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/leads/${lead.id}/convert`,
      cookies: org.cookies,
      payload: { accountId },
    });
    expect(res.json().accountId).toBe(accountId);
    expect(res.json().dealId).toBeNull();
  });
});
