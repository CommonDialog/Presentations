import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountEnrichmentDto,
  ApiKeyDto,
  ChatIntegrationKind,
  ContactEnrichmentDto,
  ImportEntityType,
  ImportResultDto,
  IntegrationDto,
  IntegrationUpsertInput,
  WebhookCreateInput,
  WebhookDeliveryDto,
  WebhookDto,
  WebhookUpdateInput,
} from '@crm/shared';
import { api } from './client.js';

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () =>
      api<{ integrations: IntegrationDto[]; enrichmentProvider: string }>('/api/integrations'),
  });
}

export function useIntegrationMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const save = useMutation({
    mutationFn: (body: IntegrationUpsertInput) =>
      api<IntegrationDto>('/api/integrations', { method: 'PUT', body }),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (kind: ChatIntegrationKind) =>
      api<{ posted: boolean; note?: string }>(`/api/integrations/${kind}/test`, {
        method: 'POST',
        body: {},
      }),
  });
  return { save, test };
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<{ keys: ApiKeyDto[] }>('/api/integrations/api-keys'),
  });
}

export function useApiKeyMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: (name: string) =>
      api<{ key: ApiKeyDto; token: string }>('/api/integrations/api-keys', {
        method: 'POST',
        body: { name },
      }),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/integrations/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return { create, revoke };
}

export function useWebhooks() {
  return useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api<{ webhooks: WebhookDto[] }>('/api/integrations/webhooks'),
  });
}

export function useWebhookDeliveries(webhookId: string | null) {
  return useQuery({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: () =>
      api<{ deliveries: WebhookDeliveryDto[] }>(`/api/integrations/webhooks/${webhookId}/deliveries`),
    enabled: webhookId !== null,
  });
}

export function useWebhookMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: (body: WebhookCreateInput) =>
      api<WebhookDto>('/api/integrations/webhooks', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: WebhookUpdateInput & { id: string }) =>
      api<WebhookDto>(`/api/integrations/webhooks/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/integrations/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityType, csv }: { entityType: ImportEntityType; csv: string }) =>
      api<ImportResultDto>(`/api/import/${entityType}`, { method: 'POST', body: { csv } }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useEnrichAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<AccountEnrichmentDto>(`/api/enrich/accounts/${id}`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account', id] }),
  });
}

export function useEnrichContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<ContactEnrichmentDto>(`/api/enrich/contacts/${id}`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contact', id] }),
  });
}
