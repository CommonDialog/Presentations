import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { CreateEventInput, MeetingPrepDto, UpcomingMeetingDto } from '@crm/shared';
import { api } from '../api/client.js';
import { useAccounts } from '../api/hooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

function useUpcoming() {
  return useQuery({
    queryKey: ['meetings', 'upcoming'],
    queryFn: () => api<{ meetings: UpcomingMeetingDto[] }>('/api/calendar/upcoming'),
  });
}

function MeetingRow({ meeting }: { meeting: UpcomingMeetingDto }) {
  const [prep, setPrep] = useState<MeetingPrepDto | null>(null);
  const prepare = useMutation({
    mutationFn: () =>
      api<MeetingPrepDto>(`/api/meetings/${meeting.activityId}/prepare`, { method: 'POST', body: {} }),
    onSuccess: (result) => setPrep(result),
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm" data-testid="meeting">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">{meeting.title}</p>
          <p className="text-xs text-gray-500">
            {new Date(meeting.startsAt).toLocaleString()} –{' '}
            {new Date(meeting.endsAt).toLocaleTimeString()}
            {meeting.location ? ` · ${meeting.location}` : ''} · {meeting.attendees.length}{' '}
            attendee(s)
            {meeting.accountIds[0] ? (
              <>
                {' · '}
                <Link className="text-blue-700 hover:underline" to={`/accounts/${meeting.accountIds[0]}`}>
                  account
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <Button variant="secondary" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
          {prepare.isPending ? 'Preparing…' : 'Prepare'}
        </Button>
      </div>
      <ErrorNote error={prepare.error} />
      {prep ? (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2 text-sm" data-testid="meeting-prep">
          <PrepList title="Objectives" items={prep.prep.objectives} />
          <PrepList title="Talking points" items={prep.prep.talkingPoints} />
          <PrepList title="Open questions" items={prep.prep.openQuestions} />
          <PrepList title="Risks" items={prep.prep.risks} />
          {prep.prep.attendeeNotes.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500">Attendees</p>
              <ul className="list-inside list-disc text-gray-700">
                {prep.prep.attendeeNotes.map((n) => (
                  <li key={n.name}>
                    <strong>{n.name}</strong>: {n.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PrepList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-gray-500">{title}</p>
      <ul className="list-inside list-disc text-gray-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function MeetingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useUpcoming();
  const accounts = useAccounts({ page: 1 });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '',
    startsAt: '',
    endsAt: '',
    attendees: '',
    accountId: '',
  });

  const create = useMutation({
    mutationFn: (body: CreateEventInput) =>
      api('/api/calendar/events/create', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
      setShowCreate(false);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      title: form.title,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      attendeeEmails: form.attendees
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      ...(form.accountId ? { accountId: form.accountId } : {}),
    });
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Meetings</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New meeting'}</Button>
      </div>

      {showCreate ? (
        <Card title="Schedule a meeting">
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Title">
                <input className={inputClass} value={form.title} onChange={set('title')} required />
              </Field>
            </div>
            <Field label="Starts">
              <input
                className={inputClass}
                type="datetime-local"
                value={form.startsAt}
                onChange={set('startsAt')}
                required
              />
            </Field>
            <Field label="Ends">
              <input
                className={inputClass}
                type="datetime-local"
                value={form.endsAt}
                onChange={set('endsAt')}
                required
              />
            </Field>
            <Field label="Attendee emails (comma-separated)">
              <input className={inputClass} value={form.attendees} onChange={set('attendees')} required />
            </Field>
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
            <div className="col-span-2">
              <Button type="submit" disabled={create.isPending}>
                Create meeting
              </Button>
              <ErrorNote error={create.error} />
            </div>
          </form>
        </Card>
      ) : null}

      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      <div className="space-y-2">
        {data?.meetings.map((m) => <MeetingRow key={m.activityId} meeting={m} />)}
        {data && data.meetings.length === 0 ? (
          <p className="text-sm text-gray-500">No upcoming meetings.</p>
        ) : null}
      </div>
    </div>
  );
}
