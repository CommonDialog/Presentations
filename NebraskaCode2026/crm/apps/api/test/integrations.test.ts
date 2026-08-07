import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PipelineDto } from '@crm/shared';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { FakeHttpPoster } from '../src/lib/http.js';
import { registerOrg, resetDb, testConfig, type TestOrg } from './helpers/testApp.js';

let app: FastifyInstance;
let db: Db;
let closePool: () => Promise<void>;
let http: FakeHttpPoster;
let org: TestOrg;
let pipeline: PipelineDto;
let accountId: string;

beforeAll(async () => {
  const config = testConfig();
  const created = createDb(config.DATABASE_URL);
  db = created.db;
  closePool = () => created.pool.end();
  http = new FakeHttpPoster();
  app = buildApp({ config, db, logger: false, http });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closePool();
});
beforeEach(async () => {
  await resetDb(db);
  http.posts.length = 0;
  org = await registerOrg(app);
  pipeline = (
    await app.inject({ method: 'GET', url: '/api/pipelines', cookies: org.cookies })
  ).json().pipelines[0];
  accountId = (
    await app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Integration Corp', domain: 'integration.test' },
    })
  ).json().id;
});

describe('REST API keys', () => {
  it('issues a bearer token that authenticates API calls', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/integrations/api-keys',
      cookies: org.cookies,
      payload: { name: 'CI script' },
    });
    expect(created.statusCode).toBe(201);
    const { token, key } = created.json();
    expect(token).toMatch(/^crm_[0-9a-f]{48}$/);

    const viaKey = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaKey.statusCode).toBe(200);
    expect(viaKey.json().items[0].name).toBe('Integration Corp');

    // the key can even write, with the creator's permissions
    const write = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Via', lastName: 'Api' },
    });
    expect(write.statusCode).toBe(201);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/integrations/api-keys/${key.id}`,
      cookies: org.cookies,
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('rejects unknown tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { authorization: 'Bearer crm_definitelynotreal' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Slack / Teams', () => {
  it('stores the config and posts a test message', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/integrations',
      cookies: org.cookies,
      payload: { kind: 'slack', config: { webhookUrl: 'https://hooks.slack.test/T123' }, enabled: true },
    });
    expect(saved.statusCode).toBe(200);

    const test = await app.inject({
      method: 'POST',
      url: '/api/integrations/slack/test',
      cookies: org.cookies,
      payload: {},
    });
    expect(test.json().posted).toBe(true);
    expect(http.posts).toHaveLength(1);
    expect(http.posts[0]!.url).toBe('https://hooks.slack.test/T123');
    expect(JSON.parse(http.posts[0]!.body).text).toContain('Test message');
  });

  it('rejects enabling chat without a webhook URL', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/integrations',
      cookies: org.cookies,
      payload: { kind: 'teams', config: {}, enabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('workflow post_message action delivers to the configured channel', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/integrations',
      cookies: org.cookies,
      payload: { kind: 'slack', config: { webhookUrl: 'https://hooks.slack.test/wf' }, enabled: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/workflows',
      cookies: org.cookies,
      payload: {
        name: 'Won → Slack',
        triggerType: 'deal.won',
        actions: [{ type: 'post_message', target: 'slack', message: '🎉 {{deal.name}} won!' }],
      },
    });

    const deal = (
      await app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Big win', accountId, amount: 9000 },
      })
    ).json();
    const wonStage = pipeline.stages.find((s) => s.isWon)!;
    await app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: wonStage.id },
    });

    const slackPosts = http.posts.filter((p) => p.url === 'https://hooks.slack.test/wf');
    expect(slackPosts).toHaveLength(1);
    expect(JSON.parse(slackPosts[0]!.body).text).toBe('🎉 Big win won!');
  });
});

describe('outbound webhooks', () => {
  it('delivers subscribed events with a valid HMAC signature and logs it', async () => {
    const hook = (
      await app.inject({
        method: 'POST',
        url: '/api/integrations/webhooks',
        cookies: org.cookies,
        payload: { url: 'https://example.test/hook', secret: 'super-secret-1', events: ['lead.created'] },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'Hook', lastName: 'Target' },
    });

    const posts = http.posts.filter((p) => p.url === 'https://example.test/hook');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers['X-CRM-Event']).toBe('lead.created');
    const expected = `sha256=${createHmac('sha256', 'super-secret-1').update(posts[0]!.body).digest('hex')}`;
    expect(posts[0]!.headers['X-CRM-Signature']).toBe(expected);
    const payload = JSON.parse(posts[0]!.body);
    expect(payload.event).toBe('lead.created');
    expect(payload.data.lead.lastName).toBe('Target');

    const deliveries = await app.inject({
      method: 'GET',
      url: `/api/integrations/webhooks/${hook.id}/deliveries`,
      cookies: org.cookies,
    });
    expect(deliveries.json().deliveries).toHaveLength(1);
    expect(deliveries.json().deliveries[0].status).toBe('delivered');
  });

  it('skips non-subscribed events and records failures', async () => {
    const hook = (
      await app.inject({
        method: 'POST',
        url: '/api/integrations/webhooks',
        cookies: org.cookies,
        payload: { url: 'https://example.test/deals-only', events: ['deal.won'] },
      })
    ).json();

    // lead.created is not subscribed → nothing delivered
    await app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'No', lastName: 'Hook' },
    });
    expect(http.posts.filter((p) => p.url === 'https://example.test/deals-only')).toHaveLength(0);

    // deal.won is subscribed but the endpoint fails → failed delivery logged
    http.failNext(1);
    const deal = (
      await app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Failing hook deal', accountId, amount: 100 },
      })
    ).json();
    const wonStage = pipeline.stages.find((s) => s.isWon)!;
    await app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: wonStage.id },
    });

    const deliveries = await app.inject({
      method: 'GET',
      url: `/api/integrations/webhooks/${hook.id}/deliveries`,
      cookies: org.cookies,
    });
    expect(deliveries.json().deliveries).toHaveLength(1);
    expect(deliveries.json().deliveries[0].status).toBe('failed');
  });
});

describe('import / export', () => {
  it('imports contacts from CSV, skipping duplicates and bad rows', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Already', lastName: 'Here', email: 'dup@example.test' },
    });

    const csv = [
      'First Name,Last Name,Email,Title,Company',
      'Ada,Lovelace,ada@example.test,Engineer,Integration Corp',
      'Dup,Person,dup@example.test,,',
      ',,missing-names@example.test,,',
      '"Grace","Hopper",grace@example.test,Admiral,',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/contact',
      cookies: org.cookies,
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.created).toBe(2);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s: { row: number }) => s.row).sort()).toEqual([3, 4]);

    const contacts = await app.inject({ method: 'GET', url: '/api/contacts', cookies: org.cookies });
    const names = contacts.json().items.map((c: { firstName: string }) => c.firstName);
    expect(names).toContain('Ada');
    expect(names).toContain('Grace');
    // Ada got linked to the account by company name
    const ada = contacts.json().items.find((c: { firstName: string }) => c.firstName === 'Ada');
    expect(ada.accountId).toBe(accountId);
  });

  it('exports deals as CSV', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/deals',
      cookies: org.cookies,
      payload: { name: 'Exportable deal', accountId, amount: 4200 },
    });
    const res = await app.inject({ method: 'GET', url: '/api/export/deal', cookies: org.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('Exportable deal');
    expect(res.body).toContain('Integration Corp');
    expect(res.body.split('\r\n')[0]).toBe('name,account,stage,status,amount,currency,expectedCloseDate,closedAt,createdAt');
  });
});

describe('data enrichment', () => {
  it('fills empty account fields, never overwriting, and suggests LinkedIn', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/enrich/accounts/${accountId}`,
      cookies: org.cookies,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const enriched = first.json();
    expect(enriched.provider).toContain('linkedin');
    expect(enriched.applied).toContain('industry');
    expect(enriched.suggestions.linkedinUrl).toBe('https://www.linkedin.com/company/integration');

    const account = (
      await app.inject({ method: 'GET', url: `/api/accounts/${accountId}`, cookies: org.cookies })
    ).json();
    expect(account.industry).toBeTruthy();

    // second run: everything already filled → nothing applied, nothing changed
    const second = await app.inject({
      method: 'POST',
      url: `/api/enrich/accounts/${accountId}`,
      cookies: org.cookies,
      payload: {},
    });
    expect(second.json().applied).toEqual([]);
    const after = (
      await app.inject({ method: 'GET', url: `/api/accounts/${accountId}`, cookies: org.cookies })
    ).json();
    expect(after.industry).toBe(account.industry);
  });

  it('enriches contacts by email and requires one', async () => {
    const contact = (
      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        cookies: org.cookies,
        payload: { firstName: 'Enrich', lastName: 'Me', email: 'enrich.me@integration.test' },
      })
    ).json().contact;
    const res = await app.inject({
      method: 'POST',
      url: `/api/enrich/contacts/${contact.id}`,
      cookies: org.cookies,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toContain('title');
    expect(res.json().suggestions.linkedinUrl).toBe('https://www.linkedin.com/in/enrich-me');

    const noEmail = (
      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        cookies: org.cookies,
        payload: { firstName: 'No', lastName: 'Email' },
      })
    ).json().contact;
    const bad = await app.inject({
      method: 'POST',
      url: `/api/enrich/contacts/${noEmail.id}`,
      cookies: org.cookies,
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
  });
});
