import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardDto,
  DealContactDto,
  DealCreateInput,
  DealDto,
  DealMoveInput,
  DealUpdateInput,
  ForecastDto,
  LeadConvertInput,
  LeadConvertResult,
  LeadCreateInput,
  LeadDto,
  LeadStatus,
  LeadUpdateInput,
  Paginated,
  PipelineDto,
  StageHistoryDto,
} from '@crm/shared';
import { api } from './client.js';

export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: () => api<{ pipelines: PipelineDto[] }>('/api/pipelines'),
    staleTime: 5 * 60_000,
  });
}

// ---------- leads ----------

export function useLeads(params: { query?: string; status?: string; page?: number }) {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return useQuery({
    queryKey: ['leads', params],
    queryFn: () => api<Paginated<LeadDto>>(`/api/leads${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function useLead(id: string) {
  return useQuery({ queryKey: ['lead', id], queryFn: () => api<LeadDto>(`/api/leads/${id}`) });
}

function invalidateLead(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['leads'] });
  if (id) {
    qc.invalidateQueries({ queryKey: ['lead', id] });
    qc.invalidateQueries({ queryKey: ['timeline', 'lead', id] });
  }
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadCreateInput) => api<LeadDto>('/api/leads', { method: 'POST', body }),
    onSuccess: () => invalidateLead(qc),
  });
}

export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadUpdateInput) => api<LeadDto>(`/api/leads/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useLeadStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: LeadStatus) =>
      api<LeadDto>(`/api/leads/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadConvertInput) =>
      api<LeadConvertResult>(`/api/leads/${id}/convert`, { method: 'POST', body }),
    onSuccess: () => {
      invalidateLead(qc, id);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
}

// ---------- deals ----------

export function useBoard(pipelineId?: string) {
  return useQuery({
    queryKey: ['board', pipelineId ?? 'default'],
    queryFn: () =>
      api<BoardDto>(`/api/deals/board${pipelineId ? `?pipelineId=${pipelineId}` : ''}`),
  });
}

export function useForecast(pipelineId?: string) {
  return useQuery({
    queryKey: ['forecast', pipelineId ?? 'default'],
    queryFn: () =>
      api<ForecastDto>(`/api/deals/forecast${pipelineId ? `?pipelineId=${pipelineId}` : ''}`),
  });
}

export function useDeal(id: string) {
  return useQuery({ queryKey: ['deal', id], queryFn: () => api<DealDto>(`/api/deals/${id}`) });
}

export function useDealHistory(id: string) {
  return useQuery({
    queryKey: ['deal', id, 'history'],
    queryFn: () => api<{ history: StageHistoryDto[] }>(`/api/deals/${id}/history`),
  });
}

export function useDealContacts(id: string) {
  return useQuery({
    queryKey: ['deal', id, 'contacts'],
    queryFn: () => api<{ contacts: DealContactDto[] }>(`/api/deals/${id}/contacts`),
  });
}

function invalidateDeal(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['board'] });
  qc.invalidateQueries({ queryKey: ['forecast'] });
  if (id) {
    qc.invalidateQueries({ queryKey: ['deal', id] });
    qc.invalidateQueries({ queryKey: ['timeline', 'deal', id] });
  }
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DealCreateInput) => api<DealDto>('/api/deals', { method: 'POST', body }),
    onSuccess: () => invalidateDeal(qc),
  });
}

export function useUpdateDeal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DealUpdateInput) => api<DealDto>(`/api/deals/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateDeal(qc, id),
  });
}

export function useMoveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DealMoveInput & { id: string }) =>
      api<DealDto>(`/api/deals/${id}/move`, { method: 'POST', body }),
    onSuccess: (_data, vars) => invalidateDeal(qc, vars.id),
  });
}

export function useAddDealContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { contactId: string; role?: string; isPrimary?: boolean }) =>
      api(`/api/deals/${id}/contacts`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deal', id, 'contacts'] }),
  });
}
