import { useState } from 'react';
import { useTimeline } from '../api/hooks.js';
import { Card, Pager } from './ui.js';

const typeLabels: Record<string, string> = {
  'account.created': 'Account created',
  'account.updated': 'Account updated',
  'account.archived': 'Account archived',
  'account.restored': 'Account restored',
  'contact.created': 'Contact created',
  'contact.updated': 'Contact updated',
  'contact.archived': 'Contact archived',
  'contact.restored': 'Contact restored',
  'lead.created': 'Lead created',
  'lead.updated': 'Lead updated',
  'lead.status_changed': 'Lead status',
  'lead.converted': 'Lead converted',
  'deal.created': 'Deal created',
  'deal.updated': 'Deal updated',
  'deal.stage_changed': 'Stage change',
  'deal.won': 'Deal won',
  'deal.lost': 'Deal lost',
  'deal.reopened': 'Deal reopened',
  'deal.contact_linked': 'Contact linked',
  'activity.email': 'Email',
  'activity.call': 'Call',
  'activity.meeting': 'Meeting',
  'activity.note': 'Note',
  'task.created': 'Task created',
  'task.completed': 'Task completed',
  'ai.summary': 'AI summary',
  'ai.insight': 'AI insight',
  'ai.meeting_prep': 'Meeting prep',
  'project.created': 'Project created',
  'project.updated': 'Project updated',
  'project.status_changed': 'Project status',
  'project.completed': 'Project completed',
  'project.milestone_completed': 'Milestone completed',
};

const typeIcons: Record<string, string> = {
  'activity.email': '✉️',
  'activity.call': '📞',
  'activity.meeting': '📅',
  'activity.note': '📝',
  'task.created': '☐',
  'task.completed': '☑',
  'deal.won': '🏆',
  'deal.lost': '✗',
  'ai.summary': '🤖',
  'ai.insight': '📊',
};

export function Timeline(props: {
  kind: 'account' | 'contact' | 'deal' | 'lead' | 'project';
  id: string;
}) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTimeline(props.kind, props.id, page);

  return (
    <Card title="Timeline">
      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {data && data.items.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing here yet.</p>
      ) : null}
      <ol className="space-y-3" data-testid="timeline">
        {data?.items.map((entry) => (
          <li key={entry.id} className="border-l-2 border-blue-200 pl-3">
            <p className="text-sm text-gray-800">
              {typeIcons[entry.entryType] ? `${typeIcons[entry.entryType]} ` : ''}
              {entry.summary}
            </p>
            <p className="text-xs text-gray-500">
              {typeLabels[entry.entryType] ?? entry.entryType} ·{' '}
              {new Date(entry.occurredAt).toLocaleString()}
            </p>
          </li>
        ))}
      </ol>
      {data && data.total > data.pageSize ? (
        <Pager data={data} page={page} onPage={setPage} />
      ) : null}
    </Card>
  );
}
