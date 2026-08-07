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
      payload: { name: 'Project Corp' },
    })
  ).json().id;
});

async function createProject(payload: Record<string, unknown> = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/projects',
    cookies: org.cookies,
    payload: { name: 'Onboarding', accountId, ...payload },
  });
}

async function addMilestone(projectId: string, name: string) {
  return (
    await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/milestones`,
      cookies: org.cookies,
      payload: { name },
    })
  ).json();
}

async function addProjectTask(projectId: string, title: string, milestoneId?: string) {
  return (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      cookies: org.cookies,
      payload: { title, projectId, ...(milestoneId ? { milestoneId } : {}) },
    })
  ).json();
}

async function setTaskStatus(taskId: string, status: string) {
  return ctx.app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    cookies: org.cookies,
    payload: { status },
  });
}

describe('projects', () => {
  it('creates a project with timeline entries on project and account', async () => {
    const res = await createProject({ startDate: '2026-08-01', dueDate: '2026-10-01' });
    expect(res.statusCode).toBe(201);
    const project = res.json();
    expect(project.status).toBe('planned');
    expect(project.accountName).toBe('Project Corp');

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/timeline`,
      cookies: org.cookies,
    });
    expect(timeline.json().items[0].entryType).toBe('project.created');
  });

  it('enforces the status state machine and milestone completion guard', async () => {
    const project = (await createProject()).json();
    // planned → completed is illegal
    const illegal = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(illegal.statusCode).toBe(400);

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'active' },
    });

    const milestone = await addMilestone(project.id, 'Kickoff');
    const blocked = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/milestone/);

    // waiver completes it despite the open milestone
    const waived = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'completed', waiveMilestones: true },
    });
    expect(waived.statusCode).toBe(200);
    expect(waived.json().status).toBe('completed');
    expect(waived.json().completedAt).not.toBeNull();

    // reopen clears completedAt
    const reopened = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'active' },
    });
    expect(reopened.json().completedAt).toBeNull();
    void milestone;
  });

  it('completes cleanly when all milestones are completed', async () => {
    const project = (await createProject()).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'active' },
    });
    const milestone = await addMilestone(project.id, 'Only one');
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/milestones/${milestone.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    const done = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(done.statusCode).toBe(200);
  });
});

describe('milestones', () => {
  it('cannot complete a milestone with open tasks; can after they finish', async () => {
    const project = (await createProject()).json();
    const milestone = await addMilestone(project.id, 'Implementation');
    const task = await addProjectTask(project.id, 'Configure environment', milestone.id);

    const blocked = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/milestones/${milestone.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(blocked.statusCode).toBe(400);

    await setTaskStatus(task.id, 'completed');
    const done = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/milestones/${milestone.id}`,
      cookies: org.cookies,
      payload: { status: 'completed' },
    });
    expect(done.statusCode).toBe(200);

    const timeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/timeline`,
      cookies: org.cookies,
    });
    expect(
      timeline.json().items.some((i: { entryType: string }) => i.entryType === 'project.milestone_completed'),
    ).toBe(true);
  });

  it('deleting a milestone detaches its tasks', async () => {
    const project = (await createProject()).json();
    const milestone = await addMilestone(project.id, 'Doomed');
    const task = await addProjectTask(project.id, 'Surviving task', milestone.id);
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/milestones/${milestone.id}`,
      cookies: org.cookies,
    });
    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}`,
      cookies: org.cookies,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().projectId).toBe(project.id);
  });
});

describe('task dependencies', () => {
  it('adds dependencies, rejects self/cycles/cross-project', async () => {
    const project = (await createProject()).json();
    const a = await addProjectTask(project.id, 'A');
    const b = await addProjectTask(project.id, 'B');
    const c = await addProjectTask(project.id, 'C');

    const dep = async (taskId: string, dependsOnTaskId: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/dependencies`,
        cookies: org.cookies,
        payload: { dependsOnTaskId },
      });

    expect((await dep(b.id, a.id)).statusCode).toBe(204); // b depends on a
    expect((await dep(c.id, b.id)).statusCode).toBe(204); // c depends on b
    expect((await dep(a.id, a.id)).statusCode).toBe(400); // self
    const cycle = await dep(a.id, c.id); // a→c would close the loop
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json().error).toMatch(/cycle/);

    const other = (await createProject({ name: 'Other project' })).json();
    const foreign = await addProjectTask(other.id, 'Foreign');
    expect((await dep(foreign.id, a.id)).statusCode).toBe(400); // cross-project
  });

  it('blocks starting/completing a task until dependencies complete', async () => {
    const project = (await createProject()).json();
    const first = await addProjectTask(project.id, 'Install');
    const second = await addProjectTask(project.id, 'Configure');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${second.id}/dependencies`,
      cookies: org.cookies,
      payload: { dependsOnTaskId: first.id },
    });

    const blocked = await setTaskStatus(second.id, 'in_progress');
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/blocked.*Install/);

    await setTaskStatus(first.id, 'completed');
    const started = await setTaskStatus(second.id, 'in_progress');
    expect(started.statusCode).toBe(200);
  });
});

describe('board & gantt', () => {
  it('board groups by status with blocked flags and milestone names', async () => {
    const project = (await createProject()).json();
    const milestone = await addMilestone(project.id, 'Phase 1');
    const a = await addProjectTask(project.id, 'First', milestone.id);
    const b = await addProjectTask(project.id, 'Second', milestone.id);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${b.id}/dependencies`,
      cookies: org.cookies,
      payload: { dependsOnTaskId: a.id },
    });
    await setTaskStatus(a.id, 'in_progress');

    const board = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/board`,
      cookies: org.cookies,
    });
    const columns = board.json().columns;
    const open = columns.find((c: { status: string }) => c.status === 'open');
    const inProgress = columns.find((c: { status: string }) => c.status === 'in_progress');
    expect(inProgress.tasks.map((t: { title: string }) => t.title)).toEqual(['First']);
    expect(open.tasks[0].title).toBe('Second');
    expect(open.tasks[0].blocked).toBe(true);
    expect(open.tasks[0].milestoneName).toBe('Phase 1');
    expect(open.tasks[0].dependsOn).toContain(a.id);
  });

  it('gantt returns range, milestones and tasks', async () => {
    const project = (await createProject({ startDate: '2026-08-01', dueDate: '2026-09-30' })).json();
    await addMilestone(project.id, 'M1');
    await addProjectTask(project.id, 'T1');
    const gantt = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/gantt`,
      cookies: org.cookies,
    });
    const body = gantt.json();
    expect(body.milestones).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(new Date(body.rangeStart).getTime()).toBeLessThanOrEqual(new Date('2026-08-01').getTime());
    expect(new Date(body.rangeEnd).getTime()).toBeGreaterThanOrEqual(new Date('2026-09-30').getTime());
  });
});

describe('onboarding from a won deal', () => {
  async function wonDeal(): Promise<string> {
    const deal = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Big Win', accountId, amount: 90000 },
      })
    ).json();
    const pipelines = await ctx.app.inject({ method: 'GET', url: '/api/pipelines', cookies: org.cookies });
    const won = pipelines.json().pipelines[0].stages.find((s: { isWon: boolean }) => s.isWon);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/move`,
      cookies: org.cookies,
      payload: { stageId: won.id },
    });
    return deal.id;
  }

  it('creates an onboarding project with default milestones from a won deal', async () => {
    const dealId = await wonDeal();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${dealId}/create-project`,
      cookies: org.cookies,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const project = res.json();
    expect(project.name).toContain('onboarding');
    expect(project.accountId).toBe(accountId);

    const milestones = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/milestones`,
      cookies: org.cookies,
    });
    expect(milestones.json().milestones.map((m: { name: string }) => m.name)).toEqual([
      'Kickoff',
      'Implementation',
      'Training',
      'Go-live',
    ]);

    // deal timeline sees the project creation
    const dealTimeline = await ctx.app.inject({
      method: 'GET',
      url: `/api/deals/${dealId}/timeline?pageSize=50`,
      cookies: org.cookies,
    });
    expect(
      dealTimeline.json().items.some((i: { entryType: string }) => i.entryType === 'project.created'),
    ).toBe(true);
  });

  it('rejects onboarding from a deal that is not won', async () => {
    const deal = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/deals',
        cookies: org.cookies,
        payload: { name: 'Still open', accountId },
      })
    ).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/create-project`,
      cookies: org.cookies,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('customer portal', () => {
  it('serves a public read-only view via the capability token', async () => {
    const project = (await createProject()).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'active' },
    });
    await addMilestone(project.id, 'Kickoff');
    const task = await addProjectTask(project.id, 'Visible progress');
    await setTaskStatus(task.id, 'completed');

    const enabled = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/portal`,
      cookies: org.cookies,
      payload: {},
    });
    const token = enabled.json().token;
    expect(token.length).toBeGreaterThan(20);

    // no cookies — completely unauthenticated
    const view = await ctx.app.inject({ method: 'GET', url: `/api/portal/${token}` });
    expect(view.statusCode).toBe(200);
    const body = view.json();
    expect(body.projectName).toBe('Onboarding');
    expect(body.accountName).toBe('Project Corp');
    expect(body.milestones).toHaveLength(1);
    expect(body.taskCounts).toEqual({ total: 1, completed: 1 });

    // project flag reflects portal state
    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
    });
    expect(fetched.json().portalEnabled).toBe(true);
  });

  it('revocation and planned-status projects are invisible', async () => {
    const project = (await createProject()).json(); // status: planned
    const enabled = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/portal`,
      cookies: org.cookies,
      payload: {},
    });
    const token = enabled.json().token;

    // planned projects are not customer-visible per the domain model
    expect((await ctx.app.inject({ method: 'GET', url: `/api/portal/${token}` })).statusCode).toBe(404);

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      cookies: org.cookies,
      payload: { status: 'active' },
    });
    expect((await ctx.app.inject({ method: 'GET', url: `/api/portal/${token}` })).statusCode).toBe(200);

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}/portal`,
      cookies: org.cookies,
    });
    expect((await ctx.app.inject({ method: 'GET', url: `/api/portal/${token}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/portal/not-a-real-token-here' })).statusCode).toBe(404);
  });
});
