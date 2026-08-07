import type { ProposalDto } from '@crm/shared';
import { useApproveProposal, useRejectProposal } from '../api/knowledgeHooks.js';
import { Button, ErrorNote } from './ui.js';

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  applied: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-gray-200 text-gray-600',
  approved: 'bg-blue-100 text-blue-800',
};

function ProposalDetail({ proposal }: { proposal: ProposalDto }) {
  const p = proposal.payload;
  if (proposal.proposalType === 'update_field') {
    return (
      <p className="text-sm text-gray-600">
        Set <strong>{String(p.field)}</strong> to{' '}
        <span className="font-mono">{String(p.suggestedValue)}</span>
        {p.reason ? <span className="text-gray-500"> — {String(p.reason)}</span> : null}
      </p>
    );
  }
  if (proposal.proposalType === 'create_task') {
    return (
      <p className="text-sm text-gray-600">
        {String(p.description ?? '')}{' '}
        <span className="text-gray-500">
          (due in {String(p.dueInDays)} days, {String(p.priority)})
        </span>
      </p>
    );
  }
  if (proposal.proposalType === 'followup_email') {
    return (
      <div className="text-sm text-gray-600">
        <p className="font-medium">{String(p.subject)}</p>
        <p className="whitespace-pre-wrap text-gray-500">{String(p.body).slice(0, 400)}</p>
      </div>
    );
  }
  return null;
}

export function ProposalCard({ proposal }: { proposal: ProposalDto }) {
  const approve = useApproveProposal();
  const reject = useRejectProposal();
  const pending = proposal.status === 'pending';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm" data-testid="proposal">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">{proposal.title}</p>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyles[proposal.status] ?? ''}`}
        >
          {proposal.status}
        </span>
      </div>
      <ProposalDetail proposal={proposal} />
      {pending ? (
        <div className="mt-2 flex gap-2">
          <Button
            onClick={() => approve.mutate({ id: proposal.id })}
            disabled={approve.isPending || reject.isPending}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            onClick={() => reject.mutate({ id: proposal.id })}
            disabled={approve.isPending || reject.isPending}
          >
            Reject
          </Button>
        </div>
      ) : null}
      <ErrorNote error={approve.error ?? reject.error} />
    </div>
  );
}
