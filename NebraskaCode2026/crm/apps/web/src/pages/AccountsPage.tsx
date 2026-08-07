import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAccounts, useCreateAccount } from '../api/hooks.js';
import { Button, Card, ErrorNote, Field, inputClass, Pager } from '../components/ui.js';

export function AccountsPage() {
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useAccounts({ query, industry, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Accounts</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Close' : 'New account'}
        </Button>
      </div>

      {showCreate ? <CreateAccountForm onDone={() => setShowCreate(false)} /> : null}

      <Card>
        <div className="mb-3 flex gap-2">
          <input
            className={inputClass}
            placeholder="Search name or domain…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <input
            className={inputClass}
            placeholder="Filter industry"
            value={industry}
            onChange={(e) => {
              setIndustry(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <th className="py-2">Name</th>
              <th className="py-2">Domain</th>
              <th className="py-2">Industry</th>
              <th className="py-2">Phone</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2">
                  <Link className="font-medium text-blue-700 hover:underline" to={`/accounts/${a.id}`}>
                    {a.name}
                  </Link>
                </td>
                <td className="py-2 text-gray-600">{a.domain ?? '—'}</td>
                <td className="py-2 text-gray-600">{a.industry ?? '—'}</td>
                <td className="py-2 text-gray-600">{a.phone ?? '—'}</td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-gray-500">
                  No accounts found.
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

function CreateAccountForm(props: { onDone: () => void }) {
  const create = useCreateAccount();
  const [form, setForm] = useState({ name: '', domain: '', industry: '', phone: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      name: form.name,
      ...(form.domain ? { domain: form.domain } : {}),
      ...(form.industry ? { industry: form.industry } : {}),
      ...(form.phone ? { phone: form.phone } : {}),
    });
    props.onDone();
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card title="New account">
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Domain">
          <input className={inputClass} value={form.domain} onChange={set('domain')} />
        </Field>
        <Field label="Industry">
          <input className={inputClass} value={form.industry} onChange={set('industry')} />
        </Field>
        <Field label="Phone">
          <input className={inputClass} value={form.phone} onChange={set('phone')} />
        </Field>
        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create account
          </Button>
          <ErrorNote error={create.error} />
        </div>
      </form>
    </Card>
  );
}
