import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationDto,
  WorkflowCreateInput,
  WorkflowDto,
  WorkflowRunDto,
  WorkflowTemplateDto,
  WorkflowUpdateInput,
} from '@crm/shared';
import { api } from './client.js';

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => api<{ workflows: WorkflowDto[] }>('/api/workflows'),
  });
}

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: ['workflow-templates'],
    queryFn: () => api<{ templates: WorkflowTemplateDto[] }>('/api/workflows/templates'),
    staleTime: Infinity,
  });
}

export function useWorkflowRuns(workflowId: string | null) {
  return useQuery({
    queryKey: ['workflow-runs', workflowId],
    queryFn: () => api<{ runs: WorkflowRunDto[] }>(`/api/workflows/${workflowId}/runs`),
    enabled: workflowId !== null,
  });
}

export function useWorkflowMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['workflows'] });
  const create = useMutation({
    mutationFn: (body: WorkflowCreateInput) =>
      api<WorkflowDto>('/api/workflows', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: WorkflowUpdateInput & { id: string }) =>
      api<WorkflowDto>(`/api/workflows/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: NotificationDto[]; unread: number }>('/api/notifications'),
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
