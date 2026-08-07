import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useContacts } from '../api/hooks.js';
import {
  useAddDealContact,
  useDeal,
  useDealContacts,
  useDealHistory,
  useMoveDeal,
  usePipelines,
  useUpdateDeal,
} from '../api/pipelineHooks.js';
import { Timeline } from '../components/Timeline.js';
import { ActivityComposer } from '../components/ActivityComposer.js';
import { DealInsight } from '../components/DealInsight.js';
import { useCreateProjectFromDeal } from '../api/projectHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';
import { CustomFieldsCard } from '../components/CustomFieldsCard.js';

const statusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-red-100 text-red-800',
};

function CreateOnboardingButton({ dealId }: { dealId: string }) {
  const navigate = useNavigate();
  const create = useCreateProjectFromDeal();
  return (
    <Button
      variant="secondary"
      disabled={create.isPending}
      onClick={() =>
        create.mutate(dealId, { onSuccess: (project) => navigate(`/projects/${project.id}`) })
      }
    >
      🚀 Start onboarding project
    </Button>
  );
}

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: deal, isLoading } = useDeal(id!);
  const pipelines = usePipelines();
  const update = useUpdateDeal(id!);
  const move = useMoveDeal();
  const history = useDealHistory(id!);
  const dealContacts = useDealContacts(id!);
  const orgContacts = useContacts({ accountId: deal?.accountId ?? '' });
  const addContact = useAddDealContact(id!);

  const [form, setForm] = useState({ name: '', amount: '', probability: '', expectedCloseDate: '' });
  const [targetStage, setTargetStage] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [contactToAdd, setContactToAdd] = useState('');

  useEffect(() => {
    if (deal) {
      setForm({
        name: deal.name,
        amount: deal.amount === null ? '' : String(deal.amount),
        probability: deal.probability === null ? '' : String(deal.probability),
        expectedCloseDate: deal.expectedCloseDate ?? '',
      });
      setTargetStage(deal.stageId);
    }
  }, [deal]);

  if (isLoading || !deal) return <p className="text-sm text-gray-500">Loading…</p>;

  const stages = pipelines.data?.pipelines.find((p) => p.id === deal.pipelineId)?.stages ?? [];
  const selectedStage = stages.find((s) => s.id === targetStage);
  const needsReason = selectedStage?.isLost ?? false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      name: form.name,
      amount: form.amount === '' ? null : Number(form.amount),
      probability: form.probability === '' ? null : Number(form.probability),
      expectedCloseDate: form.expectedCloseDate === '' ? null : form.expectedCloseDate,
    });
  };

  const doMove = () => {
    if (!targetStage || targetStage === deal.stageId) return;
    move.mutate({
      id: deal.id,
      stageId: targetStage,
      ...(needsReason && lossReason.trim() ? { winLossReason: lossReason.trim() } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-3 text-xl font-semibold text-gray-900">
          {deal.name}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColors[deal.status]}`}>
            {deal.status}
          </span>
        </h1>
        <div className="flex items-center gap-3">
          {deal.status === 'won' ? <CreateOnboardingButton dealId={deal.id} /> : null}
          <Link className="text-sm text-blue-700 hover:underline" to="/deals">
            ← Board
          </Link>
        </div>
      </div>

      <p className="text-sm text-gray-600">
        Account:{' '}
        <Link className="text-blue-700 hover:underline" to={`/accounts/${deal.accountId}`}>
          {deal.accountName}
        </Link>
        {' · '}Expected revenue:{' '}
        <strong>
          {deal.expectedRevenue === null
            ? '—'
            : deal.expectedRevenue.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
        </strong>{' '}
        ({deal.effectiveProbability}%)
        {deal.winLossReason ? ` · Reason: ${deal.winLossReason}` : ''}
      </p>

      <Card title="Stage">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Move to stage">
            <select className={inputClass} value={targetStage} onChange={(e) => setTargetStage(e.target.value)}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isWon ? ' (won)' : s.isLost ? ' (lost)' : ''}
                </option>
              ))}
            </select>
          </Field>
          {needsReason ? (
            <Field label="Loss reason">
              <input className={inputClass} value={lossReason} onChange={(e) => setLossReason(e.target.value)} />
            </Field>
          ) : null}
          <Button onClick={doMove} disabled={move.isPending || targetStage === deal.stageId}>
            Move
          </Button>
        </div>
        <ErrorNote error={move.error} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Details">
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              <Field label="Name">
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Amount">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </Field>
                <Field label="Probability override %">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    max="100"
                    value={form.probability}
                    onChange={(e) => setForm((f) => ({ ...f, probability: e.target.value }))}
                  />
                </Field>
                <Field label="Expected close">
                  <input
                    className={inputClass}
                    type="date"
                    value={form.expectedCloseDate}
                    onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={update.isPending}>
                Save changes
              </Button>
              <ErrorNote error={update.error} />
            </form>
          </Card>

          <Card title="Contacts">
            <ul className="mb-3 space-y-1 text-sm">
              {dealContacts.data?.contacts.map((c) => (
                <li key={c.contactId}>
                  <Link className="text-blue-700 hover:underline" to={`/contacts/${c.contactId}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                  {c.role ? <span className="text-gray-500"> — {c.role}</span> : null}
                  {c.isPrimary ? (
                    <span className="ml-1 rounded bg-blue-100 px-1.5 text-xs text-blue-800">primary</span>
                  ) : null}
                </li>
              ))}
              {dealContacts.data && dealContacts.data.contacts.length === 0 ? (
                <li className="text-gray-500">No contacts linked.</li>
              ) : null}
            </ul>
            <div className="flex items-end gap-2">
              <Field label="Link contact">
                <select className={inputClass} value={contactToAdd} onChange={(e) => setContactToAdd(e.target.value)}>
                  <option value="">— choose —</option>
                  {orgContacts.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                variant="secondary"
                disabled={!contactToAdd || addContact.isPending}
                onClick={() => {
                  addContact.mutate({ contactId: contactToAdd });
                  setContactToAdd('');
                }}
              >
                Link
              </Button>
            </div>
          </Card>

          <CustomFieldsCard
            entityType="deal"
            values={deal.custom}
            onSave={(custom) => update.mutate({ custom })}
            saving={update.isPending}
            error={update.error}
          />

          <Card title="Stage history">
            <ol className="space-y-1 text-sm text-gray-700" data-testid="stage-history">
              {history.data?.history.map((h) => (
                <li key={h.id}>
                  {h.fromStageName ? `${h.fromStageName} → ` : 'Created in '}
                  <strong>{h.toStageName ?? '?'}</strong>
                  <span className="text-xs text-gray-500"> · {new Date(h.changedAt).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <DealInsight dealId={deal.id} />
          <ActivityComposer target={{ kind: 'deal', id: deal.id }} />
          <Timeline kind="deal" id={deal.id} />
        </div>
      </div>
    </div>
  );
}
