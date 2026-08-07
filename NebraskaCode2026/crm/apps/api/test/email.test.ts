import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureAnalysis } from '@crm/shared';
import { FakeEmbeddingProvider, FakeLlmProvider } from '../src/ai/fakeProvider.js';
import { FakeMailProvider } from '../src/modules/email/provider.js';
import { normalizeSubject } from '../src/modules/email/service.js';
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
let mail: FakeMailProvider;
let org: TestOrg;

const blankAnalysis: CaptureAnalysis = {
  summary: 'Email summarized.',
  actionItems: [],
  sentiment: 'neutral',
  suggestedUpdates: [],
  suggestedTasks: [],
  followUpEmail: null,
};

beforeAll(async () => {
  const config = testConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  fake = new FakeLlmProvider();
  mail = new FakeMailProvider();
  const app = buildApp({
    config,
    db,
    logger: false,
    llm: fake,
    embedder: new FakeEmbeddingProvider(),
    mail,
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
  mail.sent.length = 0;
  org = await registerOrg(ctx.app);
});

async function inbound(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/email/inbound', cookies: org.cookies, payload });
}

const shortBody = 'Quick note.';
const longBody =
  'Hello team, following up on our conversation about the renewal. We are happy with the product and would like to discuss expansion options for next quarter. Please send over the updated pricing sheet when you can.';

describe('subject normalization', () => {
  it('strips reply/forward prefixes recursively', () => {
    expect(normalizeSubject('Re: RE: Fwd: Pricing')).toBe('pricing');
    expect(normalizeSubject('  Pricing  ')).toBe('pricing');
  });
});

describe('inbound ingestion', () => {
  it('auto-creates a contact from an unknown sender and logs the activity', async () => {
    const res = await inbound({
      providerMessageId: 'msg-1',
      from: { email: 'jane.doe@newco.com', name: 'Jane Doe' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Introduction',
      body: shortBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contactCreated).toBe(true);
    expect(body.accountId).toBeNull();

    const contact = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${body.contactId}`,
      cookies: org.cookies,
    });
    expect(contact.json().firstName).toBe('Jane');
    expect(contact.json().lastName).toBe('Doe');
    expect(contact.json().email).toBe('jane.doe@newco.com');

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${body.contactId}/timeline`,
      cookies: org.cookies,
    });
    const types = timeline.json().items.map((i: { entryType: string }) => i.entryType);
    expect(types).toContain('activity.email');
  });

  it('parses names from the email local part when no display name', async () => {
    const res = await inbound({
      providerMessageId: 'msg-2',
      from: { email: 'sam_smith@corp.io' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Hi',
      body: shortBody,
    });
    const contact = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${res.json().contactId}`,
      cookies: org.cookies,
    });
    expect(contact.json().firstName).toBe('Sam');
    expect(contact.json().lastName).toBe('Smith');
  });

  it('matches the company by sender domain and links account + contact', async () => {
    const account = await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'NewCo', domain: 'newco.com' },
    });
    const accountId = account.json().id;

    const res = await inbound({
      providerMessageId: 'msg-3',
      from: { email: 'buyer@newco.com', name: 'Bud Buyer' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Question',
      body: shortBody,
    });
    expect(res.json().accountId).toBe(accountId);

    const contact = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${res.json().contactId}`,
      cookies: org.cookies,
    });
    expect(contact.json().accountId).toBe(accountId);

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { entryType: string }) => i.entryType === 'activity.email'),
    ).toBe(true);
  });

  it('never maps personal-mail domains to accounts', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Gmail Inc?!', domain: 'gmail.com' },
    });
    const res = await inbound({
      providerMessageId: 'msg-4',
      from: { email: 'someone@gmail.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Personal',
      body: shortBody,
    });
    expect(res.json().accountId).toBeNull();
  });

  it('reuses the existing contact for a known sender (no duplicates)', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Known', lastName: 'Sender', email: 'known@corp.com' },
    });
    const res = await inbound({
      providerMessageId: 'msg-5',
      from: { email: 'known@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Hello again',
      body: shortBody,
    });
    expect(res.json().contactCreated).toBe(false);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/contacts?query=known@corp.com',
      cookies: org.cookies,
    });
    expect(list.json().total).toBe(1);
  });

  it('detects duplicate deliveries by provider message id', async () => {
    const payload = {
      providerMessageId: 'msg-dup',
      from: { email: 'dup@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Once only',
      body: shortBody,
    };
    const first = await inbound(payload);
    expect(first.statusCode).toBe(201);
    const second = await inbound(payload);
    expect(second.statusCode).toBe(200);
    expect(second.json().duplicate).toBe(true);
    expect(second.json().activityId).toBe(first.json().activityId);

    const activities = await ctx.app.inject({
      method: 'GET',
      url: '/api/activities?type=email&query=Once only',
      cookies: org.cookies,
    });
    expect(activities.json().total).toBe(1);
  });

  it('summarizes substantive emails via the capture pipeline (short ones skipped)', async () => {
    fake.queueStructured(blankAnalysis);
    const long = await inbound({
      providerMessageId: 'msg-long',
      from: { email: 'talker@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Renewal and expansion',
      body: longBody,
    });
    const result = await ctx.app.inject({
      method: 'GET',
      url: `/api/captures/${long.json().activityId}`,
      cookies: org.cookies,
    });
    expect(result.json().status).toBe('analyzed');
    expect(result.json().summary).toBe('Email summarized.');

    const short = await inbound({
      providerMessageId: 'msg-short',
      from: { email: 'terse@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'ok',
      body: shortBody,
    });
    const shortResult = await ctx.app.inject({
      method: 'GET',
      url: `/api/captures/${short.json().activityId}`,
      cookies: org.cookies,
    });
    expect(shortResult.json().status).toBe('queued'); // no analysis ran
  });
});

describe('threading', () => {
  it('groups replies by inReplyTo and by normalized subject fallback', async () => {
    const first = await inbound({
      providerMessageId: 'thread-1',
      from: { email: 'thread@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Contract terms',
      body: shortBody,
    });
    const threadKey = first.json().threadKey;

    const reply = await inbound({
      providerMessageId: 'thread-2',
      from: { email: 'thread@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Re: Contract terms',
      body: shortBody,
      inReplyTo: 'thread-1',
    });
    expect(reply.json().threadKey).toBe(threadKey);

    // no inReplyTo → subject + counterpart fallback
    const laterReply = await inbound({
      providerMessageId: 'thread-3',
      from: { email: 'thread@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'RE: RE: Contract terms',
      body: shortBody,
    });
    expect(laterReply.json().threadKey).toBe(threadKey);

    const thread = await ctx.app.inject({
      method: 'GET',
      url: `/api/email/threads/${threadKey}`,
      cookies: org.cookies,
    });
    expect(thread.json().messages).toHaveLength(3);

    // unrelated subject → new thread
    const other = await inbound({
      providerMessageId: 'thread-4',
      from: { email: 'thread@corp.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Completely different topic',
      body: shortBody,
    });
    expect(other.json().threadKey).not.toBe(threadKey);
  });
});

describe('outbound', () => {
  it('sends through the provider and records a linked outbound activity', async () => {
    const contact = await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Recip', lastName: 'Ient', email: 'recip@corp.com' },
    });
    const contactId = contact.json().contact.id;

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: org.cookies,
      payload: { to: ['recip@corp.com'], subject: 'Proposal attached', body: 'Here is the proposal.' },
    });
    expect(res.statusCode).toBe(201);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toEqual(['recip@corp.com']);

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${contactId}/timeline`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { summary: string }) => i.summary.includes('Proposal attached')),
    ).toBe(true);
  });

  it('replying threads onto the inbound conversation', async () => {
    const inboundRes = await inbound({
      providerMessageId: 'conv-1',
      from: { email: 'pen@pal.com' },
      to: [{ email: 'me@ourcrm.com' }],
      subject: 'Question about pricing',
      body: shortBody,
    });
    const reply = await ctx.app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: org.cookies,
      payload: {
        to: ['pen@pal.com'],
        subject: 'Re: Question about pricing',
        body: 'Answer inside.',
        inReplyToActivityId: inboundRes.json().activityId,
      },
    });
    expect(reply.json().threadKey).toBe(inboundRes.json().threadKey);
    expect(mail.sent[0]!.inReplyTo).toBe('conv-1');

    const thread = await ctx.app.inject({
      method: 'GET',
      url: `/api/email/threads/${inboundRes.json().threadKey}`,
      cookies: org.cookies,
    });
    const directions = thread.json().messages.map((m: { direction: string }) => m.direction);
    expect(directions).toEqual(['inbound', 'outbound']);
  });

  it('sends an AI draft and clears the draft flag', async () => {
    // create a draft the way Prompt 9 does
    const draft = await ctx.app.inject({
      method: 'POST',
      url: '/api/activities',
      cookies: org.cookies,
      payload: {
        type: 'email',
        direction: 'outbound',
        subject: 'Follow-up draft',
        body: 'Draft body.',
        metadata: { draft: true, generatedBy: 'ai' },
        links: {
          contacts: [
            (
              await ctx.app.inject({
                method: 'POST',
                url: '/api/contacts',
                cookies: org.cookies,
                payload: { firstName: 'Draft', lastName: 'Target', email: 'draft@corp.com' },
              })
            ).json().contact.id,
          ],
        },
      },
    });
    const activityId = draft.json().id;

    const sent = await ctx.app.inject({
      method: 'POST',
      url: `/api/email/drafts/${activityId}/send`,
      cookies: org.cookies,
      payload: { to: ['draft@corp.com'] },
    });
    expect(sent.statusCode).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject).toBe('Follow-up draft');

    const activity = await ctx.app.inject({
      method: 'GET',
      url: `/api/activities/${activityId}`,
      cookies: org.cookies,
    });
    expect(activity.json().metadata.draft).toBe(false);
    expect(activity.json().metadata.sentAt).toBeTruthy();

    // not a draft anymore → second send rejected
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/email/drafts/${activityId}/send`,
      cookies: org.cookies,
      payload: { to: ['draft@corp.com'] },
    });
    expect(again.statusCode).toBe(400);
  });
});
