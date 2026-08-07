import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { leadStatuses } from '@crm/shared';
import { useCreateLead, useLeads } from '../api/pipelineHooks.js';
import { Button, Card, ErrorNote, Field, inputClass, Pager } from '../components/ui.js';

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  working: 'bg-indigo-100 text-indigo-800',
  qualified: 'bg-emerald-100 text-emerald-800',
  disqualified: 'bg-gray-200 text-gray-600',
  converted: 'bg-amber-100 text-amber-800',
};

export function LeadStatusBadge(props: { status: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${statusColors[props.status] ?? 'bg-gray-100'}`}
    >
      {props.status}
    </span>
  );
}

export function LeadsPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useLeads({ query, status, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Leads</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New lead'}</Button>
      </div>

      {showCreate ? <CreateLeadForm onDone={() => setShowCreate(false)} /> : null}

      <Card>
        <div className="mb-3 flex gap-2">
          <input
            className={inputClass}
            placeholder="Search leads…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <select
            className={inputClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {leadStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <th className="py-2">Lead</th>
              <th className="py-2">Company</th>
              <th className="py-2">Email</th>
              <th className="py-2">Status</th>
              <th className="py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((lead) => (
              <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2">
                  <Link className="font-medium text-blue-700 hover:underline" to={`/leads/${lead.id}`}>
                    {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.company || '—'}
                  </Link>
                </td>
                <td className="py-2 text-gray-600">{lead.company ?? '—'}</td>
                <td className="py-2 text-gray-600">{lead.email ?? '—'}</td>
                <td className="py-2">
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td className="py-2 text-gray-600">{lead.source ?? '—'}</td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  No leads found.
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

function CreateLeadForm(props: { onDone: () => void }) {
  const create = useCreateLead();
  const [form, setForm] = useState({ firstName: '', lastName: '', company: '', email: '', source: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      ...(form.firstName ? { firstName: form.firstName } : {}),
      ...(form.lastName ? { lastName: form.lastName } : {}),
      ...(form.company ? { company: form.company } : {}),
      ...(form.email ? { email: form.email } : {}),
      ...(form.source ? { source: form.source } : {}),
    });
    props.onDone();
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card title="New lead">
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input className={inputClass} value={form.firstName} onChange={set('firstName')} />
        </Field>
        <Field label="Last name">
          <input className={inputClass} value={form.lastName} onChange={set('lastName')} />
        </Field>
        <Field label="Company">
          <input className={inputClass} value={form.company} onChange={set('company')} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Source">
          <input className={inputClass} value={form.source} onChange={set('source')} />
        </Field>
        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create lead
          </Button>
          <ErrorNote error={create.error} />
        </div>
      </form>
    </Card>
  );
}
