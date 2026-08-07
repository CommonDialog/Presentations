import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealInsightDto } from '@crm/shared';
import { api } from '../api/client.js';
import { Button, Card, ErrorNote } from './ui.js';

function useDealInsight(dealId: string, polling: boolean) {
  return useQuery({
    queryKey: ['insight', dealId],
    queryFn: () => api<{ insight: DealInsightDto | null }>(`/api/deals/${dealId}/insight`),
    refetchInterval: polling ? 2000 : false,
  });
}

const healthStyles: Record<string, string> = {
  healthy: 'bg-emerald-100 text-emerald-800',
  at_risk: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-800',
};

const severityStyles: Record<string, string> = {
  low: 'text-gray-600',
  medium: 'text-amber-700',
  high: 'text-red-700 font-medium',
};

function PillarRow({ label, pillar }: { label: string; pillar: { present: boolean; assessment: string } }) {
  return (
    <li className="flex gap-1 text-xs" title={pillar.assessment}>
      <span>{pillar.present ? '✅' : '⬜'}</span>
      <span className={pillar.present ? 'text-gray-800' : 'text-gray-400'}>{label}</span>
    </li>
  );
}

export function DealInsight({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);
  const { data } = useDealInsight(dealId, analyzing);
  const lastSeen = useRef<string | null>(null);

  const analyze = useMutation({
    mutationFn: () => api<unknown>(`/api/deals/${dealId}/analyze`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setAnalyzing(true);
      void qc.invalidateQueries({ queryKey: ['insight', dealId] });
    },
  });

  const insight = data?.insight ?? null;

  useEffect(() => {
    if (insight && analyzing && insight.createdAt !== lastSeen.current) {
      setAnalyzing(false);
      void qc.invalidateQueries({ queryKey: ['proposals'] });
      void qc.invalidateQueries({ queryKey: ['timeline', 'deal', dealId] });
    }
    if (insight) lastSeen.current = insight.createdAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insight?.createdAt]);

  return (
    <Card title="AI insight">
      <div className="mb-2 flex items-center justify-between">
        {insight ? (
          <span
            data-testid="insight-health"
            className={`rounded px-2 py-0.5 text-xs font-medium ${healthStyles[insight.analysis.health] ?? ''}`}
          >
            {insight.analysis.health.replace('_', ' ')} · {insight.analysis.confidence}%
          </span>
        ) : (
          <span className="text-sm text-gray-500">Not analyzed yet.</span>
        )}
        <Button variant="secondary" onClick={() => analyze.mutate()} disabled={analyze.isPending || analyzing}>
          {analyzing || analyze.isPending ? 'Analyzing…' : 'Analyze deal'}
        </Button>
      </div>
      <ErrorNote error={analyze.error} />

      {insight ? (
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">{insight.analysis.reasoning}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">MEDDIC</p>
              <ul className="space-y-0.5">
                <PillarRow label="Metrics" pillar={insight.analysis.meddic.metrics} />
                <PillarRow label="Economic buyer" pillar={insight.analysis.meddic.economicBuyer} />
                <PillarRow label="Decision criteria" pillar={insight.analysis.meddic.decisionCriteria} />
                <PillarRow label="Decision process" pillar={insight.analysis.meddic.decisionProcess} />
                <PillarRow label="Identified pain" pillar={insight.analysis.meddic.identifyPain} />
                <PillarRow label="Champion" pillar={insight.analysis.meddic.champion} />
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">BANT</p>
              <ul className="space-y-0.5">
                <PillarRow label="Budget" pillar={insight.analysis.bant.budget} />
                <PillarRow label="Authority" pillar={insight.analysis.bant.authority} />
                <PillarRow label="Need" pillar={insight.analysis.bant.need} />
                <PillarRow label="Timeline" pillar={insight.analysis.bant.timeline} />
              </ul>
            </div>
          </div>

          {insight.analysis.buyingSignals.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500">Buying signals</p>
              <ul className="list-inside list-disc text-gray-700">
                {insight.analysis.buyingSignals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {insight.analysis.risks.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500">Risks</p>
              <ul className="list-inside list-disc">
                {insight.analysis.risks.map((r) => (
                  <li key={r.description} className={severityStyles[r.severity]}>
                    {r.description}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            {insight.analysis.competitors.length > 0 ? (
              <span>
                <strong>Competitors:</strong> {insight.analysis.competitors.join(', ')}
              </span>
            ) : null}
            {insight.analysis.decisionMakers.length > 0 ? (
              <span>
                <strong>Decision makers:</strong>{' '}
                {insight.analysis.decisionMakers
                  .map((d) => `${d.name} (${d.role}${d.isChampion ? ', champion' : ''})`)
                  .join(', ')}
              </span>
            ) : null}
          </div>

          {insight.analysis.nextActions.length > 0 ? (
            <p className="text-xs text-gray-500">
              {insight.analysis.nextActions.length} suggested next action(s) sent to{' '}
              <a className="text-blue-700 hover:underline" href="/approvals">
                Approvals
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
