import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SendEmailInput } from '@crm/shared';
import { api } from '../api/client.js';
import { Button, Card, ErrorNote, Field, inputClass } from './ui.js';

export function EmailComposer(props: { contactId: string; email: string }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sentNote, setSentNote] = useState(false);

  const send = useMutation({
    mutationFn: (input: SendEmailInput) => api('/api/email/send', { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline'] });
      setSubject('');
      setBody('');
      setSentNote(true);
      setTimeout(() => setSentNote(false), 4000);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate({ to: [props.email], subject, body, contactId: props.contactId });
  };

  return (
    <Card title={`Email ${props.email}`}>
      <form onSubmit={submit} className="space-y-2">
        <Field label="Subject">
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </Field>
        <Field label="Message">
          <textarea className={inputClass} rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={send.isPending}>
          Send email
        </Button>
        {sentNote ? <span className="ml-2 text-sm text-emerald-700">Sent ✓</span> : null}
        <ErrorNote error={send.error} />
      </form>
    </Card>
  );
}
