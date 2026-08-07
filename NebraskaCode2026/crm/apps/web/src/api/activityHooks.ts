import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityCreateInput,
  ActivityDto,
  Paginated,
  TaskCreateInput,
  TaskDto,
  TaskUpdateInput,
  TimelineEntryDto,
} from '@crm/shared';
import { api } from './client.js';

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ActivityCreateInput) =>
      api<ActivityDto>('/api/activities', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline'] }),
  });
}

export interface TaskListParams {
  open?: boolean;
  assigneeId?: string;
  accountId?: string;
  dealId?: string;
  page?: number;
}

export function useTasks(params: TaskListParams) {
  const search = new URLSearchParams();
  if (params.open) search.set('open', 'true');
  if (params.assigneeId) search.set('assigneeId', params.assigneeId);
  if (params.accountId) search.set('accountId', params.accountId);
  if (params.dealId) search.set('dealId', params.dealId);
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api<Paginated<TaskDto>>(`/api/tasks${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskCreateInput) => api<TaskDto>('/api/tasks', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: TaskUpdateInput & { id: string }) =>
      api<TaskDto>(`/api/tasks/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
    },
  });
}

export function useOrgTimeline(page: number) {
  return useQuery({
    queryKey: ['timeline', 'org', page],
    queryFn: () => api<Paginated<TimelineEntryDto>>(`/api/timeline?page=${page}&pageSize=25`),
    placeholderData: (prev) => prev,
  });
}
