import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAccounts, useContacts, useCreateContact } from '../api/hooks.js';
import { Button, Card, ErrorNote, Field, inputClass, Pager } from '../components/ui.js';

export function ContactsPage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useContacts({ query, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Close' : 'New contact'}
        </Button>
      </div>

      {showCreate ? <CreateContactForm onDone={() => setShowCreate(false)} /> : null}

      <Card>
        <input
          className={`${inputClass} mb-3`}
          placeholder="Search name or email…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <th className="py-2">Name</th>
              <th className="py-2">Email</th>
              <th className="py-2">Title</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2">
                  <Link className="font-medium text-blue-700 hover:underline" to={`/contacts/${c.id}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td className="py-2 text-gray-600">{c.email ?? '—'}</td>
                <td className="py-2 text-gray-600">{c.title ?? '—'}</td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-gray-500">
                  No contacts found.
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

function CreateContactForm(props: { onDone: () => void }) {
  const create = useCreateContact();
  const accounts = useAccounts({ page: 1 });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', title: '', accountId: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await create.mutateAsync({
      firstName: form.firstName,
      lastName: form.lastName,
      ...(form.email ? { email: form.email } : {}),
      ...(form.title ? { title: form.title } : {}),
      ...(form.accountId ? { accountId: form.accountId } : {}),
    });
    if (result.warnings.length > 0) {
      setWarnings(result.warnings);
    } else {
      props.onDone();
    }
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card title="New contact">
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input className={inputClass} value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field label="Last name">
          <input className={inputClass} value={form.lastName} onChange={set('lastName')} required />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Title">
          <input className={inputClass} value={form.title} onChange={set('title')} />
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
        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create contact
          </Button>
          <ErrorNote error={create.error} />
          {warnings.map((w) => (
            <p key={w} className="mt-2 text-sm text-amber-700">
              ⚠ {w} — contact was created anyway.
            </p>
          ))}
        </div>
      </form>
    </Card>
  );
}
