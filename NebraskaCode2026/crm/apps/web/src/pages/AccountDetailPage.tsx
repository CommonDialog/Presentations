import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import {
  useAccount,
  useArchiveAccount,
  useContacts,
  useUpdateAccount,
} from '../api/hooks.js';
import { Timeline } from '../components/Timeline.js';
import { ActivityComposer } from '../components/ActivityComposer.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';
import { CustomFieldsCard } from '../components/CustomFieldsCard.js';
import { useEnrichAccount } from '../api/integrationHooks.js';

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: account, isLoading } = useAccount(id!);
  const update = useUpdateAccount(id!);
  const archive = useArchiveAccount(id!);
  const contacts = useContacts({ accountId: id! });
  const enrich = useEnrichAccount(id!);

  const [form, setForm] = useState({ name: '', domain: '', industry: '', phone: '', description: '' });
  useEffect(() => {
    if (account) {
      setForm({
        name: account.name,
        domain: account.domain ?? '',
        industry: account.industry ?? '',
        phone: account.phone ?? '',
        description: account.description ?? '',
      });
    }
  }, [account]);

  if (isLoading || !account) return <p className="text-sm text-gray-500">Loading…</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      name: form.name,
      domain: form.domain || null,
      industry: form.industry || null,
      phone: form.phone || null,
      description: form.description || null,
    });
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {account.name}
          {account.deletedAt ? (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              archived
            </span>
          ) : null}
        </h1>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={enrich.isPending} onClick={() => enrich.mutate()}>
            ✨ Enrich
          </Button>
          <Button
            variant={account.deletedAt ? 'secondary' : 'danger'}
            onClick={() => archive.mutate(Boolean(account.deletedAt))}
          >
            {account.deletedAt ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </div>
      {enrich.data ? (
        <p className="text-xs text-gray-600">
          {enrich.data.provider}:{' '}
          {enrich.data.applied.length > 0
            ? `filled ${enrich.data.applied.join(', ')}`
            : 'no empty fields to fill'}
          {enrich.data.suggestions.linkedinUrl ? (
            <>
              {' · '}
              <a
                className="text-blue-700 hover:underline"
                href={enrich.data.suggestions.linkedinUrl}
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn profile
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <ErrorNote error={enrich.error} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Details">
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              <Field label="Name">
                <input className={inputClass} value={form.name} onChange={set('name')} required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Domain">
                  <input className={inputClass} value={form.domain} onChange={set('domain')} />
                </Field>
                <Field label="Industry">
                  <input className={inputClass} value={form.industry} onChange={set('industry')} />
                </Field>
              </div>
              <Field label="Phone">
                <input className={inputClass} value={form.phone} onChange={set('phone')} />
              </Field>
              <Field label="Description">
                <textarea
                  className={inputClass}
                  rows={3}
                  value={form.description}
                  onChange={set('description')}
                />
              </Field>
              <Button type="submit" disabled={update.isPending || Boolean(account.deletedAt)}>
                Save changes
              </Button>
              <ErrorNote error={update.error} />
            </form>
          </Card>

          <CustomFieldsCard
            entityType="account"
            values={account.custom}
            onSave={(custom) => update.mutate({ custom })}
            saving={update.isPending}
            error={update.error}
          />

          <Card title="Contacts">
            <ul className="space-y-1 text-sm">
              {contacts.data?.items.map((c) => (
                <li key={c.id}>
                  <Link className="text-blue-700 hover:underline" to={`/contacts/${c.id}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                  {c.title ? <span className="text-gray-500"> — {c.title}</span> : null}
                </li>
              ))}
              {contacts.data && contacts.data.items.length === 0 ? (
                <li className="text-gray-500">No contacts yet.</li>
              ) : null}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <ActivityComposer target={{ kind: 'account', id: account.id }} />
          <Timeline kind="account" id={account.id} />
        </div>
      </div>
    </div>
  );
}
