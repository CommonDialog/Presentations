import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

let ctx: TestContext;
let org: TestOrg;
let accountId: string;
let contactId: string;
let dealId: string;

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
      payload: { name: 'Activity Corp' },
    })
  ).json().id;
  contactId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Act', lastName: 'Ive', accountId },
    })
  ).json().contact.id;
  dealId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Activity Deal', accountId, amount: 1000 },
    })
  ).json().id;
});

async function logActivity(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/activities', cookies: org.cookies, payload });
}

async function timelineOf(kind: string, id: string) {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/${kind}s/${id}/timeline?pageSize=50`,
    cookies: org.cookies,
  });
  return res.json();
}

describe('activities', () => {
  it('requires at least one link and validates links in-org', async () => {
    const none = await logActivity({ type: 'note', subject: 'Orphan', links: {} });
    expect(none.statusCode).toBe(400);
    const bad = await logActivity({
      type: 'note',
      subject: 'Bad link',
      links: { accounts: ['0198c5f0-0000-7000-8000-000000000000'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('a call linked to account+contact+deal appears once in each timeline', async () => {
    const res = await logActivity({
      type: 'call',
      direction: 'outbound',
      subject: 'Discovery call',
      body: 'Talked pricing.',
      links: { accounts: [accountId], contacts: [contactId], deals: [dealId] },
    });
    expect(res.statusCode).toBe(201);
    const activity = res.json();
    expect(activity.links.accounts[0].label).toBe('Activity Corp');
    expect(activity.links.contacts[0].label).toBe('Act Ive');

    for (const [kind, id] of [
      ['account', accountId],
      ['contact', contactId],
      ['deal', dealId],
    ] as const) {
      const timeline = await timelineOf(kind, id);
      const calls = timeline.items.filter(
        (i: { entryType: string }) => i.entryType === 'activity.call',
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].summary).toBe('Call: Discovery call');
    }
  });

  it('honors occurredAt for chronological ordering', async () => {
    await logActivity({
      type: 'note',
      subject: 'Old note',
      occurredAt: '2026-01-01T10:00:00.000Z',
      links: { accounts: [accountId] },
    });
    await logActivity({
      type: 'note',
      subject: 'Fresh note',
      links: { accounts: [accountId] },
    });
    const timeline = await timelineOf('account', accountId);
    const subjects = timeline.items.map((i: { summary: string }) => i.summary);
    const oldIdx = subjects.indexOf('Note: Old note');
    const freshIdx = subjects.indexOf('Note: Fresh note');
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBe(subjects.length - 1); // 2026-01-01 predates everything else
    expect(freshIdx).toBeLessThan(oldIdx);
  });

  it('editing subject/occurredAt syncs the timeline projections', async () => {
    const activity = (
      await logActivity({ type: 'meeting', subject: 'Kickoff', links: { accounts: [accountId] } })
    ).json();
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/activities/${activity.id}`,
      cookies: org.cookies,
      payload: { subject: 'Kickoff (rescheduled)', occurredAt: '2026-02-01T09:00:00.000Z' },
    });
    expect(patched.statusCode).toBe(200);

    const timeline = await timelineOf('account', accountId);
    const meetings = timeline.items.filter(
      (i: { entryType: string }) => i.entryType === 'activity.meeting',
    );
    expect(meetings).toHaveLength(1);
    expect(meetings[0].summary).toBe('Meeting: Kickoff (rescheduled)');
    expect(meetings[0].occurredAt).toBe('2026-02-01T09:00:00.000Z');
  });

  it('replacing links moves the timeline projection', async () => {
    const activity = (
      await logActivity({ type: 'note', subject: 'Movable', links: { accounts: [accountId] } })
    ).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/activities/${activity.id}`,
      cookies: org.cookies,
      payload: { links: { deals: [dealId] } },
    });
    const accountTimeline = await timelineOf('account', accountId);
    expect(
      accountTimeline.items.filter((i: { summary: string }) => i.summary === 'Note: Movable'),
    ).toHaveLength(0);
    const dealTimeline = await timelineOf('deal', dealId);
    expect(
      dealTimeline.items.filter((i: { summary: string }) => i.summary === 'Note: Movable'),
    ).toHaveLength(1);
  });

  it('archive removes projections; restore brings them back', async () => {
    const activity = (
      await logActivity({ type: 'email', subject: 'Ephemeral', links: { accounts: [accountId] } })
    ).json();
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/activities/${activity.id}`,
      cookies: org.cookies,
    });
    let timeline = await timelineOf('account', accountId);
    expect(timeline.items.some((i: { summary: string }) => i.summary === 'Email: Ephemeral')).toBe(false);

    await ctx.app.inject({
      method: 'POST',
      url: `/api/activities/${activity.id}/restore`,
      cookies: org.cookies,
    });
    timeline = await timelineOf('account', accountId);
    expect(timeline.items.some((i: { summary: string }) => i.summary === 'Email: Ephemeral')).toBe(true);
  });

  it('filters by entity and type; searches subject/body', async () => {
    await logActivity({ type: 'call', subject: 'Call A', links: { accounts: [accountId] } });
    await logActivity({ type: 'note', subject: 'Note B', body: 'about pricing', links: { deals: [dealId] } });

    const byDeal = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities?dealId=${dealId}`,
      cookies: org.cookies,
    });
    expect(byDeal.json().total).toBe(1);
    expect(byDeal.json().items[0].subject).toBe('Note B');

    const byType = await ctx.app.inject({
      method: 'GET',
      url: '/api/activities?type=call',
      cookies: org.cookies,
    });
    expect(byType.json().total).toBe(1);

    const search = await ctx.app.inject({
      method: 'GET',
      url: '/api/activities?query=pricing',
      cookies: org.cookies,
    });
    expect(search.json().total).toBe(1);
  });

  it('org-wide timeline contains everything chronologically', async () => {
    await logActivity({ type: 'note', subject: 'Feed item', links: { accounts: [accountId] } });
    const feed = await ctx.app.inject({
      method: 'GET',
      url: '/api/timeline?pageSize=100',
      cookies: org.cookies,
    });
    expect(feed.statusCode).toBe(200);
    const summaries = feed.json().items.map((i: { summary: string }) => i.summary);
    expect(summaries).toContain('Note: Feed item');
    expect(summaries).toContain('Account "Activity Corp" created');
    const times = feed.json().items.map((i: { occurredAt: string }) => new Date(i.occurredAt).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});
