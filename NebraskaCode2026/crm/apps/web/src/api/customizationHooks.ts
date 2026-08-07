import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomFieldCreateInput,
  CustomFieldDto,
  CustomFieldUpdateInput,
  CustomizableEntityType,
  CustomizationBundleDto,
  EntityLayoutDto,
  LayoutUpsertInput,
  RecordTypeCreateInput,
  RecordTypeDto,
  RecordTypeUpdateInput,
} from '@crm/shared';
import { api } from './client.js';

export function useCustomizationBundle(entityType: CustomizableEntityType, recordType?: string) {
  const qs = recordType ? `&recordType=${encodeURIComponent(recordType)}` : '';
  return useQuery({
    queryKey: ['customization-bundle', entityType, recordType ?? null],
    queryFn: () => api<CustomizationBundleDto>(`/api/customization/bundle?entityType=${entityType}${qs}`),
    staleTime: 30_000,
  });
}

export function useCustomFields(entityType: CustomizableEntityType) {
  return useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () =>
      api<{ fields: CustomFieldDto[] }>(
        `/api/customization/fields?entityType=${entityType}&includeInactive=true`,
      ),
  });
}

export function useRecordTypes(entityType: CustomizableEntityType) {
  return useQuery({
    queryKey: ['record-types', entityType],
    queryFn: () =>
      api<{ recordTypes: RecordTypeDto[] }>(`/api/customization/record-types?entityType=${entityType}`),
  });
}

export function useLayouts(entityType: CustomizableEntityType) {
  return useQuery({
    queryKey: ['layouts', entityType],
    queryFn: () => api<{ layouts: EntityLayoutDto[] }>(`/api/customization/layouts?entityType=${entityType}`),
  });
}

export function useCustomizationMutations(entityType: CustomizableEntityType) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['custom-fields', entityType] });
    qc.invalidateQueries({ queryKey: ['record-types', entityType] });
    qc.invalidateQueries({ queryKey: ['layouts', entityType] });
    qc.invalidateQueries({ queryKey: ['customization-bundle', entityType] });
  };
  const createField = useMutation({
    mutationFn: (body: CustomFieldCreateInput) =>
      api<CustomFieldDto>('/api/customization/fields', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const updateField = useMutation({
    mutationFn: ({ id, ...body }: CustomFieldUpdateInput & { id: string }) =>
      api<CustomFieldDto>(`/api/customization/fields/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const removeField = useMutation({
    mutationFn: (id: string) => api(`/api/customization/fields/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const createRecordType = useMutation({
    mutationFn: (body: RecordTypeCreateInput) =>
      api<RecordTypeDto>('/api/customization/record-types', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const updateRecordType = useMutation({
    mutationFn: ({ id, ...body }: RecordTypeUpdateInput & { id: string }) =>
      api<RecordTypeDto>(`/api/customization/record-types/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const removeRecordType = useMutation({
    mutationFn: (id: string) => api(`/api/customization/record-types/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const saveLayout = useMutation({
    mutationFn: (body: LayoutUpsertInput) =>
      api<EntityLayoutDto>('/api/customization/layouts', { method: 'PUT', body }),
    onSuccess: invalidate,
  });
  return {
    createField,
    updateField,
    removeField,
    createRecordType,
    updateRecordType,
    removeRecordType,
    saveLayout,
  };
}
