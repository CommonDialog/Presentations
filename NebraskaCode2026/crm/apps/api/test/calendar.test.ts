import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureAnalysis, MeetingPrep } from '@crm/shared';
import { FakeEmbeddingProvider, FakeLlmProvider } from '../src/ai/fakeProvider.js';
import { FakeCalendarProvider } from '../src/modules/calendar/provider.js';
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
let calendar: FakeCalendarProvider;
let org: TestOrg;
let accountId: string;
let contactId: string;

const futureStart = new Date(Date.now() + 3 * 86_400_000).toISOString();
const futureEnd = new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString();

const prepFixture: MeetingPrep = {
  objectives: ['Confirm the renewal budget'],
  talkingPoints: ['They asked for updated pricing last week'],
  openQuestions: ['Who signs the contract?'],
  risks: ['CFO not engaged yet'],
  attendeeNotes: [{ name: 'Cal Endar', note: 'VP Ops, our champion' }],
};

const analysisFixture: CaptureAnalysis = {
  summary: 'Meeting covered renewal scope.',
  actionItems: ['Send recap'],
  sentiment: 'positive',
  suggestedUpdates: [],
  suggestedTasks: [{ title: 'Send recap notes', description: '', dueInDays: 1, priority: 'normal' }],
  followUpEmail: null,
};

beforeAll(async () => {
  const config = testConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  fake = new FakeLlmProvider();
  calendar = new FakeCalendarProvider();
  const app = buildApp({
    config,
    db,
    logger: false,
    llm: fake,
    embedder: new FakeEmbeddingProvider(),
    calendar,
  });
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
  calendar.created.length = 0;
  org = await registerOrg(ctx.app);
  accountId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'MeetCo', domain: 'meetco.com' },
    })
  ).json().id;
  contactId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Cal', lastName: 'Endar', email: 'cal@meetco.com', accountId },
    })
  ).json().contact.id;
});

async function ingest(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/calendar/events', cookies: org.cookies, payload });
}

describe('calendar ingestion', () => {
  it('creates a meeting activity with matched attendees and timeline entries', async () => {
    const res = await ingest({
      providerEventId: 'evt-1',
      title: 'Renewal sync',
      startsAt: futureStart,
      endsAt: futureEnd,
      location: 'Zoom',
      attendees: [{ email: 'cal@meetco.com', name: 'Cal Endar' }, { email: org.email }],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.matchedContactIds).toContain(contactId);
    expect(body.matchedAccountIds).toContain(accountId);
    expect(body.unmatchedAttendees).toHaveLength(0); // own email excluded

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { summary: string }) => i.summary.includes('Renewal sync')),
    ).toBe(true);
  });

  it('matches unknown attendees to accounts by domain', async () => {
    const res = await ingest({
      providerEventId: 'evt-2',
      title: 'Domain match',
      startsAt: futureStart,
      endsAt: futureEnd,
      attendees: [{ email: 'stranger@meetco.com' }],
    });
    const body = res.json();
    expect(body.matchedContactIds).toHaveLength(0);
    expect(body.matchedAccountIds).toContain(accountId);
    expect(body.unmatchedAttendees).toContain('stranger@meetco.com');
  });

  it('rejects meetings with no CRM linkage', async () => {
    const res = await ingest({
      providerEventId: 'evt-3',
      title: 'Strangers only',
      startsAt: futureStart,
      endsAt: futureEnd,
      attendees: [{ email: 'nobody@gmail.com' }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('dedupes by provider event id', async () => {
    const payload = {
      providerEventId: 'evt-dup',
      title: 'Once',
      startsAt: futureStart,
      endsAt: futureEnd,
      attendees: [{ email: 'cal@meetco.com' }],
    };
    const first = await ingest(payload);
    const second = await ingest(payload);
    expect(second.statusCode).toBe(200);
    expect(second.json().duplicate).toBe(true);
    expect(second.json().activityId).toBe(first.json().activityId);
  });

  it('lists upcoming meetings in order', async () => {
    await ingest({
      providerEventId: 'evt-later',
      title: 'Later meeting',
      startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString(),
      attendees: [{ email: 'cal@meetco.com' }],
    });
    await ingest({
      providerEventId: 'evt-sooner',
      title: 'Sooner meeting',
      startsAt: futureStart,
      endsAt: futureEnd,
      attendees: [{ email: 'cal@meetco.com' }],
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/upcoming',
      cookies: org.cookies,
    });
    const titles = res.json().meetings.map((m: { title: string }) => m.title);
    expect(titles).toEqual(['Sooner meeting', 'Later meeting']);
    expect(res.json().meetings[0].contactIds).toContain(contactId);
  });

  it('creates events outbound through the provider then ingests locally', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/calendar/events/create',
      cookies: org.cookies,
      payload: {
        title: 'Kickoff call',
        startsAt: futureStart,
        endsAt: futureEnd,
        attendeeEmails: ['cal@meetco.com'],
        accountId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(calendar.created).toHaveLength(1);
    expect(calendar.created[0]!.title).toBe('Kickoff call');
    expect(res.json().providerEventId).toBe(calendar.created[0]!.providerEventId);
    expect(res.json().matchedContactIds).toContain(contactId);
  });
});

describe('meeting preparation', () => {
  it('generates prep from CRM context and stores it as an artifact', async () => {
    const meeting = await ingest({
      providerEventId: 'evt-prep',
      title: 'Big renewal meeting',
      startsAt: futureStart,
      endsAt: futureEnd,
      attendees: [{ email: 'cal@meetco.com' }],
    });
    const activityId = meeting.json().activityId;

    fake.queueStructured(prepFixture);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/meetings/${activityId}/prepare`,
      cookies: org.cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prep.objectives).toContain('Confirm the renewal budget');

    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/api/meetings/${activityId}/prep`,
      cookies: org.cookies,
    });
    expect(fetched.json().prep.prep.attendeeNotes[0].name).toBe('Cal Endar');

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { entryType: string }) => i.entryType === 'ai.meeting_prep'),
    ).toBe(true);
  });

  it('rejects prep for non-meeting activities', async () => {
    const note = await ctx.app.inject({
      method: 'POST',
      url: '/api/activities',
      cookies: org.cookies,
      payload: { type: 'note', subject: 'Not a meeting', links: { accounts: [accountId] } },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/meetings/${note.json().id}/prepare`,
      cookies: org.cookies,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('meeting summaries', () => {
  it('attaches the transcript and runs it through the capture pipeline', async () => {
    const meeting = await ingest({
      providerEventId: 'evt-sum',
      title: 'Summary meeting',
      startsAt: futureStart,
      endsAt: futureEnd,
      attendees: [{ email: 'cal@meetco.com' }],
    });
    const activityId = meeting.json().activityId;

    fake.queueStructured(analysisFixture);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/meetings/${activityId}/summarize`,
      cookies: org.cookies,
      payload: { transcript: 'Full transcript of the renewal discussion goes here in detail.' },
    });
    expect(res.statusCode).toBe(200);

    // summary + proposals attached to the meeting activity
    const capture = await ctx.app.inject({
      method: 'GET',
      url: `/api/captures/${activityId}`,
      cookies: org.cookies,
    });
    expect(capture.json().summary).toBe('Meeting covered renewal scope.');
    expect(capture.json().proposals).toHaveLength(1);

    // transcript persisted on the meeting record
    const activity = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities/${activityId}`,
      cookies: org.cookies,
    });
    expect(activity.json().body).toContain('Full transcript');
  });
});
