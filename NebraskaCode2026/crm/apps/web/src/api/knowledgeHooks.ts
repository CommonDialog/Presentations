import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaptureInput, CaptureResultDto, ProposalDto } from '@crm/shared';
import { api } from './client.js';

export function useCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CaptureInput) =>
      api<CaptureResultDto>('/api/capture', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline'] });
      qc.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
}

export function useCaptureResult(activityId: string | null) {
  return useQuery({
    queryKey: ['capture', activityId],
    queryFn: () => api<CaptureResultDto>(`/api/captures/${activityId}`),
    enabled: activityId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'queued' ? 1500 : false),
  });
}

export function useProposals(status?: 'pending' | 'applied' | 'rejected') {
  return useQuery({
    queryKey: ['proposals', status ?? 'all'],
    queryFn: () =>
      api<{ proposals: ProposalDto[] }>(`/api/proposals${status ? `?status=${status}` : ''}`),
  });
}

function useProposalAction(action: 'approve' | 'reject') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<ProposalDto>(`/api/proposals/${id}/${action}`, {
        method: 'POST',
        ...(action === 'reject' ? { body: { reason } } : { body: {} }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] });
      qc.invalidateQueries({ queryKey: ['capture'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
      qc.invalidateQueries({ queryKey: ['account'] });
      qc.invalidateQueries({ queryKey: ['contact'] });
    },
  });
}

export function useApproveProposal() {
  return useProposalAction('approve');
}

export function useRejectProposal() {
  return useProposalAction('reject');
}
