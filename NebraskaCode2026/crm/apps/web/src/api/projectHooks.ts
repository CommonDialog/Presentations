import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GanttDto,
  MilestoneDto,
  Paginated,
  PortalViewDto,
  ProjectBoardDto,
  ProjectCreateInput,
  ProjectDto,
  ProjectUpdateInput,
} from '@crm/shared';
import { api } from './client.js';

export function useProjects(params: { query?: string; status?: string; page?: number }) {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return useQuery({
    queryKey: ['projects', params],
    queryFn: () => api<Paginated<ProjectDto>>(`/api/projects${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => api<ProjectDto>(`/api/projects/${id}`) });
}

function invalidateProject(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['projects'] });
  if (id) {
    qc.invalidateQueries({ queryKey: ['project', id] });
    qc.invalidateQueries({ queryKey: ['project-board', id] });
    qc.invalidateQueries({ queryKey: ['project-gantt', id] });
    qc.invalidateQueries({ queryKey: ['milestones', id] });
    qc.invalidateQueries({ queryKey: ['timeline', 'project', id] });
  }
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectCreateInput) => api<ProjectDto>('/api/projects', { method: 'POST', body }),
    onSuccess: () => invalidateProject(qc),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectUpdateInput) =>
      api<ProjectDto>(`/api/projects/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateProject(qc, id),
  });
}

export function useMilestones(projectId: string) {
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => api<{ milestones: MilestoneDto[] }>(`/api/projects/${projectId}/milestones`),
  });
}

export function useMilestoneMutations(projectId: string) {
  const qc = useQueryClient();
  const invalidate = () => invalidateProject(qc, projectId);
  const create = useMutation({
    mutationFn: (body: { name: string; dueDate?: string }) =>
      api<MilestoneDto>(`/api/projects/${projectId}/milestones`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; name?: string }) =>
      api<MilestoneDto>(`/api/milestones/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/milestones/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useProjectBoard(projectId: string) {
  return useQuery({
    queryKey: ['project-board', projectId],
    queryFn: () => api<ProjectBoardDto>(`/api/projects/${projectId}/board`),
  });
}

export function useProjectGantt(projectId: string) {
  return useQuery({
    queryKey: ['project-gantt', projectId],
    queryFn: () => api<GanttDto>(`/api/projects/${projectId}/gantt`),
  });
}

export function useProjectTaskMutations(projectId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    invalidateProject(qc, projectId);
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const create = useMutation({
    mutationFn: (body: { title: string; projectId: string; milestoneId?: string; dueAt?: string }) =>
      api('/api/tasks', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/tasks/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: invalidate,
  });
  return { create, setStatus };
}

export function usePortal(projectId: string) {
  const qc = useQueryClient();
  const enable = useMutation({
    mutationFn: () => api<{ token: string }>(`/api/projects/${projectId}/portal`, { method: 'POST', body: {} }),
    onSuccess: () => invalidateProject(qc, projectId),
  });
  const disable = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/portal`, { method: 'DELETE' }),
    onSuccess: () => invalidateProject(qc, projectId),
  });
  return { enable, disable };
}

export function usePortalView(token: string) {
  return useQuery({
    queryKey: ['portal', token],
    queryFn: () => api<PortalViewDto>(`/api/portal/${token}`),
    retry: false,
  });
}

export function useCreateProjectFromDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dealId: string) =>
      api<ProjectDto>(`/api/deals/${dealId}/create-project`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
