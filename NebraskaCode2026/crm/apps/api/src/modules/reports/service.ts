import { sql } from 'drizzle-orm';
import type {
  ActivityReportDto,
  CustomerHealthLevel,
  CustomerHealthReportDto,
  CustomerHealthRow,
  ProjectHealthLevel,
  ProjectHealthReportDto,
  ProjectHealthRow,
  RevenueReportDto,
  SalesReportDto,
  StalledReportDto,
  VelocityReportDto,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import type { AuthContext } from '../auth/service.js';

// Every report is computed from live rows at request time. RLS (set by
// withOrg) scopes the raw SQL to the caller's organization.

type Row = Record<string, unknown>;

async function rows(tx: Tx, query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await tx.execute(query);
  return result.rows as Row[];
}

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function iso(value: unknown): string | null {
  return value ? new Date(value as string | Date).toISOString() : null;
}

export async function salesReport(
  db: Db,
  ctx: AuthContext,
  days: number,
  pipelineId?: string,
): Promise<SalesReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const pipelineFilter = pipelineId ? sql`and d.pipeline_id = ${pipelineId}` : sql``;

    const [totals] = await rows(
      tx,
      sql`
        select
          count(*) filter (where d.created_at >= now() - make_interval(days => ${days}))::int as new_count,
          coalesce(sum(d.amount) filter (where d.created_at >= now() - make_interval(days => ${days})), 0)::float8 as new_amount,
          count(*) filter (where d.status = 'won' and d.closed_at >= now() - make_interval(days => ${days}))::int as won_count,
          coalesce(sum(d.amount) filter (where d.status = 'won' and d.closed_at >= now() - make_interval(days => ${days})), 0)::float8 as won_amount,
          count(*) filter (where d.status = 'lost' and d.closed_at >= now() - make_interval(days => ${days}))::int as lost_count,
          coalesce(sum(d.amount) filter (where d.status = 'lost' and d.closed_at >= now() - make_interval(days => ${days})), 0)::float8 as lost_amount,
          avg(extract(epoch from (d.closed_at - d.created_at)) / 86400)
            filter (where d.status = 'won' and d.closed_at >= now() - make_interval(days => ${days}))::float8 as avg_cycle_days
        from deals d
        where d.deleted_at is null ${pipelineFilter}`,
    );

    const [open] = await rows(
      tx,
      sql`
        select
          count(*)::int as open_count,
          coalesce(sum(d.amount), 0)::float8 as open_amount,
          coalesce(sum(d.amount * coalesce(d.probability, s.probability) / 100.0), 0)::float8 as weighted
        from deals d
        join pipeline_stages s on s.id = d.stage_id
        where d.status = 'open' and d.deleted_at is null ${pipelineFilter}`,
    );

    const owners = await rows(
      tx,
      sql`
        select
          d.owner_id,
          u.name as owner_name,
          count(*) filter (where d.status = 'open')::int as open_count,
          coalesce(sum(d.amount) filter (where d.status = 'open'), 0)::float8 as open_amount,
          count(*) filter (where d.status = 'won' and d.closed_at >= now() - make_interval(days => ${days}))::int as won_count,
          coalesce(sum(d.amount) filter (where d.status = 'won' and d.closed_at >= now() - make_interval(days => ${days})), 0)::float8 as won_amount
        from deals d
        left join users u on u.id = d.owner_id
        where d.deleted_at is null ${pipelineFilter}
          and (d.status = 'open' or (d.status = 'won' and d.closed_at >= now() - make_interval(days => ${days})))
        group by d.owner_id, u.name
        order by won_amount desc, open_amount desc`,
    );

    const wonCount = num(totals?.won_count);
    const lostCount = num(totals?.lost_count);
    const closed = wonCount + lostCount;
    return {
      periodDays: days,
      newDeals: { count: num(totals?.new_count), amount: round2(num(totals?.new_amount)) },
      won: { count: wonCount, amount: round2(num(totals?.won_amount)) },
      lost: { count: lostCount, amount: round2(num(totals?.lost_amount)) },
      winRate: closed === 0 ? null : round2((wonCount / closed) * 100),
      avgWonDealSize: wonCount === 0 ? null : round2(num(totals?.won_amount) / wonCount),
      avgCycleDays:
        totals?.avg_cycle_days === null || totals?.avg_cycle_days === undefined
          ? null
          : round2(num(totals.avg_cycle_days)),
      openPipeline: {
        count: num(open?.open_count),
        amount: round2(num(open?.open_amount)),
        weighted: round2(num(open?.weighted)),
      },
      byOwner: owners.map((r) => ({
        ownerId: (r.owner_id as string | null) ?? null,
        ownerName: (r.owner_name as string | null) ?? 'Unassigned',
        openCount: num(r.open_count),
        openAmount: round2(num(r.open_amount)),
        wonCount: num(r.won_count),
        wonAmount: round2(num(r.won_amount)),
      })),
    };
  });
}

export async function velocityReport(
  db: Db,
  ctx: AuthContext,
  days: number,
  pipelineId?: string,
): Promise<VelocityReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const pipelineFilter = pipelineId ? sql`and d.pipeline_id = ${pipelineId}` : sql``;

    // Time in stage = gap between consecutive history rows per deal; a deal's
    // current (still-running) stay has no next row and is excluded from avg.
    const stages = await rows(
      tx,
      sql`
        with moves as (
          select
            h.to_stage_id,
            h.changed_at,
            lead(h.changed_at) over (partition by h.deal_id order by h.changed_at) as next_at
          from deal_stage_history h
          join deals d on d.id = h.deal_id and d.deleted_at is null ${pipelineFilter}
          where h.changed_at >= now() - make_interval(days => ${days})
        )
        select
          s.id as stage_id,
          s.name as stage_name,
          s.display_order,
          count(*)::int as deals_entered,
          avg(extract(epoch from (m.next_at - m.changed_at)) / 86400)::float8 as avg_days
        from moves m
        join pipeline_stages s on s.id = m.to_stage_id
        group by s.id, s.name, s.display_order
        order by s.display_order`,
    );

    const [cycles] = await rows(
      tx,
      sql`
        select
          avg(extract(epoch from (d.closed_at - d.created_at)) / 86400)
            filter (where d.status = 'won')::float8 as won_days,
          avg(extract(epoch from (d.closed_at - d.created_at)) / 86400)
            filter (where d.status = 'lost')::float8 as lost_days
        from deals d
        where d.deleted_at is null and d.closed_at >= now() - make_interval(days => ${days}) ${pipelineFilter}`,
    );

    return {
      periodDays: days,
      stages: stages.map((r) => ({
        stageId: r.stage_id as string,
        stageName: r.stage_name as string,
        displayOrder: num(r.display_order),
        avgDaysInStage: r.avg_days === null ? null : round2(num(r.avg_days)),
        dealsEntered: num(r.deals_entered),
      })),
      avgWonCycleDays: cycles?.won_days == null ? null : round2(num(cycles.won_days)),
      avgLostCycleDays: cycles?.lost_days == null ? null : round2(num(cycles.lost_days)),
    };
  });
}

export async function stalledReport(
  db: Db,
  ctx: AuthContext,
  idleDays: number,
): Promise<StalledReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const deals = await rows(
      tx,
      sql`
        select
          d.id,
          d.name,
          a.name as account_name,
          s.name as stage_name,
          d.amount::float8 as amount,
          u.name as owner_name,
          lm.last_moved_at,
          la.last_activity_at,
          floor(extract(epoch from (now() - greatest(
            d.created_at,
            coalesce(lm.last_moved_at, d.created_at),
            coalesce(la.last_activity_at, d.created_at)
          ))) / 86400)::int as idle_days
        from deals d
        join accounts a on a.id = d.account_id
        join pipeline_stages s on s.id = d.stage_id
        left join users u on u.id = d.owner_id
        left join lateral (
          select max(h.changed_at) as last_moved_at
          from deal_stage_history h where h.deal_id = d.id
        ) lm on true
        left join lateral (
          select max(act.occurred_at) as last_activity_at
          from activity_links l
          join activities act on act.id = l.activity_id and act.deleted_at is null
          where l.deal_id = d.id
        ) la on true
        where d.status = 'open' and d.deleted_at is null
          and greatest(
            d.created_at,
            coalesce(lm.last_moved_at, d.created_at),
            coalesce(la.last_activity_at, d.created_at)
          ) < now() - make_interval(days => ${idleDays})
        order by idle_days desc
        limit 50`,
    );

    const mapped = deals.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      accountName: r.account_name as string,
      stageName: r.stage_name as string,
      amount: numOrNull(r.amount),
      ownerName: (r.owner_name as string | null) ?? null,
      idleDays: num(r.idle_days),
      lastMovedAt: iso(r.last_moved_at),
      lastActivityAt: iso(r.last_activity_at),
    }));
    return {
      idleDays,
      deals: mapped,
      totalAmount: round2(mapped.reduce((sum, d) => sum + (d.amount ?? 0), 0)),
    };
  });
}

export async function revenueReport(
  db: Db,
  ctx: AuthContext,
  months: number,
): Promise<RevenueReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const actual = await rows(
      tx,
      sql`
        select
          date_trunc('month', d.closed_at)::date as month,
          count(*)::int as count,
          coalesce(sum(d.amount), 0)::float8 as amount
        from deals d
        where d.status = 'won' and d.deleted_at is null
          and d.closed_at >= date_trunc('month', now()) - make_interval(months => ${months - 1})
        group by 1
        order by 1`,
    );

    const projected = await rows(
      tx,
      sql`
        select
          date_trunc('month', d.expected_close_date)::date as month,
          count(*)::int as count,
          coalesce(sum(d.amount), 0)::float8 as amount,
          coalesce(sum(d.amount * coalesce(d.probability, s.probability) / 100.0), 0)::float8 as weighted
        from deals d
        join pipeline_stages s on s.id = d.stage_id
        where d.status = 'open' and d.deleted_at is null
          and d.expected_close_date is not null
          and d.expected_close_date >= date_trunc('month', now())
          and d.expected_close_date < date_trunc('month', now()) + make_interval(months => ${months})
        group by 1
        order by 1`,
    );

    return {
      months,
      actual: actual.map((r) => ({
        month: String(r.month),
        count: num(r.count),
        amount: round2(num(r.amount)),
      })),
      projected: projected.map((r) => ({
        month: String(r.month),
        count: num(r.count),
        amount: round2(num(r.amount)),
        weighted: round2(num(r.weighted)),
      })),
    };
  });
}

export async function activityReport(
  db: Db,
  ctx: AuthContext,
  days: number,
): Promise<ActivityReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const byType = await rows(
      tx,
      sql`
        select a.type, count(*)::int as count
        from activities a
        where a.deleted_at is null and a.occurred_at >= now() - make_interval(days => ${days})
        group by a.type
        order by count desc`,
    );

    const byUser = await rows(
      tx,
      sql`
        select
          u.id,
          u.name,
          coalesce(act.cnt, 0)::int as activities,
          coalesce(t.cnt, 0)::int as tasks_completed
        from users u
        left join (
          select a.created_by, count(*)::int as cnt
          from activities a
          where a.deleted_at is null and a.occurred_at >= now() - make_interval(days => ${days})
          group by a.created_by
        ) act on act.created_by = u.id
        left join (
          select t.assignee_id, count(*)::int as cnt
          from tasks t
          where t.deleted_at is null and t.completed_at >= now() - make_interval(days => ${days})
          group by t.assignee_id
        ) t on t.assignee_id = u.id
        where coalesce(act.cnt, 0) > 0 or coalesce(t.cnt, 0) > 0
        order by activities desc, tasks_completed desc`,
    );

    const [taskStats] = await rows(
      tx,
      sql`
        select
          count(*) filter (where t.completed_at >= now() - make_interval(days => ${days}))::int as completed,
          count(*) filter (where t.status in ('open', 'in_progress'))::int as open,
          count(*) filter (where t.status in ('open', 'in_progress') and t.due_at < now())::int as overdue
        from tasks t
        where t.deleted_at is null`,
    );

    return {
      periodDays: days,
      byType: byType.map((r) => ({ type: String(r.type), count: num(r.count) })),
      byUser: byUser.map((r) => ({
        userId: r.id as string,
        userName: r.name as string,
        activities: num(r.activities),
        tasksCompleted: num(r.tasks_completed),
      })),
      tasks: {
        completedInPeriod: num(taskStats?.completed),
        open: num(taskStats?.open),
        overdue: num(taskStats?.overdue),
      },
    };
  });
}

function projectHealth(row: {
  status: string;
  daysToDue: number | null;
  milestonesTotal: number;
  milestonesCompleted: number;
  overdueTasks: number;
}): { health: ProjectHealthLevel; reasons: string[] } {
  const reasons: string[] = [];
  const milestonesRemaining = row.milestonesTotal - row.milestonesCompleted;

  if (row.daysToDue !== null && row.daysToDue < 0) reasons.push('past due date');
  if (row.overdueTasks > 0) {
    reasons.push(`${row.overdueTasks} overdue task${row.overdueTasks === 1 ? '' : 's'}`);
  }
  if (row.status === 'on_hold') reasons.push('on hold');
  if (row.daysToDue !== null && row.daysToDue >= 0 && row.daysToDue <= 7 && milestonesRemaining > 0) {
    reasons.push(`due in ${row.daysToDue}d with ${milestonesRemaining} open milestone${milestonesRemaining === 1 ? '' : 's'}`);
  }

  if ((row.daysToDue !== null && row.daysToDue < 0) || row.overdueTasks >= 3) {
    return { health: 'off_track', reasons };
  }
  if (reasons.length > 0) return { health: 'at_risk', reasons };
  return { health: 'on_track', reasons };
}

export async function projectHealthReport(
  db: Db,
  ctx: AuthContext,
): Promise<ProjectHealthReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const projects = await rows(
      tx,
      sql`
        select
          p.id,
          p.name,
          p.status,
          p.due_date,
          a.name as account_name,
          (p.due_date - current_date)::int as days_to_due,
          (select count(*) from milestones m where m.project_id = p.id)::int as m_total,
          (select count(*) from milestones m where m.project_id = p.id and m.status = 'completed')::int as m_done,
          (select count(*) from tasks t
            where t.project_id = p.id and t.deleted_at is null
              and t.status in ('open', 'in_progress'))::int as open_tasks,
          (select count(*) from tasks t
            where t.project_id = p.id and t.deleted_at is null
              and t.status in ('open', 'in_progress') and t.due_at < now())::int as overdue_tasks
        from projects p
        join accounts a on a.id = p.account_id
        where p.deleted_at is null and p.status in ('planned', 'active', 'on_hold')
        order by p.name`,
    );

    const mapped: ProjectHealthRow[] = projects.map((r) => {
      const base = {
        status: String(r.status),
        daysToDue: numOrNull(r.days_to_due),
        milestonesTotal: num(r.m_total),
        milestonesCompleted: num(r.m_done),
        overdueTasks: num(r.overdue_tasks),
      };
      const { health, reasons } = projectHealth(base);
      return {
        id: r.id as string,
        name: r.name as string,
        accountName: r.account_name as string,
        status: base.status,
        health,
        reasons,
        dueDate: r.due_date ? String(r.due_date) : null,
        daysToDue: base.daysToDue,
        milestonesTotal: base.milestonesTotal,
        milestonesCompleted: base.milestonesCompleted,
        openTasks: num(r.open_tasks),
        overdueTasks: base.overdueTasks,
      };
    });

    const order: Record<ProjectHealthLevel, number> = { off_track: 0, at_risk: 1, on_track: 2 };
    mapped.sort((a, b) => order[a.health] - order[b.health] || a.name.localeCompare(b.name));
    return {
      projects: mapped,
      summary: {
        on_track: mapped.filter((p) => p.health === 'on_track').length,
        at_risk: mapped.filter((p) => p.health === 'at_risk').length,
        off_track: mapped.filter((p) => p.health === 'off_track').length,
      },
    };
  });
}

function customerHealth(row: {
  daysSinceActivity: number | null;
  openDeals: number;
  activeProjects: number;
  overdueTasks: number;
}): { health: CustomerHealthLevel; reasons: string[] } {
  const reasons: string[] = [];
  const hasOpenBusiness = row.openDeals > 0 || row.activeProjects > 0;

  if (row.daysSinceActivity === null) {
    reasons.push('no activity ever logged');
    return { health: hasOpenBusiness ? 'at_risk' : 'watch', reasons };
  }
  if (row.daysSinceActivity > 30) {
    reasons.push(`no activity in ${row.daysSinceActivity} days`);
    return { health: hasOpenBusiness ? 'at_risk' : 'watch', reasons };
  }
  if (row.overdueTasks > 0) {
    reasons.push(`${row.overdueTasks} overdue task${row.overdueTasks === 1 ? '' : 's'}`);
    return { health: 'watch', reasons };
  }
  if (row.daysSinceActivity > 14) {
    reasons.push(`last activity ${row.daysSinceActivity} days ago`);
    return { health: 'watch', reasons };
  }
  return { health: 'healthy', reasons };
}

export async function customerHealthReport(
  db: Db,
  ctx: AuthContext,
): Promise<CustomerHealthReportDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    // Single pass per table (grouped CTEs) instead of correlated laterals
    // per account — the activity CTE resolves contact/deal links to their
    // account in one scan of activity_links.
    const accounts = await rows(
      tx,
      sql`
        with deal_stats as (
          select
            d.account_id,
            count(*) filter (where d.status = 'open') as open_deals,
            sum(d.amount) filter (where d.status = 'open') as open_amount,
            sum(d.amount) filter (where d.status = 'won') as won_revenue
          from deals d
          where d.deleted_at is null
          group by d.account_id
        ),
        account_activity as (
          select
            coalesce(l.account_id, c.account_id, d.account_id) as account_id,
            max(act.occurred_at) as last_activity_at
          from activity_links l
          join activities act on act.id = l.activity_id and act.deleted_at is null
          left join contacts c on c.id = l.contact_id
          left join deals d on d.id = l.deal_id
          group by 1
        ),
        project_stats as (
          select p.account_id, count(*) as active_projects
          from projects p
          where p.deleted_at is null and p.status = 'active'
          group by p.account_id
        ),
        task_stats as (
          select t.account_id, count(*) as overdue_tasks
          from tasks t
          where t.deleted_at is null and t.status in ('open', 'in_progress') and t.due_at < now()
          group by t.account_id
        )
        select
          a.id,
          a.name,
          coalesce(ds.open_deals, 0)::int as open_deals,
          coalesce(ds.open_amount, 0)::float8 as open_amount,
          coalesce(ds.won_revenue, 0)::float8 as won_revenue,
          aa.last_activity_at,
          coalesce(ps.active_projects, 0)::int as active_projects,
          coalesce(ts.overdue_tasks, 0)::int as overdue_tasks
        from accounts a
        left join deal_stats ds on ds.account_id = a.id
        left join account_activity aa on aa.account_id = a.id
        left join project_stats ps on ps.account_id = a.id
        left join task_stats ts on ts.account_id = a.id
        where a.deleted_at is null
        order by a.name
        limit 200`,
    );

    const now = Date.now();
    const mapped: CustomerHealthRow[] = accounts.map((r) => {
      const lastActivityAt = iso(r.last_activity_at);
      const daysSinceActivity =
        lastActivityAt === null
          ? null
          : Math.floor((now - new Date(lastActivityAt).getTime()) / 86_400_000);
      const base = {
        daysSinceActivity,
        openDeals: num(r.open_deals),
        activeProjects: num(r.active_projects),
        overdueTasks: num(r.overdue_tasks),
      };
      const { health, reasons } = customerHealth(base);
      return {
        accountId: r.id as string,
        name: r.name as string,
        health,
        reasons,
        openDeals: base.openDeals,
        openAmount: round2(num(r.open_amount)),
        wonRevenue: round2(num(r.won_revenue)),
        lastActivityAt,
        daysSinceActivity,
        activeProjects: base.activeProjects,
        overdueTasks: base.overdueTasks,
      };
    });

    const order: Record<CustomerHealthLevel, number> = { at_risk: 0, watch: 1, healthy: 2 };
    mapped.sort((a, b) => order[a.health] - order[b.health] || a.name.localeCompare(b.name));
    return {
      accounts: mapped,
      summary: {
        healthy: mapped.filter((a) => a.health === 'healthy').length,
        watch: mapped.filter((a) => a.health === 'watch').length,
        at_risk: mapped.filter((a) => a.health === 'at_risk').length,
      },
    };
  });
}
