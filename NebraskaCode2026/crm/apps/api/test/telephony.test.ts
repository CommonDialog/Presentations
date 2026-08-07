import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureAnalysis } from '@crm/shared';
import { FakeEmbeddingProvider, FakeLlmProvider } from '../src/ai/fakeProvider.js';
import { FakeTelephonyProvider } from '../src/modules/telephony/provider.js';
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
let telephony: FakeTelephonyProvider;
let org: TestOrg;
let accountId: string;
let contactId: string;

const analysisFixture: CaptureAnalysis = {
  summary: 'Customer agreed to a follow-up demo next week.',
  actionItems: ['Schedule demo'],
  sentiment: 'positive',
  suggestedUpdates: [],
  suggestedTasks: [{ title: 'Schedule demo', description: '', dueInDays: 2, priority: 'high' }],
  followUpEmail: { subject: 'Demo scheduling', body: 'Thanks for the call — proposing Tuesday.' },
};

beforeAll(async () => {
  const config = testConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  fake = new FakeLlmProvider();
  telephony = new FakeTelephonyProvider();
  const app = buildApp({
    config,
    db,
    logger: false,
    llm: fake,
    embedder: new FakeEmbeddingProvider(),
    telephony,
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
  telephony.calls.length = 0;
  org = await registerOrg(ctx.app);
  accountId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'CallCo' },
    })
  ).json().id;
  contactId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: {
        firstName: 'Tele',
        lastName: 'Phone',
        email: 'tele@callco.com',
        phone: '+1 555 0100',
        accountId,
      },
    })
  ).json().contact.id;
});

async function startCall(payload: Record<string, unknown> = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/calls',
    cookies: org.cookies,
    payload: { contactId, ...payload },
  });
}

describe('click-to-call', () => {
  it('places the call via the provider and opens an in-progress call activity', async () => {
    const res = await startCall();
    expect(res.statusCode).toBe(201);
    const call = res.json();
    expect(call.status).toBe('in_progress');
    expect(call.to).toBe('+1 555 0100');
    expect(call.accountId).toBe(accountId); // inherited from the contact
    expect(telephony.calls).toHaveLength(1);
    expect(telephony.calls[0]!.to).toBe('+1 555 0100');

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${contactId}/timeline`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { entryType: string }) => i.entryType === 'activity.call'),
    ).toBe(true);
  });

  it('rejects contacts without a phone number', async () => {
    const phoneless = await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'No', lastName: 'Phone' },
    });
    const res = await startCall({ contactId: phoneless.json().contact.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/phone/);
  });
});

describe('call completion', () => {
  it('stores duration, recording and disposition; no transcript → no AI call', async () => {
    const call = (await startCall()).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${call.activityId}/complete`,
      cookies: org.cookies,
      payload: { durationSeconds: 240, disposition: 'connected' },
    });
    expect(res.statusCode).toBe(200);

    const activity = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities/${call.activityId}`,
      cookies: org.cookies,
    });
    const metadata = activity.json().metadata;
    expect(metadata.status).toBe('completed');
    expect(metadata.durationSeconds).toBe(240);
    expect(metadata.disposition).toBe('connected');
    expect(metadata.recordingUrl).toContain('recordings.local');
    expect(fake.calls).toHaveLength(0); // no LLM without a transcript
  });

  it('routes the transcript through the capture pipeline: summary + follow-up proposals', async () => {
    const call = (await startCall({ dealId: undefined })).json();
    fake.queueStructured(analysisFixture);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${call.activityId}/complete`,
      cookies: org.cookies,
      payload: {
        durationSeconds: 600,
        disposition: 'connected',
        transcript: 'Rep: Thanks for joining. Customer: We want a demo next week...',
      },
    });
    expect(res.statusCode).toBe(200);

    const capture = await ctx.app.inject({
      method: 'GET',
      url: `/api/captures/${call.activityId}`,
      cookies: org.cookies,
    });
    expect(capture.json().summary).toBe('Customer agreed to a follow-up demo next week.');
    const proposalTypes = capture
      .json()
      .proposals.map((p: { proposalType: string }) => p.proposalType)
      .sort();
    expect(proposalTypes).toEqual(['create_task', 'followup_email']); // follow-up generation

    // transcript persisted on the call record
    const activity = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities/${call.activityId}`,
      cookies: org.cookies,
    });
    expect(activity.json().body).toContain('demo next week');
  });

  it('rejects double completion', async () => {
    const call = (await startCall()).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${call.activityId}/complete`,
      cookies: org.cookies,
      payload: { durationSeconds: 60 },
    });
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${call.activityId}/complete`,
      cookies: org.cookies,
      payload: { durationSeconds: 60 },
    });
    expect(again.statusCode).toBe(400);
  });
});

describe('disposition', () => {
  it('sets and corrects the disposition with audit trail', async () => {
    const call = (await startCall()).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${call.activityId}/disposition`,
      cookies: org.cookies,
      payload: { disposition: 'voicemail', notes: 'Left a message about pricing' },
    });
    expect(res.statusCode).toBe(204);

    const activity = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities/${call.activityId}`,
      cookies: org.cookies,
    });
    expect(activity.json().metadata.disposition).toBe('voicemail');
    expect(activity.json().metadata.dispositionNotes).toContain('pricing');

    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${call.activityId}/disposition`,
      cookies: org.cookies,
      payload: { disposition: 'ghosted' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('404s for non-call activities', async () => {
    const note = await ctx.app.inject({
      method: 'POST',
      url: '/api/activities',
      cookies: org.cookies,
      payload: { type: 'note', subject: 'Not a call', links: { accounts: [accountId] } },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/calls/${note.json().id}/disposition`,
      cookies: org.cookies,
      payload: { disposition: 'connected' },
    });
    expect(res.statusCode).toBe(404);
  });
});
