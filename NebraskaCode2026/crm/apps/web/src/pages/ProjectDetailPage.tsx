import { useState, type DragEvent, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { canTransition, projectTransitions, type ProjectStatus, type ProjectTaskDto } from '@crm/shared';
import {
  useMilestoneMutations,
  useMilestones,
  usePortal,
  useProject,
  useProjectBoard,
  useProjectGantt,
  useProjectTaskMutations,
  useUpdateProject,
} from '../api/projectHooks.js';
import { GanttChart } from '../components/GanttChart.js';
import { Timeline } from '../components/Timeline.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';
import { CustomFieldsCard } from '../components/CustomFieldsCard.js';
import { projectStatusStyles } from './ProjectsPage.js';

const columnLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
};

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useProject(id!);
  const update = useUpdateProject(id!);
  const milestones = useMilestones(id!);
  const milestoneOps = useMilestoneMutations(id!);
  const board = useProjectBoard(id!);
  const gantt = useProjectGantt(id!);
  const taskOps = useProjectTaskMutations(id!);
  const portal = usePortal(id!);

  const [newMilestone, setNewMilestone] = useState('');
  const [newTask, setNewTask] = useState({ title: '', milestoneId: '' });
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [view, setView] = useState<'kanban' | 'gantt'>('kanban');

  if (!project) return <p className="text-sm text-gray-500">Loading…</p>;

  const nextStatuses = (projectTransitions[project.status] ?? []) as readonly ProjectStatus[];

  const onDrop = (e: DragEvent, status: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/task-id');
    if (taskId) taskOps.setStatus.mutate({ id: taskId, status });
  };

  const addMilestone = (e: FormEvent) => {
    e.preventDefault();
    if (!newMilestone.trim()) return;
    milestoneOps.create.mutate({ name: newMilestone.trim() });
    setNewMilestone('');
  };

  const addTask = (e: FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    taskOps.create.mutate({
      title: newTask.title.trim(),
      projectId: project.id,
      ...(newTask.milestoneId ? { milestoneId: newTask.milestoneId } : {}),
    });
    setNewTask({ title: '', milestoneId: '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-3 text-xl font-semibold text-gray-900">
          {project.name}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${projectStatusStyles[project.status]}`}>
            {project.status.replace('_', ' ')}
          </span>
        </h1>
        <div className="flex gap-2">
          {nextStatuses.map((s) => (
            <Button
              key={s}
              variant="secondary"
              onClick={() =>
                update.mutate(s === 'completed' ? { status: s, waiveMilestones: true } : { status: s })
              }
            >
              {s === 'completed' ? 'Complete' : `Mark ${s.replace('_', ' ')}`}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-600">
        {project.accountName}
        {project.startDate ? ` · ${project.startDate} → ${project.dueDate ?? '…'}` : ''}
      </p>
      <ErrorNote error={update.error} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Milestones">
          <ul className="mb-3 space-y-1 text-sm" data-testid="milestones">
            {milestones.data?.milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span className={m.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-800'}>
                  {m.name}
                  {m.dueDate ? <span className="text-xs text-gray-500"> · {m.dueDate}</span> : null}
                </span>
                {m.status !== 'completed' ? (
                  <button
                    type="button"
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() => milestoneOps.update.mutate({ id: m.id, status: 'completed' })}
                  >
                    complete
                  </button>
                ) : (
                  '✅'
                )}
              </li>
            ))}
            {milestones.data?.milestones.length === 0 ? (
              <li className="text-gray-500">No milestones yet.</li>
            ) : null}
          </ul>
          <form onSubmit={addMilestone} className="flex gap-2">
            <input
              className={inputClass}
              placeholder="New milestone…"
              value={newMilestone}
              onChange={(e) => setNewMilestone(e.target.value)}
            />
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
          <ErrorNote error={milestoneOps.update.error ?? milestoneOps.create.error} />
        </Card>

        <CustomFieldsCard
          entityType="project"
          values={project.custom}
          onSave={(custom) => update.mutate({ custom })}
          saving={update.isPending}
          error={update.error}
        />

        <Card title="Customer portal">
          {project.portalEnabled || portalToken ? (
            <div className="space-y-2 text-sm">
              <p className="text-emerald-700">Portal link is active.</p>
              {portalToken ? (
                <p className="break-all rounded bg-gray-50 p-2 font-mono text-xs" data-testid="portal-link">
                  {`${window.location.origin}/portal/${portalToken}`}
                </p>
              ) : (
                <p className="text-gray-500">Re-enable to generate a fresh link.</p>
              )}
              <div className="flex gap-2">
                {portalToken ? (
                  <a
                    className="text-blue-700 hover:underline"
                    href={`/portal/${portalToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open portal ↗
                  </a>
                ) : null}
                <button
                  type="button"
                  className="text-red-700 hover:underline"
                  onClick={() => {
                    portal.disable.mutate();
                    setPortalToken(null);
                  }}
                >
                  Revoke
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-gray-600">Share a read-only status page with the customer.</p>
              <Button
                variant="secondary"
                onClick={() => portal.enable.mutate(undefined, { onSuccess: (r) => setPortalToken(r.token) })}
              >
                Enable portal
              </Button>
            </div>
          )}
          <ErrorNote error={portal.enable.error ?? portal.disable.error} />
        </Card>

        <Card title="Add task">
          <form onSubmit={addTask} className="space-y-2">
            <Field label="Title">
              <input
                className={inputClass}
                value={newTask.title}
                onChange={(e) => setNewTask((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
            <Field label="Milestone">
              <select
                className={inputClass}
                value={newTask.milestoneId}
                onChange={(e) => setNewTask((f) => ({ ...f, milestoneId: e.target.value }))}
              >
                <option value="">—</option>
                {milestones.data?.milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" variant="secondary" disabled={taskOps.create.isPending}>
              Add task
            </Button>
            <ErrorNote error={taskOps.create.error} />
          </form>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        {(['kanban', 'gantt'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded px-2 py-1 text-xs font-medium ${
              view === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {v === 'kanban' ? 'Kanban' : 'Gantt'}
          </button>
        ))}
        <ErrorNote error={taskOps.setStatus.error} />
      </div>

      {view === 'kanban' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {board.data?.columns.map((column) => (
            <div
              key={column.status}
              className="rounded-lg bg-gray-200/70 p-2"
              data-testid={`kanban-${column.status}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, column.status)}
            >
              <p className="mb-2 px-1 text-sm font-semibold text-gray-700">
                {columnLabels[column.status]}{' '}
                <span className="font-normal text-gray-500">({column.tasks.length})</span>
              </p>
              <div className="space-y-2">
                {column.tasks.map((task: ProjectTaskDto) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/task-id', task.id)}
                    className="cursor-grab rounded border border-gray-200 bg-white p-2 text-sm shadow-sm"
                  >
                    <p className="text-gray-800">
                      {task.blocked ? '🔒 ' : ''}
                      {task.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {task.milestoneName ?? ''}
                      {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : gantt.data ? (
        <Card title="Gantt">
          <GanttChart gantt={gantt.data} />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Timeline kind="project" id={project.id} />
      </div>
    </div>
  );
}
