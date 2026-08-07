import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import {
  useAccount,
  useArchiveContact,
  useContact,
  useUpdateContact,
} from '../api/hooks.js';
import { Timeline } from '../components/Timeline.js';
import { ActivityComposer } from '../components/ActivityComposer.js';
import { CallCard } from '../components/CallCard.js';
import { EmailComposer } from '../components/EmailComposer.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';
import { CustomFieldsCard } from '../components/CustomFieldsCard.js';
import { useEnrichContact } from '../api/integrationHooks.js';

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: contact, isLoading } = useContact(id!);
  const update = useUpdateContact(id!);
  const archive = useArchiveContact(id!);
  const enrich = useEnrichContact(id!);

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', title: '' });
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (contact) {
      setForm({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        title: contact.title ?? '',
      });
    }
  }, [contact]);

  if (isLoading || !contact) return <p className="text-sm text-gray-500">Loading…</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await update.mutateAsync({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email || null,
      phone: form.phone || null,
      title: form.title || null,
    });
    setWarnings(result.warnings);
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {contact.firstName} {contact.lastName}
          {contact.deletedAt ? (
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
            variant={contact.deletedAt ? 'secondary' : 'danger'}
            onClick={() => archive.mutate(Boolean(contact.deletedAt))}
          >
            {contact.deletedAt ? 'Restore' : 'Archive'}
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

      {contact.accountId ? <AccountLink accountId={contact.accountId} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input className={inputClass} value={form.firstName} onChange={set('firstName')} required />
              </Field>
              <Field label="Last name">
                <input className={inputClass} value={form.lastName} onChange={set('lastName')} required />
              </Field>
            </div>
            <Field label="Email">
              <input className={inputClass} type="email" value={form.email} onChange={set('email')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input className={inputClass} value={form.phone} onChange={set('phone')} />
              </Field>
              <Field label="Title">
                <input className={inputClass} value={form.title} onChange={set('title')} />
              </Field>
            </div>
            <Button type="submit" disabled={update.isPending || Boolean(contact.deletedAt)}>
              Save changes
            </Button>
            <ErrorNote error={update.error} />
            {warnings.map((w) => (
              <p key={w} className="text-sm text-amber-700">
                ⚠ {w}
              </p>
            ))}
          </form>
        </Card>

        <div className="space-y-4">
          <CustomFieldsCard
            entityType="contact"
            values={contact.custom}
            onSave={(custom) => update.mutate({ custom })}
            saving={update.isPending}
            error={update.error}
          />
          <CallCard contactId={contact.id} phone={contact.phone} />
          {contact.email ? <EmailComposer contactId={contact.id} email={contact.email} /> : null}
          <ActivityComposer target={{ kind: 'contact', id: contact.id }} />
          <Timeline kind="contact" id={contact.id} />
        </div>
      </div>
    </div>
  );
}

function AccountLink(props: { accountId: string }) {
  const { data } = useAccount(props.accountId);
  if (!data) return null;
  return (
    <p className="text-sm text-gray-600">
      Account:{' '}
      <Link className="text-blue-700 hover:underline" to={`/accounts/${data.id}`}>
        {data.name}
      </Link>
    </p>
  );
}
