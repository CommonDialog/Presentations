import { useMutation, useQuery } from '@tanstack/react-query';
import type { NlSearchResponseDto, SearchResponseDto } from '@crm/shared';
import { api } from './client.js';

export function useGlobalSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchResponseDto>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useAskSearch() {
  return useMutation({
    mutationFn: (query: string) =>
      api<NlSearchResponseDto>('/api/search/ask', { method: 'POST', body: { query } }),
  });
}
