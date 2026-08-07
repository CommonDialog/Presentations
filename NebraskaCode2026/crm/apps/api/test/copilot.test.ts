import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LlmRequest } from '../src/ai/types.js';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { FakeLlmProvider } from '../src/ai/fakeProvider.js';
import { registerOrg, resetDb, testConfig, type TestOrg } from './helpers/testApp.js';

let app: FastifyInstance;
let db: Db;
let closePool: () => Promise<void>;
let fake: FakeLlmProvider;
let org: TestOrg;
let accountId: string;

beforeAll(async () => {
  const config = testConfig();
  const created = createDb(config.DATABASE_URL);
  db = created.db;
  closePool = () => created.pool.end();
  fake = new FakeLlmProvider(); // strict: every structured call must be scripted
  app = buildApp({ config, db, logger: false, llm: fake });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb(db);
  fake.calls.length = 0;
  org = await registerOrg(app);
  accountId = (
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Acme Rockets', domain: 'acme.test', industry: 'Aerospace' },
    })
  ).json().id;
});

async function ask(message: string, conversationId?: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/copilot/ask',
    cookies: org.cookies,
    payload: { message, ...(conversationId ? { conversationId } : {}) },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** The most recent non-structured request the responder LLM saw. */
function lastRespondCall(): LlmRequest {
  return fake.calls[fake.calls.length - 1]!;
}

describe('copilot', () => {
  it('requires ai:use', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/copilot/ask', payload: { message: 'hi' } });
    expect(res.statusCode).toBe(401);
  });

  it('summarizes an account grounded in real CRM rows', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Acme expansion', accountId, amount: 60000 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/activities',
      cookies: org.cookies,
      payload: {
        type: 'call',
        subject: 'Pricing discussion',
        body: 'They pushed back on the premium tier price.',
        links: { accounts: [accountId] },
      },
    });

    fake.queueStructured({
      intent: 'summarize_account',
      entityType: 'account',
      entityName: 'Acme Rockets',
      detail: null,
    });
    fake.queueText('Acme Rockets summary: one open deal, pricing pushback on the last call.');

    const res = await ask('catch me up on Acme Rockets');
    expect(res.intent).toBe('summarize_account');
    expect(res.message).toContain('Acme Rockets summary');
    expect(res.sources.some((s: { type: string; id: string }) => s.type === 'account' && s.id === accountId)).toBe(true);

    // the responder was fed the actual rows, and the anti-fabrication rules
    const respond = lastRespondCall();
    expect(respond.system).toContain('NEVER invent');
    const userContent = respond.messages[respond.messages.length - 1]!.content;
    expect(userContent).toContain('Deal: "Acme expansion"');
    expect(userContent).toContain('Pricing discussion');
    expect(userContent).toContain('pushed back on the premium tier');
  });

  it('keeps conversation history across turns', async () => {
    fake.queueStructured({ intent: 'answer_question', entityType: 'account', entityName: 'Acme Rockets', detail: null });
    fake.queueText('First answer.');
    const first = await ask('tell me about acme');

    fake.queueStructured({ intent: 'answer_question', entityType: 'account', entityName: 'Acme Rockets', detail: null });
    fake.queueText('Second answer.');
    await ask('and their open deals?', first.conversationId);

    const respond = lastRespondCall();
    const roles = respond.messages.map((m) => m.role);
    expect(roles.slice(0, 2)).toEqual(['user', 'assistant']); // prior turn included
    expect(respond.messages[1]!.content).toBe('First answer.');

    const conversation = await app.inject({
      method: 'GET',
      url: `/api/copilot/conversations/${first.conversationId}`,
      cookies: org.cookies,
    });
    expect(conversation.json().messages).toHaveLength(4);
  });

  it('navigates to pages and records deterministically — no generation involved', async () => {
    fake.queueStructured({ intent: 'navigate', entityType: null, entityName: null, detail: 'reports' });
    const page = await ask('show me the reports dashboard');
    expect(page.navigation).toEqual({ url: '/reports', label: 'Reports' });

    fake.queueStructured({ intent: 'navigate', entityType: 'account', entityName: 'Acme Rockets', detail: null });
    const record = await ask('open acme rockets');
    expect(record.navigation.url).toBe(`/accounts/${accountId}`);
    expect(record.sources[0].id).toBe(accountId);
  });

  it('generates reports from live report data', async () => {
    fake.queueStructured({ intent: 'generate_report', entityType: null, entityName: null, detail: 'sales' });
    fake.queueText('You won nothing this month. Chin up.');
    const res = await ask('how are sales going?');
    expect(res.navigation).toEqual({ url: '/reports', label: 'Open reports' });

    const userContent = lastRespondCall().messages.at(-1)!.content;
    expect(userContent).toContain('Sales report (30d)');
    expect(userContent).toContain('Pipeline forecast');
    expect(userContent).toContain('"winRate"');
  });

  it('grounds risk questions in the org snapshot and stalled deals', async () => {
    fake.queueStructured({ intent: 'predict_risks', entityType: null, entityName: null, detail: null });
    fake.queueText('Main risk: nothing is moving.');
    await ask('what could go wrong this quarter?');

    const userContent = lastRespondCall().messages.at(-1)!.content;
    expect(userContent).toContain('Org snapshot (30d)');
    expect(userContent).toContain('Stalled deals');
  });

  it('tells the responder when nothing matched instead of inventing context', async () => {
    fake.queueStructured({
      intent: 'answer_question',
      entityType: 'account',
      entityName: 'Globex Corporation',
      detail: null,
    });
    fake.queueText('There is no Globex Corporation in the CRM.');
    const res = await ask('what is our history with Globex Corporation?');
    expect(res.message).toContain('no Globex');

    const userContent = lastRespondCall().messages.at(-1)!.content;
    expect(userContent).toContain('No CRM record matched "Globex Corporation"');
  });

  it('degrades to a grounded answer when the planner is unavailable', async () => {
    // nothing queued: the structured plan call throws, complete() echoes
    const res = await ask('anything happening with acme?');
    expect(res.intent).toBe('answer_question');
    expect(res.message.length).toBeGreaterThan(0);
    // fallback still searched the CRM for grounding
    expect(res.sources.some((s: { type: string }) => s.type === 'account')).toBe(true);
  });
});
