import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineDto } from '@crm/shared';
import { evaluateConditions, renderContextTemplate } from '../src/modules/workflows/engine.js';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

let ctx: TestContext;
let org: TestOrg;
let pipeline: PipelineDto;

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  org = await registerOrg(ctx.app);
  const pipelines = await ctx.app.inject({ method: 'GET', url: '/api/pipelines', cookies: org.cookies });
  pipeline = pipelines.json().pipelines[0];
});

async function createWorkflow(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/workflows', cookies: org.cookies, payload });
}

async function runsFor(workflowId: string) {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/workflows/${workflowId}/runs`,
    cookies: org.cookies,
  });
  return res.json().runs as { status: string; actionsExecuted: { type: string; note?: string }[] }[];
}

describe('condition evaluation', () => {
  const context = { deal: { name: 'Acme expansion', amount: 60000, stage: 'Proposal' } };

  it('compares numbers, strings, and existence', () => {
    expect(evaluateConditions([{ field: 'deal.amount', op: 'gt', value: 50000 }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'deal.amount', op: 'lte', value: 50000 }], context)).toBe(false);
    expect(evaluateConditions([{ field: 'deal.name', op: 'contains', value: 'acme' }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'deal.stage', op: 'eq', value: 'Proposal' }], context)).toBe(true);
    expect(evaluateConditions([{ field: 'deal.closedAt', op: 'exists' }], context)).toBe(false);
    // all conditions must hold
    expect(
      evaluateConditions(
        [
          { field: 'deal.amount', op: 'gt', value: 50000 },
          { field: 'deal.stage', op: 'eq', value: 'Qualification' },
        ],
        context,
      ),
    ).toBe(false);
  });

  it('renders {{path}} templates and blanks missing values', () => {
    expect(renderContextTemplate('Deal {{deal.name}} at {{deal.amount}}', context)).toBe(
      'Deal Acme expansion at 60000',
    );
    expect(renderContextTemplate('Missing: [{{deal.nothing}}]', context)).toBe('Missing: []');
  });
});

describe('workflow crud', () => {
  it('creates, lists, updates, and deletes', async () => {
    const created = await createWorkflow({
      name: 'Notify on new lead',
      triggerType: 'lead.created',
      actions: [{ type: 'notify', recipient: 'actor', message: 'New lead {{lead.lastName}}' }],
    });
    expect(created.statusCode).toBe(201);
    const workflow = created.json();
    expect(workflow.enabled).toBe(true);
    expect(workflow.conditions).toEqual([]);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/workflows', cookies: org.cookies });
    expect(list.json().workflows).toHaveLength(1);

    const updated = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/workflows/${workflow.id}`,
      cookies: org.cookies,
      payload: { enabled: false },
    });
    expect(updated.json().enabled).toBe(false);

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/workflows/${workflow.id}`,
      cookies: org.cookies,
    });
    expect(removed.statusCode).toBe(204);
    const after = await ctx.app.inject({ method: 'GET', url: '/api/workflows', cookies: org.cookies });
    expect(after.json().workflows).toHaveLength(0);
  });

  it('rejects a workflow without actions and rejects unauthenticated access', async () => {
    const empty = await createWorkflow({ name: 'No-op', triggerType: 'lead.created', actions: [] });
    expect(empty.statusCode).toBe(400);

    const anon = await ctx.app.inject({ method: 'GET', url: '/api/workflows' });
    expect(anon.statusCode).toBe(401);
  });

  it('serves reusable templates usable as create payloads', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/workflows/templates',
      cookies: org.cookies,
    });
    const templates = res.json().templates;
    expect(templates.length).toBeGreaterThanOrEqual(4);
    const created = await createWorkflow(templates[0].definition);
    expect(created.statusCode).toBe(201);
  });
});

describe('workflow execution', () => {
  it('lead.created runs a create_task action with rendered context', async () => {
    const workflow = (
      await createWorkflow({
        name: 'Lead follow-up',
        triggerType: 'lead.created',
        actions: [{ type: 'create_task', title: 'Call {{lead.firstName}} {{lead.lastName}}', priority: 'high' }],
      })
    ).json();

    const lead = await ctx.app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'Willa', lastName: 'Cather' },
    });
    expect(lead.statusCode).toBe(201);

    const tasks = await ctx.app.inject({ method: 'GET', url: '/api/tasks', cookies: org.cookies });
    const titles = tasks.json().items.map((t: { title: string }) => t.title);
    expect(titles).toContain('Call Willa Cather');

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('executed');
    expect(runs[0]!.actionsExecuted[0]!.type).toBe('create_task');
  });

  it('conditions gate execution and skipped runs are logged', async () => {
    const workflow = (
      await createWorkflow({
        name: 'Big deal alert',
        triggerType: 'deal.created',
        conditions: [{ field: 'deal.amount', op: 'gt', value: 50000 }],
        actions: [{ type: 'notify', recipient: 'actor', message: 'Big deal {{deal.name}}' }],
      })
    ).json();

    const account = await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Workflow Corp' },
    });
    const accountId = account.json().id;

    for (const [name, amount] of [['Small deal', 1000], ['Huge deal', 90000]] as const) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name, accountId, amount },
      });
    }

    const runs = await runsFor(workflow.id);
    expect(runs.map((r) => r.status).sort()).toEqual(['executed', 'skipped']);

    const notifications = await ctx.app.inject({
      method: 'GET',
      url: '/api/notifications',
      cookies: org.cookies,
    });
    const messages = notifications.json().notifications.map((n: { message: string }) => n.message);
    expect(messages).toContain('Big deal Huge deal');
    expect(messages).not.toContain('Big deal Small deal');
    expect(notifications.json().unread).toBe(1);
  });

  it('disabled workflows do not run', async () => {
    const workflow = (
      await createWorkflow({
        name: 'Dormant',
        triggerType: 'lead.created',
        actions: [{ type: 'notify', recipient: 'actor', message: 'should not fire' }],
        enabled: false,
      })
    ).json();

    await ctx.app.inject({
      method: 'POST',
      url: '/api/leads',
      cookies: org.cookies,
      payload: { firstName: 'Quiet', lastName: 'Lead' },
    });

    expect(await runsFor(workflow.id)).toHaveLength(0);
  });

  it('deal.won fires notify and email actions through the stage move', async () => {
    const workflow = (
      await createWorkflow({
        name: 'Won celebration',
        triggerType: 'deal.won',
        actions: [
          { type: 'notify', recipient: 'owner', message: 'Won {{deal.name}}!' },
          { type: 'send_email', to: 'owner', subject: 'Won: {{deal.name}}', body: 'We closed {{deal.name}}.' },
        ],
      })
    ).json();

    const account = await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Winner Inc' },
    });
    const deal = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Q3 renewal', accountId: account.json().id, amount: 5000 },
      })
    ).json();

    const wonStage = pipeline.stages.find((s) => s.isWon)!;
    const moved = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: wonStage.id },
    });
    expect(moved.statusCode).toBe(200);

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('executed');
    expect(runs[0]!.actionsExecuted.map((a) => a.type)).toEqual(['notify', 'send_email']);
    expect(runs[0]!.actionsExecuted[1]!.note).toBe(`sent to ${org.email}`);

    const notifications = await ctx.app.inject({
      method: 'GET',
      url: '/api/notifications',
      cookies: org.cookies,
    });
    expect(
      notifications.json().notifications.some((n: { message: string }) => n.message === 'Won Q3 renewal!'),
    ).toBe(true);
  });

  it('send_email to contact resolves the contact address and skips gracefully when absent', async () => {
    const workflow = (
      await createWorkflow({
        name: 'Welcome email',
        triggerType: 'contact.created',
        actions: [
          { type: 'send_email', to: 'contact', subject: 'Welcome {{contact.firstName}}', body: 'Hello!' },
        ],
      })
    ).json();

    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/contacts',
      cookies: org.cookies,
      payload: { firstName: 'No', lastName: 'Email' },
    });

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(2);
    const notes = runs.map((r) => r.actionsExecuted[0]!.note).sort();
    expect(notes).toEqual(['sent to ada@example.test', 'skipped: no recipient email resolvable']);
  });

  it('deal.won template creates the onboarding project end to end', async () => {
    await createWorkflow({
      name: 'Won deal → onboarding',
      triggerType: 'deal.won',
      actions: [{ type: 'create_onboarding_project' }],
    });

    const account = await ctx.app.inject({
      method: 'POST',
      url: '/api/accounts',
      cookies: org.cookies,
      payload: { name: 'Onboard Co' },
    });
    const deal = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Implementation', accountId: account.json().id, amount: 20000 },
      })
    ).json();
    const wonStage = pipeline.stages.find((s) => s.isWon)!;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: wonStage.id },
    });

    const projects = await ctx.app.inject({ method: 'GET', url: '/api/projects', cookies: org.cookies });
    expect(projects.json().total).toBeGreaterThanOrEqual(1);
  });
});
