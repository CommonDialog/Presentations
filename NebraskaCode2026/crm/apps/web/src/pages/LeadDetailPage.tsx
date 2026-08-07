import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { leadTransitions, canTransition, type LeadStatus } from '@crm/shared';
import { useConvertLead, useLead, useLeadStatus, useUpdateLead } from '../api/pipelineHooks.js';
import { Timeline } from '../components/Timeline.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';
import { CustomFieldsCard } from '../components/CustomFieldsCard.js';
import { LeadStatusBadge } from './LeadsPage.js';

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: lead, isLoading } = useLead(id!);
  const update = useUpdateLead(id!);
  const setStatus = useLeadStatus(id!);
  const convert = useConvertLead(id!);

  const [form, setForm] = useState({ firstName: '', lastName: '', company: '', email: '', phone: '', source: '' });
  const [showConvert, setShowConvert] = useState(false);
  const [dealForm, setDealForm] = useState({ createDeal: true, name: '', amount: '' });

  useEffect(() => {
    if (lead) {
      setForm({
        firstName: lead.firstName ?? '',
        lastName: lead.lastName ?? '',
        company: lead.company ?? '',
        email: lead.email ?? '',
        phone: lead.phone ?? '',
        source: lead.source ?? '',
      });
      setDealForm((d) => ({
        ...d,
        name: d.name || `${lead.company ?? [lead.firstName, lead.lastName].filter(Boolean).join(' ')} deal`,
      }));
    }
  }, [lead]);

  if (isLoading || !lead) return <p className="text-sm text-gray-500">Loading…</p>;

  const frozen = lead.status === 'converted';
  const nextStatuses = (['working', 'qualified', 'disqualified'] as LeadStatus[]).filter((s) =>
    canTransition(leadTransitions, lead.status, s),
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      firstName: form.firstName || null,
      lastName: form.lastName || null,
      company: form.company || null,
      email: form.email || null,
      phone: form.phone || null,
      source: form.source || null,
    });
  };

  const doConvert = async () => {
    await convert.mutateAsync(
      dealForm.createDeal
        ? {
            deal: {
              name: dealForm.name,
              ...(dealForm.amount ? { amount: Number(dealForm.amount) } : {}),
            },
          }
        : {},
    );
    setShowConvert(false);
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-3 text-xl font-semibold text-gray-900">
          {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.company || 'Lead'}
          <LeadStatusBadge status={lead.status} />
        </h1>
        <div className="flex gap-2">
          {nextStatuses.map((s) => (
            <Button key={s} variant="secondary" onClick={() => setStatus.mutate(s)}>
              Mark {s}
            </Button>
          ))}
          {lead.status === 'qualified' ? (
            <Button onClick={() => setShowConvert((v) => !v)}>Convert…</Button>
          ) : null}
        </div>
      </div>
      <ErrorNote error={setStatus.error} />

      {frozen ? (
        <Card title="Converted">
          <div className="flex gap-4 text-sm">
            {lead.convertedAccountId ? (
              <Link className="text-blue-700 hover:underline" to={`/accounts/${lead.convertedAccountId}`}>
                View account
              </Link>
            ) : null}
            {lead.convertedContactId ? (
              <Link className="text-blue-700 hover:underline" to={`/contacts/${lead.convertedContactId}`}>
                View contact
              </Link>
            ) : null}
            {lead.convertedDealId ? (
              <Link className="text-blue-700 hover:underline" to={`/deals/${lead.convertedDealId}`}>
                View deal
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      {showConvert && !frozen ? (
        <Card title="Convert lead">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={dealForm.createDeal}
                onChange={(e) => setDealForm((d) => ({ ...d, createDeal: e.target.checked }))}
              />
              Create a deal
            </label>
            {dealForm.createDeal ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Deal name">
                  <input
                    className={inputClass}
                    value={dealForm.name}
                    onChange={(e) => setDealForm((d) => ({ ...d, name: e.target.value }))}
                  />
                </Field>
                <Field label="Amount">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    value={dealForm.amount}
                    onChange={(e) => setDealForm((d) => ({ ...d, amount: e.target.value }))}
                  />
                </Field>
              </div>
            ) : null}
            <Button onClick={() => void doConvert()} disabled={convert.isPending}>
              Convert lead
            </Button>
            <ErrorNote error={convert.error} />
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Details">
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input className={inputClass} value={form.firstName} onChange={set('firstName')} disabled={frozen} />
              </Field>
              <Field label="Last name">
                <input className={inputClass} value={form.lastName} onChange={set('lastName')} disabled={frozen} />
              </Field>
            </div>
            <Field label="Company">
              <input className={inputClass} value={form.company} onChange={set('company')} disabled={frozen} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <input className={inputClass} type="email" value={form.email} onChange={set('email')} disabled={frozen} />
              </Field>
              <Field label="Phone">
                <input className={inputClass} value={form.phone} onChange={set('phone')} disabled={frozen} />
              </Field>
            </div>
            <Field label="Source">
              <input className={inputClass} value={form.source} onChange={set('source')} disabled={frozen} />
            </Field>
            <Button type="submit" disabled={update.isPending || frozen}>
              Save changes
            </Button>
            <ErrorNote error={update.error} />
          </form>
        </Card>

        <div className="space-y-4">
          <CustomFieldsCard
            entityType="lead"
            values={lead.custom}
            onSave={(custom) => update.mutate({ custom })}
            saving={update.isPending}
            error={update.error}
          />
          <Timeline kind="lead" id={lead.id} />
        </div>
      </div>
    </div>
  );
}
