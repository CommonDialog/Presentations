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
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/accounts',
    cookies: org.cookies,
    payload: { name: 'Parent Corp' },
  });
  accountId = res.json().id;
});

async function createContact(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/contacts', cookies: org.cookies, payload });
}

describe('contacts CRUD', () => {
  it('creates a contact attached to an account; both timelines see it', async () => {
    const res = await createContact({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@parent.com',
      accountId,
    });
    expect(res.statusCode).toBe(201);
    const { contact, warnings } = res.json();
    expect(warnings).toHaveLength(0);

    const contactTimeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts/${contact.id}/timeline`,
      cookies: org.cookies,
    });
    expect(contactTimeline.json().items[0].entryType).toBe('contact.created');

    const accountTimeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/timeline`,
      cookies: org.cookies,
    });
    const types = accountTimeline.json().items.map((i: { entryType: string }) => i.entryType);
    expect(types).toContain('contact.created');
  });

  it('warns on duplicate email without blocking', async () => {
    await createContact({ firstName: 'A', lastName: 'One', email: 'dup@x.com' });
    const res = await createContact({ firstName: 'B', lastName: 'Two', email: 'DUP@x.com' });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings).toHaveLength(1);
  });

  it('rejects linking to a nonexistent or foreign account', async () => {
    const fake = await createContact({
      firstName: 'X',
      lastName: 'Y',
      accountId: '0198c5f0-0000-7000-8000-000000000000',
    });
    expect(fake.statusCode).toBe(400);

    const orgB = await registerOrg(ctx.app);
    const foreign = await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: orgB.cookies,
      payload: { firstName: 'X', lastName: 'Y', accountId },
    });
    expect(foreign.statusCode).toBe(400);
  });

  it('updates, archives and restores', async () => {
    const { contact } = (await createContact({ firstName: 'Temp', lastName: 'Person' })).json();
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/contacts/${contact.id}`,
      cookies: org.cookies,
      payload: { title: 'VP of Everything', accountId },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().contact.title).toBe('VP of Everything');

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/contacts/${contact.id}`,
      cookies: org.cookies,
    });
    expect(del.statusCode).toBe(204);
    const list = await ctx.app.inject({ method: 'GET', url: '/api/contacts', cookies: org.cookies });
    expect(list.json().total).toBe(0);

    await ctx.app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/restore`,
      cookies: org.cookies,
    });
    const list2 = await ctx.app.inject({ method: 'GET', url: '/api/contacts', cookies: org.cookies });
    expect(list2.json().total).toBe(1);
  });
});

describe('contacts search/filter/pagination', () => {
  beforeEach(async () => {
    await createContact({ firstName: 'Alice', lastName: 'Anderson', email: 'alice@a.com', accountId });
    await createContact({ firstName: 'Bob', lastName: 'Brown', email: 'bob@b.com' });
    await createContact({ firstName: 'Carol', lastName: 'Chen', email: 'carol@c.com', accountId });
  });

  it('filters by account', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/contacts?accountId=${accountId}`,
      cookies: org.cookies,
    });
    expect(res.json().total).toBe(2);
  });

  it('searches across name and email', async () => {
    const byLast = await ctx.app.inject({
      method: 'GET',
      url: '/api/contacts?query=brown',
      cookies: org.cookies,
    });
    expect(byLast.json().total).toBe(1);
    const byEmail = await ctx.app.inject({
      method: 'GET',
      url: '/api/contacts?query=carol@c.com',
      cookies: org.cookies,
    });
    expect(byEmail.json().total).toBe(1);
  });

  it('paginates sorted by last name', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/contacts?page=2&pageSize=2',
      cookies: org.cookies,
    });
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].lastName).toBe('Chen');
  });
});
