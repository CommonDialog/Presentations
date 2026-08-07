import type { GanttDto } from '@crm/shared';

const DAY = 86_400_000;

/** Lightweight SVG Gantt: milestone diamonds + task bars on a shared time axis. */
export function GanttChart({ gantt }: { gantt: GanttDto }) {
  const start = new Date(gantt.rangeStart).getTime() - DAY;
  const end = new Date(gantt.rangeEnd).getTime() + DAY;
  const span = Math.max(end - start, DAY);

  const rows: {
    label: string;
    kind: 'milestone' | 'task';
    from: number;
    to: number | null;
    status: string;
  }[] = [
    ...gantt.milestones.map((m) => ({
      label: m.name,
      kind: 'milestone' as const,
      from: m.dueDate ? new Date(m.dueDate).getTime() : end,
      to: null,
      status: m.status,
    })),
    ...gantt.tasks.map((t) => ({
      label: t.title,
      kind: 'task' as const,
      from: new Date(t.startAt).getTime(),
      to: t.dueAt ? new Date(t.dueAt).getTime() : null,
      status: t.status,
    })),
  ];

  const width = 640;
  const rowHeight = 26;
  const labelWidth = 180;
  const chartWidth = width - labelWidth;
  const height = rows.length * rowHeight + 30;
  const x = (time: number) => labelWidth + ((time - start) / span) * chartWidth;

  const statusColor: Record<string, string> = {
    completed: '#10b981',
    in_progress: '#3b82f6',
    open: '#94a3b8',
    canceled: '#d1d5db',
    pending: '#94a3b8',
  };

  // month tick marks
  const ticks: { time: number; label: string }[] = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  while (cursor.getTime() < end) {
    if (cursor.getTime() > start) {
      ticks.push({
        time: cursor.getTime(),
        label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (ticks.length === 0) {
    ticks.push({ time: start + span / 2, label: new Date(start + span / 2).toLocaleDateString() });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">Add milestones and tasks to see the Gantt view.</p>;
  }

  return (
    <div className="overflow-x-auto" data-testid="gantt">
      <svg width={width} height={height} role="img" aria-label="Project Gantt chart">
        {ticks.map((tick) => (
          <g key={tick.time}>
            <line x1={x(tick.time)} y1={16} x2={x(tick.time)} y2={height} stroke="#e5e7eb" />
            <text x={x(tick.time) + 3} y={12} fontSize={9} fill="#6b7280">
              {tick.label}
            </text>
          </g>
        ))}
        {rows.map((row, i) => {
          const y = 20 + i * rowHeight;
          return (
            <g key={`${row.kind}-${row.label}-${i}`}>
              <text x={0} y={y + 14} fontSize={11} fill="#374151">
                {row.label.length > 26 ? `${row.label.slice(0, 25)}…` : row.label}
              </text>
              {row.kind === 'milestone' ? (
                <path
                  d={`M ${x(row.from)} ${y + 4} l 7 7 l -7 7 l -7 -7 z`}
                  fill={statusColor[row.status] ?? '#94a3b8'}
                />
              ) : (
                <rect
                  x={x(row.from)}
                  y={y + 5}
                  width={Math.max(row.to ? x(row.to) - x(row.from) : 6, 6)}
                  height={12}
                  rx={3}
                  fill={statusColor[row.status] ?? '#94a3b8'}
                  opacity={0.85}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
