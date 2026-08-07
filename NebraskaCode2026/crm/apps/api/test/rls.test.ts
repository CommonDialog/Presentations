import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, auditLog } from '../src/db/schema/index.js';
import { withOrg } from '../src/lib/tenant.js';
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

describe('row-level security', () => {
  it('tenants cannot see each other\'s rows', async () => {
    const orgA = await registerOrg(ctx.app);
    const orgB = await registerOrg(ctx.app);

    await withOrg(ctx.db, orgA.organizationId, (tx) =>
      tx.insert(accounts).values({ organizationId: orgA.organizationId, name: 'A Corp' }),
    );

    const seenByA = await withOrg(ctx.db, orgA.organizationId, (tx) =>
      tx.select().from(accounts),
    );
    const seenByB = await withOrg(ctx.db, orgB.organizationId, (tx) =>
      tx.select().from(accounts),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(0);
  });

  it('no tenant context means no rows, even for the table owner', async () => {
    const orgA = await registerOrg(ctx.app);
    await withOrg(ctx.db, orgA.organizationId, (tx) =>
      tx.insert(accounts).values({ organizationId: orgA.organizationId, name: 'A Corp' }),
    );
    // Raw query outside any withOrg transaction: FORCE RLS applies to crm_user.
    const rows = await ctx.db.select().from(accounts);
    expect(rows).toHaveLength(0);
  });

  it('blocks writes into another tenant', async () => {
    const orgA = await registerOrg(ctx.app);
    const orgB = await registerOrg(ctx.app);
    const err = await withOrg(ctx.db, orgB.organizationId, (tx) =>
      tx.insert(accounts).values({ organizationId: orgA.organizationId, name: 'Sneaky Corp' }),
    ).then(
      () => null,
      (e: unknown) => e as Error & { cause?: { message?: string } },
    );
    expect(err).not.toBeNull();
    expect(String(err!.cause?.message ?? err!.message)).toMatch(/row-level security/);
  });

  it('audit log rows are tenant-scoped and written on auth events', async () => {
    const orgA = await registerOrg(ctx.app);
    const orgB = await registerOrg(ctx.app);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: orgA.email, password: 'definitely-wrong-pw' },
    });

    const auditA = await withOrg(ctx.db, orgA.organizationId, (tx) =>
      tx.select().from(auditLog),
    );
    const actions = auditA.map((a) => a.action);
    expect(actions).toContain('create'); // organization created
    expect(actions).toContain('login_failed');

    const auditB = await withOrg(ctx.db, orgB.organizationId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.organizationId, orgA.organizationId)),
    );
    expect(auditB).toHaveLength(0);
  });
});
