import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountCreateInput,
  AccountDto,
  AccountUpdateInput,
  ContactCreateInput,
  ContactDto,
  ContactUpdateInput,
  MeResponse,
  Paginated,
  TimelineEntryDto,
} from '@crm/shared';
import { api, ApiError } from './client.js';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await api<MeResponse>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api('/api/auth/login', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { organizationName: string; name: string; email: string; password: string }) =>
      api('/api/auth/register', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export interface AccountListParams {
  query?: string;
  industry?: string;
  page?: number;
  sort?: string;
  order?: string;
}

export function useAccounts(params: AccountListParams) {
  return useQuery({
    queryKey: ['accounts', params],
    queryFn: () => api<Paginated<AccountDto>>(`/api/accounts${toQueryString({ ...params })}`),
    placeholderData: (prev) => prev,
  });
}

export function useAccount(id: string) {
  return useQuery({
    queryKey: ['account', id],
    queryFn: () => api<AccountDto>(`/api/accounts/${id}`),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AccountCreateInput) =>
      api<AccountDto>('/api/accounts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AccountUpdateInput) =>
      api<AccountDto>(`/api/accounts/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account', id] });
      qc.invalidateQueries({ queryKey: ['timeline', 'account', id] });
    },
  });
}

export function useArchiveAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restore: boolean) =>
      api(`/api/accounts/${id}${restore ? '/restore' : ''}`, {
        method: restore ? 'POST' : 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account', id] });
      qc.invalidateQueries({ queryKey: ['timeline', 'account', id] });
    },
  });
}

export interface ContactListParams {
  query?: string;
  accountId?: string;
  page?: number;
}

export function useContacts(params: ContactListParams) {
  return useQuery({
    queryKey: ['contacts', params],
    queryFn: () => api<Paginated<ContactDto>>(`/api/contacts${toQueryString({ ...params })}`),
    placeholderData: (prev) => prev,
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<ContactDto>(`/api/contacts/${id}`),
  });
}

export interface ContactWriteResult {
  contact: ContactDto;
  warnings: string[];
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContactCreateInput) =>
      api<ContactWriteResult>('/api/contacts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContactUpdateInput) =>
      api<ContactWriteResult>(`/api/contacts/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', id] });
      qc.invalidateQueries({ queryKey: ['timeline', 'contact', id] });
    },
  });
}

export function useArchiveContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restore: boolean) =>
      api(`/api/contacts/${id}${restore ? '/restore' : ''}`, {
        method: restore ? 'POST' : 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact', id] });
      qc.invalidateQueries({ queryKey: ['timeline', 'contact', id] });
    },
  });
}

export function useTimeline(
  kind: 'account' | 'contact' | 'deal' | 'lead' | 'project',
  id: string,
  page: number,
) {
  return useQuery({
    queryKey: ['timeline', kind, id, page],
    queryFn: () =>
      api<Paginated<TimelineEntryDto>>(`/api/${kind}s/${id}/timeline?page=${page}&pageSize=20`),
    placeholderData: (prev) => prev,
  });
}
