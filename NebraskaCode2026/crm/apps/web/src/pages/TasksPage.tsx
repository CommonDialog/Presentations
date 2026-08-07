import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { taskPriorities, type TaskDto } from '@crm/shared';
import { useAccounts, useMe } from '../api/hooks.js';
import { useBoard } from '../api/pipelineHooks.js';
import { useCreateTask, useTasks, useUpdateTask } from '../api/activityHooks.js';
import { Button, Card, ErrorNote, Field, inputClass, Pager } from '../components/ui.js';

const priorityColors: Record<string, string> = {
  low: 'text-gray-500',
  normal: 'text-gray-700',
  high: 'text-amber-700',
  urgent: 'text-red-700',
};

export function TasksPage() {
  const { data: me } = useMe();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [showDone, setShowDone] = useState(false);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const update = useUpdateTask();

  const { data, isLoading } = useTasks({
    open: !showDone,
    ...(scope === 'mine' && me ? { assigneeId: me.user.id } : {}),
    page,
  });

  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New task'}</Button>
      </div>

      {showCreate ? <CreateTaskForm onDone={() => setShowCreate(false)} /> : null}

      <Card>
        <div className="mb-3 flex items-center gap-4 text-sm">
          <div className="flex gap-1">
            {(['mine', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setScope(s);
                  setPage(1);
                }}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  scope === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {s === 'mine' ? 'My tasks' : 'Everyone'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-gray-600">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            include completed
          </label>
        </div>

        {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        <ul className="divide-y divide-gray-100">
          {data?.items.map((task) => (
            <TaskRow key={task.id} task={task} now={now} onStatus={(status) => update.mutate({ id: task.id, status })} />
          ))}
          {data && data.items.length === 0 ? (
            <li className="py-6 text-center text-sm text-gray-500">Nothing to do. Suspicious.</li>
          ) : null}
        </ul>
        <ErrorNote error={update.error} />
        <Pager data={data} page={page} onPage={setPage} />
      </Card>
    </div>
  );
}

function TaskRow(props: { task: TaskDto; now: number; onStatus: (s: 'completed' | 'open') => void }) {
  const { task, now } = props;
  const overdue = task.dueAt && task.status !== 'completed' && new Date(task.dueAt).getTime() < now;
  const done = task.status === 'completed';
  return (
    <li className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={done}
        onChange={() => props.onStatus(done ? 'open' : 'completed')}
        aria-label={`complete ${task.title}`}
      />
      <div className="flex-1">
        <p className={`text-sm ${done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.title}</p>
        <p className="text-xs text-gray-500">
          <span className={priorityColors[task.priority]}>{task.priority}</span>
          {task.dueAt ? (
            <span className={overdue ? 'ml-2 font-semibold text-red-600' : 'ml-2'}>
              due {new Date(task.dueAt).toLocaleDateString()}
              {overdue ? ' — overdue' : ''}
            </span>
          ) : null}
          {task.accountId ? (
            <Link className="ml-2 text-blue-700 hover:underline" to={`/accounts/${task.accountId}`}>
              account
            </Link>
          ) : null}
          {task.dealId ? (
            <Link className="ml-2 text-blue-700 hover:underline" to={`/deals/${task.dealId}`}>
              deal
            </Link>
          ) : null}
          {task.contactId ? (
            <Link className="ml-2 text-blue-700 hover:underline" to={`/contacts/${task.contactId}`}>
              contact
            </Link>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function CreateTaskForm(props: { onDone: () => void }) {
  const create = useCreateTask();
  const accounts = useAccounts({ page: 1 });
  const board = useBoard();
  const [form, setForm] = useState({
    title: '',
    dueAt: '',
    reminderAt: '',
    priority: 'normal',
    accountId: '',
    dealId: '',
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      title: form.title,
      priority: form.priority as (typeof taskPriorities)[number],
      ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {}),
      ...(form.reminderAt ? { reminderAt: new Date(form.reminderAt).toISOString() } : {}),
      ...(form.accountId ? { accountId: form.accountId } : {}),
      ...(form.dealId ? { dealId: form.dealId } : {}),
    });
    props.onDone();
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const allDeals = board.data?.columns.flatMap((c) => c.deals) ?? [];

  return (
    <Card title="New task">
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Title">
            <input className={inputClass} value={form.title} onChange={set('title')} required />
          </Field>
        </div>
        <Field label="Due">
          <input className={inputClass} type="datetime-local" value={form.dueAt} onChange={set('dueAt')} />
        </Field>
        <Field label="Reminder">
          <input
            className={inputClass}
            type="datetime-local"
            value={form.reminderAt}
            onChange={set('reminderAt')}
          />
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={form.priority} onChange={set('priority')}>
            {taskPriorities.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account">
          <select className={inputClass} value={form.accountId} onChange={set('accountId')}>
            <option value="">— none —</option>
            {accounts.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deal">
          <select className={inputClass} value={form.dealId} onChange={set('dealId')}>
            <option value="">— none —</option>
            {allDeals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create task
          </Button>
          <ErrorNote error={create.error} />
        </div>
      </form>
    </Card>
  );
}
