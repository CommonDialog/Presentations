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
  accountId = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Custom Corp' },
    })
  ).json().id;
});

async function createField(payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/customization/fields',
    cookies: org.cookies,
    payload: { entityType: 'deal', fieldType: 'text', ...payload },
  });
}

async function createDeal(custom?: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/deals',
    cookies: org.cookies,
    payload: { name: 'Test deal', accountId, amount: 1000, ...(custom ? { custom } : {}) },
  });
}

describe('custom field definitions', () => {
  it('creates, lists, updates, and rejects duplicates', async () => {
    const created = await createField({ key: 'region', label: 'Region' });
    expect(created.statusCode).toBe(201);

    const dup = await createField({ key: 'region', label: 'Region again' });
    expect(dup.statusCode).toBe(409);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/fields?entityType=deal',
      cookies: org.cookies,
    });
    expect(list.json().fields).toHaveLength(1);

    const updated = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/customization/fields/${created.json().id}`,
      cookies: org.cookies,
      payload: { label: 'Sales region', isActive: false },
    });
    expect(updated.json().label).toBe('Sales region');
    expect(updated.json().isActive).toBe(false);
  });

  it('rejects select fields without options, bad keys, and bad patterns', async () => {
    expect((await createField({ key: 'tier', label: 'Tier', fieldType: 'select' })).statusCode).toBe(400);
    expect((await createField({ key: '_recordType', label: 'X' })).statusCode).toBe(400);
    expect((await createField({ key: 'BadKey', label: 'X' })).statusCode).toBe(400);
    expect(
      (await createField({ key: 'sku', label: 'SKU', rules: { pattern: '[unclosed' } })).statusCode,
    ).toBe(400);
  });

  it('requires settings:manage to define fields', async () => {
    const anon = await ctx.app.inject({
      method: 'POST',
      url: '/api/customization/fields',
      payload: { entityType: 'deal', key: 'x', label: 'X', fieldType: 'text' },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('custom value validation', () => {
  it('enforces required fields on create', async () => {
    await createField({ key: 'region', label: 'Region', required: true });
    const missing = await createDeal();
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toContain('Region is required');

    const ok = await createDeal({ region: 'EMEA' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().custom.region).toBe('EMEA');
  });

  it('type-checks values: number ranges, select options, email format', async () => {
    await createField({ key: 'seats', label: 'Seats', fieldType: 'number', rules: { min: 1, max: 500 } });
    await createField({ key: 'tier', label: 'Tier', fieldType: 'select', options: ['gold', 'silver'] });
    await createField({ key: 'billing_email', label: 'Billing email', fieldType: 'email' });

    expect((await createDeal({ seats: 'many' })).statusCode).toBe(400);
    expect((await createDeal({ seats: 900 })).statusCode).toBe(400);
    expect((await createDeal({ tier: 'bronze' })).statusCode).toBe(400);
    expect((await createDeal({ billing_email: 'not-an-email' })).statusCode).toBe(400);
    expect(
      (await createDeal({ seats: 50, tier: 'gold', billing_email: 'ap@custom.test' })).statusCode,
    ).toBe(201);
  });

  it('rejects unknown keys', async () => {
    const res = await createDeal({ mystery: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('unknown field');
  });

  it('applies conditional requirements (requiredWhen)', async () => {
    await createField({ key: 'channel', label: 'Channel', fieldType: 'select', options: ['direct', 'partner'] });
    await createField({
      key: 'partner_name',
      label: 'Partner name',
      rules: { requiredWhen: { field: 'channel', op: 'eq', value: 'partner' } },
    });

    expect((await createDeal({ channel: 'direct' })).statusCode).toBe(201);
    const missing = await createDeal({ channel: 'partner' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toContain('Partner name is required');
    expect((await createDeal({ channel: 'partner', partner_name: 'Acme Resellers' })).statusCode).toBe(201);
  });

  it('skips required checks for fields hidden by visibleWhen (progressive disclosure)', async () => {
    await createField({ key: 'has_sla', label: 'Has SLA', fieldType: 'boolean' });
    await createField({
      key: 'sla_tier',
      label: 'SLA tier',
      required: true,
      rules: { visibleWhen: { field: 'has_sla', op: 'eq', value: true } },
    });

    // hidden → its required flag does not apply
    expect((await createDeal({ has_sla: false })).statusCode).toBe(201);
    // visible → required
    expect((await createDeal({ has_sla: true })).statusCode).toBe(400);
    expect((await createDeal({ has_sla: true, sla_tier: 'premium' })).statusCode).toBe(201);
  });

  it('validates on update with full-state semantics', async () => {
    await createField({ key: 'seats', label: 'Seats', fieldType: 'number' });
    const deal = (await createDeal({ seats: 10 })).json();
    const bad = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/deals/${deal.id}`,
      cookies: org.cookies,
      payload: { custom: { seats: 'ten' } },
    });
    expect(bad.statusCode).toBe(400);
    const good = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/deals/${deal.id}`,
      cookies: org.cookies,
      payload: { custom: { seats: 20 } },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().custom.seats).toBe(20);
  });

  it('validates other entities too (contact)', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/customization/fields',
      cookies: org.cookies,
      payload: { entityType: 'contact', key: 'linkedin', label: 'LinkedIn', fieldType: 'url' },
    });
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'A', lastName: 'B', custom: { linkedin: 'not a url' } },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('record types', () => {
  async function createRecordType(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/customization/record-types',
      cookies: org.cookies,
      payload: { entityType: 'deal', ...payload },
    });
  }

  it('creates record types and keeps a single default', async () => {
    const a = await createRecordType({ key: 'new_business', name: 'New Business', isDefault: true });
    expect(a.statusCode).toBe(201);
    const b = await createRecordType({ key: 'renewal', name: 'Renewal', isDefault: true });
    expect(b.statusCode).toBe(201);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/record-types?entityType=deal',
      cookies: org.cookies,
    });
    const defaults = list.json().recordTypes.filter((r: { isDefault: boolean }) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].key).toBe('renewal');
  });

  it('validates the record type stored on a record', async () => {
    await createRecordType({ key: 'renewal', name: 'Renewal' });
    expect((await createDeal({ _recordType: 'nonsense' })).statusCode).toBe(400);
    const ok = await createDeal({ _recordType: 'renewal' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().custom._recordType).toBe('renewal');
  });

  it('scopes fields to record types', async () => {
    await createRecordType({ key: 'renewal', name: 'Renewal' });
    await createRecordType({ key: 'new_business', name: 'New Business' });
    await createField({
      key: 'previous_contract',
      label: 'Previous contract',
      required: true,
      rules: { recordTypes: ['renewal'] },
    });

    // field does not apply to new_business → not required there
    expect((await createDeal({ _recordType: 'new_business' })).statusCode).toBe(201);
    // applies to renewals → required
    expect((await createDeal({ _recordType: 'renewal' })).statusCode).toBe(400);
    expect(
      (await createDeal({ _recordType: 'renewal', previous_contract: 'CTR-2025-091' })).statusCode,
    ).toBe(201);
  });
});

describe('layouts and bundle', () => {
  it('upserts layouts and resolves record-type layouts with fallback', async () => {
    const rt = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/customization/record-types',
        cookies: org.cookies,
        payload: { entityType: 'deal', key: 'renewal', name: 'Renewal' },
      })
    ).json();
    await createField({ key: 'region', label: 'Region' });

    const defaultLayout = await ctx.app.inject({
      method: 'PUT',
      url: '/api/customization/layouts',
      cookies: org.cookies,
      payload: {
        entityType: 'deal',
        recordTypeId: null,
        sections: [{ key: 'main', title: 'Main', collapsed: false, fields: ['region'] }],
      },
    });
    expect(defaultLayout.statusCode).toBe(200);

    const rtLayout = await ctx.app.inject({
      method: 'PUT',
      url: '/api/customization/layouts',
      cookies: org.cookies,
      payload: {
        entityType: 'deal',
        recordTypeId: rt.id,
        sections: [
          {
            key: 'renewal_details',
            title: 'Renewal details',
            collapsed: true,
            visibleWhen: { field: 'region', op: 'set' },
            fields: ['region'],
          },
        ],
      },
    });
    expect(rtLayout.statusCode).toBe(200);

    const forRenewal = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/bundle?entityType=deal&recordType=renewal',
      cookies: org.cookies,
    });
    expect(forRenewal.json().layout.sections[0].title).toBe('Renewal details');
    expect(forRenewal.json().layout.sections[0].collapsed).toBe(true);

    const forDefault = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/bundle?entityType=deal',
      cookies: org.cookies,
    });
    expect(forDefault.json().layout.sections[0].title).toBe('Main');

    // re-upsert replaces, not duplicates
    const again = await ctx.app.inject({
      method: 'PUT',
      url: '/api/customization/layouts',
      cookies: org.cookies,
      payload: { entityType: 'deal', recordTypeId: null, sections: [] },
    });
    expect(again.statusCode).toBe(200);
    const layouts = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/layouts?entityType=deal',
      cookies: org.cookies,
    });
    expect(layouts.json().layouts).toHaveLength(2);
  });

  it('bundle filters fields by record type restriction', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/customization/record-types',
      cookies: org.cookies,
      payload: { entityType: 'deal', key: 'renewal', name: 'Renewal' },
    });
    await createField({ key: 'everywhere', label: 'Everywhere' });
    await createField({ key: 'renewal_only', label: 'Renewal only', rules: { recordTypes: ['renewal'] } });

    const plain = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/bundle?entityType=deal',
      cookies: org.cookies,
    });
    expect(plain.json().fields.map((f: { key: string }) => f.key)).toEqual(['everywhere']);

    const renewal = await ctx.app.inject({
      method: 'GET',
      url: '/api/customization/bundle?entityType=deal&recordType=renewal',
      cookies: org.cookies,
    });
    expect(renewal.json().fields.map((f: { key: string }) => f.key).sort()).toEqual([
      'everywhere',
      'renewal_only',
    ]);
  });
});
