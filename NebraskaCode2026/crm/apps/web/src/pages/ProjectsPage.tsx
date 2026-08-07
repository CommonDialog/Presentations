import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { projectStatuses } from '@crm/shared';
import { useAccounts } from '../api/hooks.js';
import { useCreateProject, useProjects } from '../api/projectHooks.js';
import { Button, Card, ErrorNote, Field, inputClass, Pager } from '../components/ui.js';

export const projectStatusStyles: Record<string, string> = {
  planned: 'bg-gray-200 text-gray-700',
  active: 'bg-blue-100 text-blue-800',
  on_hold: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  canceled: 'bg-gray-200 text-gray-500',
};

export function ProjectsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useProjects({ status, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New project'}</Button>
      </div>

      {showCreate ? <CreateProjectForm onDone={() => setShowCreate(false)} /> : null}

      <Card>
        <select
          className={`${inputClass} mb-3 max-w-xs`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {projectStatuses.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <th className="py-2">Project</th>
              <th className="py-2">Account</th>
              <th className="py-2">Status</th>
              <th className="py-2">Due</th>
              <th className="py-2">Portal</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2">
                  <Link className="font-medium text-blue-700 hover:underline" to={`/projects/${p.id}`}>
                    {p.name}
                  </Link>
                </td>
                <td className="py-2 text-gray-600">{p.accountName}</td>
                <td className="py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${projectStatusStyles[p.status]}`}>
                    {p.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="py-2 text-gray-600">{p.dueDate ?? '—'}</td>
                <td className="py-2 text-gray-600">{p.portalEnabled ? '🔗 shared' : '—'}</td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  No projects yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <Pager data={data} page={page} onPage={setPage} />
      </Card>
    </div>
  );
}

function CreateProjectForm(props: { onDone: () => void }) {
  const create = useCreateProject();
  const accounts = useAccounts({ page: 1 });
  const [form, setForm] = useState({ name: '', accountId: '', startDate: '', dueDate: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.accountId) return;
    await create.mutateAsync({
      name: form.name,
      accountId: form.accountId,
      ...(form.startDate ? { startDate: form.startDate } : {}),
      ...(form.dueDate ? { dueDate: form.dueDate } : {}),
    });
    props.onDone();
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card title="New project">
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Account">
          <select className={inputClass} value={form.accountId} onChange={set('accountId')} required>
            <option value="">— choose —</option>
            {accounts.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date">
          <input className={inputClass} type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Due date">
          <input className={inputClass} type="date" value={form.dueDate} onChange={set('dueDate')} />
        </Field>
        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create project
          </Button>
          <ErrorNote error={create.error} />
        </div>
      </form>
    </Card>
  );
}
