import { useState, type FormEvent } from 'react';
import { activityTypes, type ActivityType } from '@crm/shared';
import { useCreateActivity } from '../api/activityHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from './ui.js';

const typeLabels: Record<ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
};

/** Log an email/call/meeting/note against the record being viewed. */
export function ActivityComposer(props: {
  target: { kind: 'account' | 'contact' | 'deal' | 'lead'; id: string };
}) {
  const create = useCreateActivity();
  const [type, setType] = useState<ActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      type,
      subject,
      ...(body ? { body } : {}),
      links: { [`${props.target.kind}s`]: [props.target.id] },
    });
    setSubject('');
    setBody('');
  };

  return (
    <Card title="Log activity">
      <form onSubmit={(e) => void submit(e)} className="space-y-2">
        <div className="flex gap-2">
          {activityTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                type === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {typeLabels[t]}
            </button>
          ))}
        </div>
        <Field label="Subject">
          <input
            className={inputClass}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            placeholder={`What was this ${typeLabels[type].toLowerCase()} about?`}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className={inputClass}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={create.isPending || !subject.trim()}>
          Log {typeLabels[type].toLowerCase()}
        </Button>
        <ErrorNote error={create.error} />
      </form>
    </Card>
  );
}
