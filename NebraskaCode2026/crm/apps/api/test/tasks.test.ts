import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

let ctx: TestContext;
let org: TestOrg;
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
  accountId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Task Corp' },
    })
  ).json().id;
});

async function createTask(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/tasks', cookies: org.cookies, payload });
}

describe('tasks', () => {
  it('creates with defaults: assignee = creator, priority normal', async () => {
    const res = await createTask({ title: 'Follow up' });
    expect(res.statusCode).toBe(201);
    const task = res.json();
    expect(task.assigneeId).toBe(org.userId);
    expect(task.priority).toBe('normal');
    expect(task.status).toBe('open');
  });

  it('rejects a reminder after the due date', async () => {
    const res = await createTask({
      title: 'Bad reminder',
      dueAt: '2026-09-01T12:00:00.000Z',
      reminderAt: '2026-09-02T12:00:00.000Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('linked task creation and completion land on the record timeline', async () => {
    const task = (await createTask({ title: 'Send proposal', accountId })).json();
    const complete = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().completedAt).not.toBeNull();

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    const types = timeline.json().items.map((i: { entryType: string }) => i.entryType);
    expect(types).toContain('task.created');
    expect(types).toContain('task.completed');
  });

  it('unlinked tasks write no timeline entries', async () => {
    await createTask({ title: 'Private todo' });
    const feed = await ctx.app.inject({
      method: 'GET',
      url: '/api/timeline?pageSize=100',
      cookies: org.cookies,
    });
    expect(
      feed.json().items.some((i: { summary: string }) => i.summary.includes('Private todo')),
    ).toBe(false);
  });

  it('enforces the status state machine', async () => {
    const task = (await createTask({ title: 'Lifecycle' })).json();
    const cancel = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'canceled' },
    });
    expect(cancel.statusCode).toBe(200);

    const illegal = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(illegal.statusCode).toBe(400);

    const reopen = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'open' },
    });
    expect(reopen.statusCode).toBe(200);
  });

  it('reopening clears completedAt', async () => {
    const task = (await createTask({ title: 'Reopenable' })).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    const reopened = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
      payload: { status: 'open' },
    });
    expect(reopened.json().completedAt).toBeNull();
  });

  it('filters: open, dueBefore (reminders view), account', async () => {
    await createTask({ title: 'Overdue', dueAt: '2026-01-01T00:00:00.000Z', accountId });
    await createTask({ title: 'Later', dueAt: '2027-01-01T00:00:00.000Z' });
    const done = (await createTask({ title: 'Done already' })).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${done.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });

    const open = await ctx.app.inject({
      method: 'GET',
      url: '/api/tasks?open=true',
      cookies: org.cookies,
    });
    expect(open.json().total).toBe(2);

    const due = await ctx.app.inject({
      method: 'GET',
      url: '/api/tasks?open=true&dueBefore=2026-06-01T00:00:00.000Z',
      cookies: org.cookies,
    });
    expect(due.json().total).toBe(1);
    expect(due.json().items[0].title).toBe('Overdue');

    const byAccount = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks?accountId=${accountId}`,
      cookies: org.cookies,
    });
    expect(byAccount.json().total).toBe(1);
  });

  it('validates assignee and linked records', async () => {
    const badAssignee = await createTask({
      title: 'X',
      assigneeId: '0198c5f0-0000-7000-8000-000000000000',
    });
    expect(badAssignee.statusCode).toBe(400);
    const badLink = await createTask({
      title: 'X',
      dealId: '0198c5f0-0000-7000-8000-000000000000',
    });
    expect(badLink.statusCode).toBe(400);
  });

  it('tasks sort with nulls last on dueAt', async () => {
    await createTask({ title: 'No due' });
    await createTask({ title: 'Has due', dueAt: '2026-12-01T00:00:00.000Z' });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/tasks', cookies: org.cookies });
    expect(res.json().items[0].title).toBe('Has due');
    expect(res.json().items[1].title).toBe('No due');
  });
});
