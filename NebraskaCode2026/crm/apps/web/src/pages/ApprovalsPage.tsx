import { useState } from 'react';
import { useProposals } from '../api/knowledgeHooks.js';
import { ProposalCard } from '../components/ProposalCard.js';

export function ApprovalsPage() {
  const [status, setStatus] = useState<'pending' | 'applied' | 'rejected'>('pending');
  const { data, isLoading } = useProposals(status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">AI approvals</h1>
        <div className="flex gap-1">
          {(['pending', 'applied', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                status === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-600">
        The AI never changes records directly — every suggestion waits here for a human decision.
      </p>
      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      <div className="space-y-2">
        {data?.proposals.map((p) => <ProposalCard key={p.id} proposal={p} />)}
        {data && data.proposals.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="approvals-empty">
            Nothing {status} right now.
          </p>
        ) : null}
      </div>
    </div>
  );
}
