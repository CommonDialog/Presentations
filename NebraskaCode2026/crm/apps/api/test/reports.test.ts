import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineDto } from '@crm/shared';
import { withOrg } from '../src/lib/tenant.js';
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
  accountId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Report Corp' },
    })
  ).json().id;
});

async function createDeal(payload: Record<string, unknown>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/deals',
    cookies: org.cookies,
    payload: { name: 'Deal', accountId, ...payload },
  });
  return res.json();
}

async function moveDeal(id: string, stageId: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/deals/${id}/move`,
    cookies: org.cookies,
    payload: { stageId, ...extra },
  });
  expect(res.statusCode).toBe(200);
  return res;
}

async function logActivity(type: string, subject: string, links: Record<string, string[]>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/activities',
    cookies: org.cookies,
    payload: { type, subject, links },
  });
  expect(res.statusCode).toBe(201);
  return res;
}

async function report(path: string) {
  const res = await ctx.app.inject({ method: 'GET', url: path, cookies: org.cookies });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function wonStage() {
  return pipeline.stages.find((s) => s.isWon)!;
}
function lostStage() {
  return pipeline.stages.find((s) => s.isLost)!;
}

describe('reports', () => {
  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/reports/sales' });
    expect(res.statusCode).toBe(401);
  });

  it('sales report: totals, win rate, pipeline, leaderboard', async () => {
    await createDeal({ name: 'Open deal', amount: 10000 });
    const winner = await createDeal({ name: 'Winner', amount: 60000 });
    const loser = await createDeal({ name: 'Loser', amount: 20000 });
    await moveDeal(winner.id, wonStage().id);
    await moveDeal(loser.id, lostStage().id, { winLossReason: 'went with competitor' });

    const sales = await report('/api/reports/sales?days=30');
    expect(sales.newDeals.count).toBe(3);
    expect(sales.won).toEqual({ count: 1, amount: 60000 });
    expect(sales.lost).toEqual({ count: 1, amount: 20000 });
    expect(sales.winRate).toBe(50);
    expect(sales.avgWonDealSize).toBe(60000);
    expect(sales.avgCycleDays).not.toBeNull();
    expect(sales.openPipeline.count).toBe(1);
    expect(sales.openPipeline.amount).toBe(10000);
    // Qualification stage probability is 10% → weighted 1000
    expect(sales.openPipeline.weighted).toBe(1000);

    expect(sales.byOwner).toHaveLength(1);
    expect(sales.byOwner[0].wonCount).toBe(1);
    expect(sales.byOwner[0].wonAmount).toBe(60000);
    expect(sales.byOwner[0].openCount).toBe(1);
  });

  it('velocity report: stage entries and closed cycle times', async () => {
    const deal = await createDeal({ name: 'Mover', amount: 5000 });
    const openStages = pipeline.stages.filter((s) => !s.isWon && !s.isLost);
    await moveDeal(deal.id, openStages[1]!.id);
    await moveDeal(deal.id, wonStage().id);

    const velocity = await report('/api/reports/velocity?days=30');
    const byName = Object.fromEntries(
      velocity.stages.map((s: { stageName: string; dealsEntered: number }) => [s.stageName, s]),
    );
    expect(byName[openStages[0]!.name].dealsEntered).toBe(1);
    expect(byName[openStages[1]!.name].dealsEntered).toBe(1);
    expect(byName[wonStage().name].dealsEntered).toBe(1);
    // completed stays exist for the first two stages (moved out of them)
    expect(byName[openStages[0]!.name].avgDaysInStage).not.toBeNull();
    expect(velocity.avgWonCycleDays).not.toBeNull();
  });

  it('stalled report: flags idle deals, skips fresh and closed ones', async () => {
    const idle = await createDeal({ name: 'Sleeper', amount: 7000 });
    await createDeal({ name: 'Fresh', amount: 1000 });
    // Backdate the sleeper's creation and stage history past the threshold.
    // RLS applies even to direct db access, so set the org context first.
    await withOrg(ctx.db, org.organizationId, async (tx) => {
      await tx.execute(
        sql`update deals set created_at = now() - interval '30 days' where id = ${idle.id}`,
      );
      await tx.execute(
        sql`update deal_stage_history set changed_at = now() - interval '30 days' where deal_id = ${idle.id}`,
      );
    });

    const stalled = await report('/api/reports/stalled?idleDays=14');
    expect(stalled.deals).toHaveLength(1);
    expect(stalled.deals[0].name).toBe('Sleeper');
    expect(stalled.deals[0].idleDays).toBeGreaterThanOrEqual(29);
    expect(stalled.totalAmount).toBe(7000);

    // Logging a recent activity on the deal un-stalls it.
    await logActivity('call', 'Checked in', { deals: [idle.id] });
    const after = await report('/api/reports/stalled?idleDays=14');
    expect(after.deals).toHaveLength(0);
  });

  it('revenue report: actual by close month, projected weighted by expected close', async () => {
    const winner = await createDeal({ name: 'Closed this month', amount: 40000 });
    await moveDeal(winner.id, wonStage().id);

    const nextMonth = new Date();
    nextMonth.setDate(1);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    await createDeal({
      name: 'Landing next month',
      amount: 10000,
      probability: 50,
      expectedCloseDate: nextMonth.toISOString().slice(0, 10),
    });

    const revenue = await report('/api/reports/revenue?months=3');
    expect(revenue.actual).toHaveLength(1);
    expect(revenue.actual[0].amount).toBe(40000);
    expect(revenue.projected).toHaveLength(1);
    expect(revenue.projected[0].amount).toBe(10000);
    expect(revenue.projected[0].weighted).toBe(5000);
  });

  it('activity report: by type, by user, task stats', async () => {
    await logActivity('call', 'Intro call', { accounts: [accountId] });
    await logActivity('note', 'Notes', { accounts: [accountId] });
    const task = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/tasks',
        cookies: org.cookies,
        payload: { title: 'Done thing' },
      })
    ).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      cookies: org.cookies,
      payload: { title: 'Overdue thing', dueAt: '2026-01-01T00:00:00.000Z' },
    });

    const activity = await report('/api/reports/activity?days=30');
    const types = Object.fromEntries(
      activity.byType.map((t: { type: string; count: number }) => [t.type, t.count]),
    );
    expect(types.call).toBe(1);
    expect(types.note).toBe(1);
    expect(activity.byUser).toHaveLength(1);
    expect(activity.byUser[0].activities).toBe(2);
    expect(activity.byUser[0].tasksCompleted).toBe(1);
    expect(activity.tasks).toEqual({ completedInPeriod: 1, open: 1, overdue: 1 });
  });

  it('project health: past-due is off_track, clean project is on_track', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      cookies: org.cookies,
      payload: { name: 'Late project', accountId, dueDate: '2026-01-01' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      cookies: org.cookies,
      payload: { name: 'Smooth project', accountId },
    });

    const health = await report('/api/reports/projects');
    expect(health.summary).toEqual({ on_track: 1, at_risk: 0, off_track: 1 });
    const late = health.projects.find((p: { name: string }) => p.name === 'Late project');
    expect(late.health).toBe('off_track');
    expect(late.reasons).toContain('past due date');
    expect(health.projects[0].health).toBe('off_track'); // worst first
  });

  it('customer health: silent account with open deals is at_risk, recent activity heals it', async () => {
    await createDeal({ name: 'Open exposure', amount: 15000 });

    const before = await report('/api/reports/customers');
    expect(before.accounts).toHaveLength(1);
    expect(before.accounts[0].health).toBe('at_risk');
    expect(before.accounts[0].reasons).toContain('no activity ever logged');
    expect(before.accounts[0].openDeals).toBe(1);
    expect(before.accounts[0].openAmount).toBe(15000);

    await logActivity('meeting', 'QBR', { accounts: [accountId] });
    const after = await report('/api/reports/customers');
    expect(after.accounts[0].health).toBe('healthy');
    expect(after.summary).toEqual({ healthy: 1, watch: 0, at_risk: 0 });
  });
});
