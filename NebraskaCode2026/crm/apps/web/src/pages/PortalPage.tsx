import { useParams } from 'react-router';
import { usePortalView } from '../api/projectHooks.js';

const milestoneIcon: Record<string, string> = {
  pending: '⬜',
  in_progress: '🔵',
  completed: '✅',
};

/** Public customer-facing status page — no login, the URL token is the access. */
export function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = usePortalView(token!);

  if (isLoading) return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  if (error || !data) {
    return (
      <main className="mx-auto mt-16 max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-gray-700">This project link is not available.</p>
        <p className="mt-1 text-sm text-gray-500">It may have been revoked — contact your project team.</p>
      </main>
    );
  }

  const progress =
    data.taskCounts.total > 0
      ? Math.round((data.taskCounts.completed / data.taskCounts.total) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">{data.accountName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900" data-testid="portal-title">
            {data.projectName}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Status: <strong>{data.status.replace('_', ' ')}</strong>
            {data.startDate ? ` · ${data.startDate} → ${data.dueDate ?? 'ongoing'}` : ''}
          </p>

          {data.taskCounts.total > 0 ? (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Progress</span>
                <span>
                  {data.taskCounts.completed}/{data.taskCounts.total} tasks · {progress}%
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-gray-200">
                <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}

          <h2 className="mt-6 text-sm font-semibold uppercase text-gray-500">Milestones</h2>
          <ul className="mt-2 space-y-2">
            {data.milestones.map((m) => (
              <li key={m.name} className="flex items-center gap-2 text-sm text-gray-800">
                <span>{milestoneIcon[m.status] ?? '⬜'}</span>
                <span className={m.status === 'completed' ? 'text-gray-400 line-through' : ''}>{m.name}</span>
                {m.dueDate ? <span className="text-xs text-gray-500">· {m.dueDate}</span> : null}
              </li>
            ))}
            {data.milestones.length === 0 ? <li className="text-sm text-gray-500">No milestones yet.</li> : null}
          </ul>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">Powered by CRM · read-only view</p>
      </main>
    </div>
  );
}
