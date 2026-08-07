import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callDispositions, type CallDto, type CompleteCallInput } from '@crm/shared';
import { api } from '../api/client.js';
import { Button, Card, ErrorNote, Field, inputClass } from './ui.js';

/** Browser softphone stand-in: click-to-call, then log the outcome on hang-up. */
export function CallCard({ contactId, phone }: { contactId: string; phone: string | null }) {
  const qc = useQueryClient();
  const [activeCall, setActiveCall] = useState<CallDto | null>(null);
  const [form, setForm] = useState({ durationSeconds: '', disposition: 'connected', transcript: '' });

  const start = useMutation({
    mutationFn: () => api<CallDto>('/api/calls', { method: 'POST', body: { contactId } }),
    onSuccess: (call) => {
      setActiveCall(call);
      void qc.invalidateQueries({ queryKey: ['timeline', 'contact', contactId] });
    },
  });

  const complete = useMutation({
    mutationFn: (body: CompleteCallInput) =>
      api(`/api/calls/${activeCall!.activityId}/complete`, { method: 'POST', body }),
    onSuccess: () => {
      setActiveCall(null);
      setForm({ durationSeconds: '', disposition: 'connected', transcript: '' });
      void qc.invalidateQueries({ queryKey: ['timeline', 'contact', contactId] });
      void qc.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  if (!phone) return null;

  return (
    <Card title="Phone">
      {!activeCall ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">{phone}</p>
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            📞 Call
          </Button>
        </div>
      ) : (
        <div className="space-y-2" data-testid="active-call">
          <p className="text-sm font-medium text-emerald-700">Call in progress → {activeCall.to}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Duration (seconds)">
              <input
                className={inputClass}
                type="number"
                min="0"
                value={form.durationSeconds}
                onChange={(e) => setForm((f) => ({ ...f, durationSeconds: e.target.value }))}
              />
            </Field>
            <Field label="Disposition">
              <select
                className={inputClass}
                value={form.disposition}
                onChange={(e) => setForm((f) => ({ ...f, disposition: e.target.value }))}
              >
                {callDispositions.map((d) => (
                  <option key={d} value={d}>
                    {d.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Transcript (optional — triggers AI summary)">
            <textarea
              className={inputClass}
              rows={4}
              value={form.transcript}
              onChange={(e) => setForm((f) => ({ ...f, transcript: e.target.value }))}
            />
          </Field>
          <Button
            onClick={() =>
              complete.mutate({
                durationSeconds: Number(form.durationSeconds || 0),
                disposition: form.disposition as CompleteCallInput['disposition'],
                ...(form.transcript.trim().length >= 10 ? { transcript: form.transcript } : {}),
              })
            }
            disabled={complete.isPending}
          >
            Hang up & log
          </Button>
        </div>
      )}
      <ErrorNote error={start.error ?? complete.error} />
    </Card>
  );
}
