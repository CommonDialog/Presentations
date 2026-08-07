import { useState } from 'react';
import { Link } from 'react-router';
import type { CustomerHealthLevel, ProjectHealthLevel } from '@crm/shared';
import { useForecast } from '../api/pipelineHooks.js';
import {
  useActivityReport,
  useCustomerHealthReport,
  useProjectHealthReport,
  useRevenueReport,
  useSalesReport,
  useStalledReport,
  useVelocityReport,
} from '../api/reportHooks.js';
import { Card } from '../components/ui.js';

const PERIODS = [7, 30, 90, 365] as const;

function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtMonth(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

function StatTile(props: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-xs text-gray-500">{props.label}</p>
      <p className="text-xl font-semibold text-gray-900">{props.value}</p>
      {props.hint ? <p className="text-xs text-gray-400">{props.hint}</p> : null}
    </div>
  );
}

/** Single-hue horizontal bar with a direct value label; value text stays in ink. */
function Bar(props: { label: string; value: number; max: number; display: string }) {
  const width = props.max > 0 ? Math.max(2, Math.round((props.value / props.max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-sm" title={`${props.label}: ${props.display}`}>
      <span className="w-32 shrink-0 truncate text-gray-700">{props.label}</span>
      <div className="h-4 flex-1 rounded-sm bg-gray-100">
        <div className="h-4 rounded-sm bg-blue-600" style={{ width: `${width}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-gray-700">{props.display}</span>
    </div>
  );
}

const projectHealthStyle: Record<ProjectHealthLevel, { label: string; className: string }> = {
  on_track: { label: 'On track', className: 'bg-green-100 text-green-800' },
  at_risk: { label: 'At risk', className: 'bg-amber-100 text-amber-800' },
  off_track: { label: 'Off track', className: 'bg-red-100 text-red-800' },
};

const customerHealthStyle: Record<CustomerHealthLevel, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'bg-green-100 text-green-800' },
  watch: { label: 'Watch', className: 'bg-amber-100 text-amber-800' },
  at_risk: { label: 'At risk', className: 'bg-red-100 text-red-800' },
};

function HealthBadge(props: { label: string; className: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${props.className}`}>{props.label}</span>
  );
}

export function ReportsPage() {
  const [days, setDays] = useState<number>(30);
  const sales = useSalesReport(days);
  const forecast = useForecast();
  const velocity = useVelocityReport(days);
  const stalled = useStalledReport(14);
  const revenue = useRevenueReport(6);
  const activity = useActivityReport(days);
  const projects = useProjectHealthReport();
  const customers = useCustomerHealthReport();

  const s = sales.data;
  const maxStageAmount = Math.max(0, ...(forecast.data?.stages.map((st) => st.totalAmount) ?? []));
  const maxActual = Math.max(0, ...(revenue.data?.actual.map((m) => m.amount) ?? []));
  const maxProjected = Math.max(0, ...(revenue.data?.projected.map((m) => m.weighted) ?? []));
  const maxVelocity = Math.max(0, ...(velocity.data?.stages.map((v) => v.avgDaysInStage ?? 0) ?? []));
  const maxActivity = Math.max(0, ...(activity.data?.byType.map((t) => t.count) ?? []));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                days === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Sales dashboard */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={`Won (${days}d)`} value={fmtMoney(s?.won.amount)} hint={`${s?.won.count ?? 0} deals`} />
        <StatTile
          label="Win rate"
          value={s?.winRate === null || s?.winRate === undefined ? '—' : `${s.winRate}%`}
          hint={`${(s?.won.count ?? 0) + (s?.lost.count ?? 0)} closed`}
        />
        <StatTile
          label="Weighted forecast"
          value={fmtMoney(s?.openPipeline.weighted)}
          hint={`${s?.openPipeline.count ?? 0} open · ${fmtMoney(s?.openPipeline.amount)}`}
        />
        <StatTile
          label="Avg sales cycle"
          value={s?.avgCycleDays === null || s?.avgCycleDays === undefined ? '—' : `${s.avgCycleDays}d`}
          hint={s?.avgWonDealSize != null ? `avg won deal ${fmtMoney(s.avgWonDealSize)}` : undefined}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Forecast by stage">
          <div className="space-y-1.5">
            {forecast.data?.stages.map((stage) => (
              <Bar
                key={stage.stageId}
                label={stage.stageName}
                value={stage.totalAmount}
                max={maxStageAmount}
                display={fmtMoney(stage.weightedAmount)}
              />
            ))}
            {forecast.data && forecast.data.stages.length === 0 ? (
              <p className="text-sm text-gray-500">No open deals.</p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Bar length = open amount; label = probability-weighted amount.
          </p>
        </Card>

        <Card title={`Leaderboard (won last ${days}d)`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1 font-medium">Owner</th>
                <th className="py-1 text-right font-medium">Won</th>
                <th className="py-1 text-right font-medium">Won $</th>
                <th className="py-1 text-right font-medium">Open</th>
                <th className="py-1 text-right font-medium">Open $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {s?.byOwner.map((o) => (
                <tr key={o.ownerId ?? 'none'}>
                  <td className="py-1 text-gray-800">{o.ownerName}</td>
                  <td className="py-1 text-right text-gray-700">{o.wonCount}</td>
                  <td className="py-1 text-right text-gray-700">{fmtMoney(o.wonAmount)}</td>
                  <td className="py-1 text-right text-gray-700">{o.openCount}</td>
                  <td className="py-1 text-right text-gray-700">{fmtMoney(o.openAmount)}</td>
                </tr>
              ))}
              {s && s.byOwner.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-gray-500">
                    No deals yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>

        <Card title="Won revenue by month">
          <div className="space-y-1.5">
            {revenue.data?.actual.map((m) => (
              <Bar key={m.month} label={fmtMonth(m.month)} value={m.amount} max={maxActual} display={fmtMoney(m.amount)} />
            ))}
            {revenue.data && revenue.data.actual.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing won in the last {revenue.data.months} months.</p>
            ) : null}
          </div>
        </Card>

        <Card title="Projected revenue (weighted, by expected close)">
          <div className="space-y-1.5">
            {revenue.data?.projected.map((m) => (
              <Bar key={m.month} label={fmtMonth(m.month)} value={m.weighted} max={maxProjected} display={fmtMoney(m.weighted)} />
            ))}
            {revenue.data && revenue.data.projected.length === 0 ? (
              <p className="text-sm text-gray-500">No open deals with expected close dates.</p>
            ) : null}
          </div>
        </Card>

        <Card title={`Stage velocity (last ${days}d)`}>
          <div className="space-y-1.5">
            {velocity.data?.stages.map((stage) => (
              <Bar
                key={stage.stageId}
                label={stage.stageName}
                value={stage.avgDaysInStage ?? 0}
                max={maxVelocity}
                display={stage.avgDaysInStage === null ? `${stage.dealsEntered} in` : `${stage.avgDaysInStage}d`}
              />
            ))}
            {velocity.data && velocity.data.stages.length === 0 ? (
              <p className="text-sm text-gray-500">No stage movement in this period.</p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Avg days per stage
            {velocity.data?.avgWonCycleDays != null ? ` · won cycle ${velocity.data.avgWonCycleDays}d` : ''}
            {velocity.data?.avgLostCycleDays != null ? ` · lost cycle ${velocity.data.avgLostCycleDays}d` : ''}
          </p>
        </Card>

        <Card title={`Activity (last ${days}d)`}>
          <div className="space-y-1.5">
            {activity.data?.byType.map((t) => (
              <Bar key={t.type} label={t.type} value={t.count} max={maxActivity} display={String(t.count)} />
            ))}
            {activity.data && activity.data.byType.length === 0 ? (
              <p className="text-sm text-gray-500">No activity logged in this period.</p>
            ) : null}
          </div>
          {activity.data ? (
            <p className="mt-2 text-xs text-gray-500">
              Tasks: {activity.data.tasks.completedInPeriod} completed · {activity.data.tasks.open} open ·{' '}
              {activity.data.tasks.overdue} overdue
            </p>
          ) : null}
          {activity.data && activity.data.byUser.length > 0 ? (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 font-medium">User</th>
                  <th className="py-1 text-right font-medium">Activities</th>
                  <th className="py-1 text-right font-medium">Tasks done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activity.data.byUser.map((u) => (
                  <tr key={u.userId}>
                    <td className="py-1 text-gray-800">{u.userName}</td>
                    <td className="py-1 text-right text-gray-700">{u.activities}</td>
                    <td className="py-1 text-right text-gray-700">{u.tasksCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      </div>

      <Card title={`Stalled deals (idle ≥ ${stalled.data?.idleDays ?? 14}d)`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 font-medium">Deal</th>
              <th className="py-1 font-medium">Account</th>
              <th className="py-1 font-medium">Stage</th>
              <th className="py-1 font-medium">Owner</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Idle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {stalled.data?.deals.map((deal) => (
              <tr key={deal.id}>
                <td className="py-1">
                  <Link className="text-blue-700 hover:underline" to={`/deals/${deal.id}`}>
                    {deal.name}
                  </Link>
                </td>
                <td className="py-1 text-gray-700">{deal.accountName}</td>
                <td className="py-1 text-gray-700">{deal.stageName}</td>
                <td className="py-1 text-gray-700">{deal.ownerName ?? '—'}</td>
                <td className="py-1 text-right text-gray-700">{fmtMoney(deal.amount)}</td>
                <td className="py-1 text-right font-medium text-red-700">{deal.idleDays}d</td>
              </tr>
            ))}
            {stalled.data && stalled.data.deals.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-gray-500">
                  Nothing stalled. Keep it moving.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {stalled.data && stalled.data.deals.length > 0 ? (
          <p className="mt-2 text-xs text-gray-500">{fmtMoney(stalled.data.totalAmount)} sitting idle.</p>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Project health">
          {projects.data ? (
            <p className="mb-2 text-xs text-gray-500">
              {projects.data.summary.on_track} on track · {projects.data.summary.at_risk} at risk ·{' '}
              {projects.data.summary.off_track} off track
            </p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {projects.data?.projects.map((project) => (
              <li key={project.id} className="flex items-start justify-between gap-2 py-2">
                <div>
                  <Link className="text-sm font-medium text-blue-700 hover:underline" to={`/projects/${project.id}`}>
                    {project.name}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {project.accountName} · {project.milestonesCompleted}/{project.milestonesTotal} milestones ·{' '}
                    {project.openTasks} open tasks
                    {project.reasons.length > 0 ? ` · ${project.reasons.join(', ')}` : ''}
                  </p>
                </div>
                <HealthBadge {...projectHealthStyle[project.health]} />
              </li>
            ))}
            {projects.data && projects.data.projects.length === 0 ? (
              <li className="py-3 text-center text-sm text-gray-500">No active projects.</li>
            ) : null}
          </ul>
        </Card>

        <Card title="Customer health">
          {customers.data ? (
            <p className="mb-2 text-xs text-gray-500">
              {customers.data.summary.healthy} healthy · {customers.data.summary.watch} watch ·{' '}
              {customers.data.summary.at_risk} at risk
            </p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {customers.data?.accounts.map((account) => (
              <li key={account.accountId} className="flex items-start justify-between gap-2 py-2">
                <div>
                  <Link
                    className="text-sm font-medium text-blue-700 hover:underline"
                    to={`/accounts/${account.accountId}`}
                  >
                    {account.name}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {account.openDeals} open ({fmtMoney(account.openAmount)}) · {fmtMoney(account.wonRevenue)} won
                    {account.reasons.length > 0 ? ` · ${account.reasons.join(', ')}` : ''}
                  </p>
                </div>
                <HealthBadge {...customerHealthStyle[account.health]} />
              </li>
            ))}
            {customers.data && customers.data.accounts.length === 0 ? (
              <li className="py-3 text-center text-sm text-gray-500">No accounts yet.</li>
            ) : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
