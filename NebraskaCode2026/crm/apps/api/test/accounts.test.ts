import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

let ctx: TestContext;
let org: TestOrg;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  org = await registerOrg(ctx.app);
});

async function createAccount(payload: Record<string, unknown>, cookies = org.cookies) {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/accounts', cookies, payload });
  return res;
}

describe('accounts CRUD', () => {
  it('creates and fetches an account, normalizing the domain', async () => {
    const created = await createAccount({
      name: 'Acme Corp',
      domain: 'https://www.Acme.COM/about',
      industry: 'Manufacturing',
    });
    expect(created.statusCode).toBe(201);
    const account = created.json();
    expect(account.domain).toBe('acme.com');

    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}`,
      cookies: org.cookies,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().name).toBe('Acme Corp');
  });

  it('rejects invalid payloads and unknown owners', async () => {
    expect((await createAccount({ name: '' })).statusCode).toBe(400);
    const badOwner = await createAccount({
      name: 'Ok',
      ownerId: '0198c5f0-0000-7000-8000-000000000000',
    });
    expect(badOwner.statusCode).toBe(400);
    expect(badOwner.json().error).toMatch(/owner/);
  });

  it('updates fields and records the change in audit + timeline', async () => {
    const account = (await createAccount({ name: 'Before Inc' })).json();
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/accounts/${account.id}`,
      cookies: org.cookies,
      payload: { name: 'After Inc', industry: 'SaaS' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe('After Inc');

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/timeline`,
      cookies: org.cookies,
    });
    const entries = timeline.json();
    expect(entries.total).toBe(2);
    expect(entries.items[0].entryType).toBe('account.updated');
    expect(entries.items[0].summary).toContain('name');
    expect(entries.items[1].entryType).toBe('account.created');
  });

  it('archives, hides from list, restores', async () => {
    const account = (await createAccount({ name: 'Ghost LLC' })).json();
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/accounts/${account.id}`,
      cookies: org.cookies,
    });
    expect(del.statusCode).toBe(204);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/accounts', cookies: org.cookies });
    expect(list.json().total).toBe(0);

    // detail still available, marked archived
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}`,
      cookies: org.cookies,
    });
    expect(detail.json().deletedAt).not.toBeNull();

    const restore = await ctx.app.inject({
      method: 'POST',
      url: `/api/accounts/${account.id}/restore`,
      cookies: org.cookies,
    });
    expect(restore.statusCode).toBe(204);
    const list2 = await ctx.app.inject({ method: 'GET', url: '/api/accounts', cookies: org.cookies });
    expect(list2.json().total).toBe(1);
  });

  it('updating an archived account 404s', async () => {
    const account = (await createAccount({ name: 'Gone' })).json();
    await ctx.app.inject({ method: 'DELETE', url: `/api/accounts/${account.id}`, cookies: org.cookies });
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/accounts/${account.id}`,
      cookies: org.cookies,
      payload: { name: 'Still here?' },
    });
    expect(patched.statusCode).toBe(404);
  });
});

describe('accounts search/filter/pagination', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 30; i++) {
      await createAccount({
        name: `Account ${String(i).padStart(2, '0')}`,
        industry: i % 2 === 0 ? 'SaaS' : 'Retail',
      });
    }
    await createAccount({ name: 'Zebra Systems', domain: 'zebra.io', industry: 'SaaS' });
  });

  it('paginates with stable ordering', async () => {
    const page1 = await ctx.app.inject({
      method: 'GET',
      url: '/api/accounts?page=1&pageSize=10',
      cookies: org.cookies,
    });
    const body = page1.json();
    expect(body.total).toBe(31);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].name).toBe('Account 01');

    const page4 = await ctx.app.inject({
      method: 'GET',
      url: '/api/accounts?page=4&pageSize=10',
      cookies: org.cookies,
    });
    expect(page4.json().items).toHaveLength(1);
    expect(page4.json().items[0].name).toBe('Zebra Systems');
  });

  it('searches name and domain', async () => {
    const byName = await ctx.app.inject({
      method: 'GET',
      url: '/api/accounts?query=zebra',
      cookies: org.cookies,
    });
    expect(byName.json().total).toBe(1);
    const byDomain = await ctx.app.inject({
      method: 'GET',
      url: '/api/accounts?query=zebra.io',
      cookies: org.cookies,
    });
    expect(byDomain.json().total).toBe(1);
  });

  it('filters by industry and sorts descending', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/accounts?industry=SaaS&sort=name&order=desc',
      cookies: org.cookies,
    });
    const body = res.json();
    expect(body.total).toBe(16);
    expect(body.items[0].name).toBe('Zebra Systems');
  });

  it('rejects bad pagination values', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/accounts?pageSize=5000',
      cookies: org.cookies,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('accounts security', () => {
  it('requires authentication and permission', async () => {
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/accounts' });
    expect(anon.statusCode).toBe(401);
  });

  it('is tenant-isolated end to end', async () => {
    const account = (await createAccount({ name: 'Org A Secret' })).json();
    const orgB = await registerOrg(ctx.app);
    const list = await ctx.app.inject({ method: 'GET', url: '/api/accounts', cookies: orgB.cookies });
    expect(list.json().total).toBe(0);
    const direct = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}`,
      cookies: orgB.cookies,
    });
    expect(direct.statusCode).toBe(404);
  });
});
