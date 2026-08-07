import { useState, type FormEvent } from 'react';
import { captureSourceTypes, type CaptureSourceType } from '@crm/shared';
import { useAccounts, useContacts } from '../api/hooks.js';
import { useBoard } from '../api/pipelineHooks.js';
import { useCapture, useCaptureResult } from '../api/knowledgeHooks.js';
import { ProposalCard } from '../components/ProposalCard.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

const sourceLabels: Record<CaptureSourceType, string> = {
  email: 'Email',
  meeting_transcript: 'Meeting transcript',
  call_transcript: 'Call transcript',
};

export function CapturePage() {
  const capture = useCapture();
  const [activityId, setActivityId] = useState<string | null>(null);
  const { data: result } = useCaptureResult(activityId);

  const accounts = useAccounts({ page: 1 });
  const [form, setForm] = useState({
    sourceType: 'email' as CaptureSourceType,
    subject: '',
    content: '',
    accountId: '',
    contactId: '',
    dealId: '',
  });
  const contacts = useContacts(form.accountId ? { accountId: form.accountId } : {});
  const board = useBoard();
  const dealsForAccount =
    board.data?.columns.flatMap((c) => c.deals).filter((d) => !form.accountId || d.accountId === form.accountId) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await capture.mutateAsync({
      sourceType: form.sourceType,
      ...(form.subject ? { subject: form.subject } : {}),
      content: form.content,
      ...(form.accountId ? { accountId: form.accountId } : {}),
      ...(form.contactId ? { contactId: form.contactId } : {}),
      ...(form.dealId ? { dealId: form.dealId } : {}),
    });
    setActivityId(res.activityId);
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Knowledge capture</h1>
      <p className="text-sm text-gray-600">
        Paste an email or transcript. The interaction is logged to the timeline, and the AI
        proposes updates for your review — nothing changes without approval.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Source">
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div className="flex gap-2">
              {captureSourceTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, sourceType: t }))}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    form.sourceType === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {sourceLabels[t]}
                </button>
              ))}
            </div>
            <Field label="Subject">
              <input className={inputClass} value={form.subject} onChange={set('subject')} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Account">
                <select className={inputClass} value={form.accountId} onChange={set('accountId')}>
                  <option value="">—</option>
                  {accounts.data?.items.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Contact">
                <select className={inputClass} value={form.contactId} onChange={set('contactId')}>
                  <option value="">—</option>
                  {contacts.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Deal">
                <select className={inputClass} value={form.dealId} onChange={set('dealId')}>
                  <option value="">—</option>
                  {dealsForAccount.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Content">
              <textarea
                className={inputClass}
                rows={10}
                value={form.content}
                onChange={set('content')}
                required
                minLength={10}
                placeholder="Paste the email body or transcript here…"
              />
            </Field>
            <Button type="submit" disabled={capture.isPending}>
              {capture.isPending ? 'Analyzing…' : 'Capture & analyze'}
            </Button>
            <ErrorNote error={capture.error} />
          </form>
        </Card>

        <div className="space-y-4">
          {result?.status === 'queued' ? (
            <Card title="Analysis">
              <p className="text-sm text-gray-500">Analyzing in the background…</p>
            </Card>
          ) : null}
          {result?.status === 'analyzed' ? (
            <>
              <Card title="Summary">
                <p className="text-sm text-gray-800" data-testid="capture-summary">
                  {result.summary}
                </p>
                {result.sentiment ? (
                  <p className="mt-1 text-xs text-gray-500">Sentiment: {result.sentiment}</p>
                ) : null}
                {result.actionItems && result.actionItems.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc text-sm text-gray-700">
                    {result.actionItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </Card>
              <div className="space-y-2" data-testid="capture-proposals">
                <h2 className="text-sm font-semibold text-gray-700">
                  Proposed changes ({result.proposals?.length ?? 0})
                </h2>
                {result.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} />)}
                {result.proposals?.length === 0 ? (
                  <p className="text-sm text-gray-500">No changes proposed.</p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
