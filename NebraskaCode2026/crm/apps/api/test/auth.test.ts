import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerOrg, resetDb, type TestContext } from './helpers/testApp.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
});

describe('registration', () => {
  it('creates org + admin and signs the user in', async () => {
    const org = await registerOrg(ctx.app, 'Acme Rockets');
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: org.cookies });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.organization.name).toBe('Acme Rockets');
    expect(body.organization.slug).toBe('acme-rockets');
    expect(body.user.email).toBe(org.email);
    expect(body.permissions).toContain('users:manage');
  });

  it('rejects duplicate emails with 409', async () => {
    const org = await registerOrg(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Other Org',
        name: 'Dup',
        email: org.email,
        password: 'long-enough-password',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects invalid payloads with 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: '', name: '', email: 'nope', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deduplicates slugs across organizations', async () => {
    await registerOrg(ctx.app, 'Same Name');
    const second = await registerOrg(ctx.app, 'Same Name');
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: second.cookies,
    });
    expect(me.json().organization.slug).toBe('same-name-2');
  });
});

describe('login/logout', () => {
  it('logs in with valid credentials', async () => {
    const org = await registerOrg(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: org.email, password: org.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'sid')).toBeDefined();
  });

  it('rejects a wrong password with 401', async () => {
    const org = await registerOrg(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: org.email, password: 'totally-wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown emails with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@nowhere.test', password: 'whatever-long' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout revokes the session', async () => {
    const org = await registerOrg(ctx.app);
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: org.cookies,
    });
    expect(out.statusCode).toBe(204);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: org.cookies });
    expect(me.statusCode).toBe(401);
  });

  it('rejects requests with no or forged session', async () => {
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: '0198c5f0-0000-7000-8000-000000000000.forgedsig' },
    });
    expect(forged.statusCode).toBe(401);
  });
});
