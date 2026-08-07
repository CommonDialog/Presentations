import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

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

async function getRoles(
  org: TestOrg,
): Promise<{ id: string; name: string; isSystem: boolean; permissions: string[] }[]> {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/roles', cookies: org.cookies });
  expect(res.statusCode).toBe(200);
  return res.json().roles;
}

async function createMember(org: TestOrg): Promise<{ id: string; cookies: { sid: string } }> {
  const roles = await getRoles(org);
  const member = roles.find((r) => r.name === 'Member')!;
  const email = `member-${Math.random().toString(36).slice(2)}@test.test`;
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/users',
    cookies: org.cookies,
    payload: { name: 'Member User', email, password: 'member-password-1', roleIds: [member.id] },
  });
  expect(created.statusCode).toBe(201);
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'member-password-1' },
  });
  expect(login.statusCode).toBe(200);
  return {
    id: created.json().id,
    cookies: { sid: login.cookies.find((c) => c.name === 'sid')!.value },
  };
}

describe('user management', () => {
  it('seeds Admin and Member system roles at signup', async () => {
    const org = await registerOrg(ctx.app);
    const roles = await getRoles(org);
    const names = roles.map((r) => r.name).sort();
    expect(names).toEqual(['Admin', 'Member']);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    const admin = roles.find((r) => r.name === 'Admin')!;
    const member = roles.find((r) => r.name === 'Member')!;
    expect(admin.permissions).toContain('users:manage');
    expect(member.permissions).not.toContain('users:manage');
  });

  it('member cannot manage users (403), admin can (200)', async () => {
    const org = await registerOrg(ctx.app);
    const member = await createMember(org);
    const denied = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: member.cookies,
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: org.cookies });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().users).toHaveLength(2);
  });

  it('deactivating a user revokes their sessions', async () => {
    const org = await registerOrg(ctx.app);
    const member = await createMember(org);
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${member.id}`,
      cookies: org.cookies,
      payload: { isActive: false },
    });
    expect(patch.statusCode).toBe(204);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: member.cookies });
    expect(me.statusCode).toBe(401);
  });

  it('refuses to deactivate the last active Admin', async () => {
    const org = await registerOrg(ctx.app);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${org.userId}`,
      cookies: org.cookies,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/active Admin/);
  });

  it('refuses to strip the Admin role from the last Admin', async () => {
    const org = await registerOrg(ctx.app);
    const roles = await getRoles(org);
    const member = roles.find((r) => r.name === 'Member')!;
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${org.userId}`,
      cookies: org.cookies,
      payload: { roleIds: [member.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cannot assign a role from another organization', async () => {
    const orgA = await registerOrg(ctx.app);
    const orgB = await registerOrg(ctx.app);
    const rolesB = await getRoles(orgB);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: orgA.cookies,
      payload: {
        name: 'Sneaky',
        email: 'sneaky@test.test',
        password: 'long-enough-pass',
        roleIds: [rolesB[0]!.id],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates custom roles with a permission subset', async () => {
    const org = await registerOrg(ctx.app);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/roles',
      cookies: org.cookies,
      payload: {
        name: 'Read Only',
        description: 'Viewer',
        permissionCodes: ['accounts:read', 'contacts:read', 'deals:read'],
      },
    });
    expect(created.statusCode).toBe(201);
    const roles = await getRoles(org);
    const readOnly = roles.find((r) => r.name === 'Read Only');
    expect(readOnly).toBeDefined();
    expect(readOnly!.permissions).toEqual(['accounts:read', 'contacts:read', 'deals:read']);
  });

  it('rejects roles with unknown permission codes', async () => {
    const org = await registerOrg(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/roles',
      cookies: org.cookies,
      payload: { name: 'Bad', permissionCodes: ['not-a-permission'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
