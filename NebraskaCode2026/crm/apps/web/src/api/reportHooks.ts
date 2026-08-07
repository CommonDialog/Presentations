import { useQuery } from '@tanstack/react-query';
import type {
  ActivityReportDto,
  CustomerHealthReportDto,
  ProjectHealthReportDto,
  RevenueReportDto,
  SalesReportDto,
  StalledReportDto,
  VelocityReportDto,
} from '@crm/shared';
import { api } from './client.js';

export function useSalesReport(days: number) {
  return useQuery({
    queryKey: ['report-sales', days],
    queryFn: () => api<SalesReportDto>(`/api/reports/sales?days=${days}`),
    placeholderData: (prev) => prev,
  });
}

export function useVelocityReport(days: number) {
  return useQuery({
    queryKey: ['report-velocity', days],
    queryFn: () => api<VelocityReportDto>(`/api/reports/velocity?days=${days}`),
    placeholderData: (prev) => prev,
  });
}

export function useStalledReport(idleDays: number) {
  return useQuery({
    queryKey: ['report-stalled', idleDays],
    queryFn: () => api<StalledReportDto>(`/api/reports/stalled?idleDays=${idleDays}`),
    placeholderData: (prev) => prev,
  });
}

export function useRevenueReport(months: number) {
  return useQuery({
    queryKey: ['report-revenue', months],
    queryFn: () => api<RevenueReportDto>(`/api/reports/revenue?months=${months}`),
    placeholderData: (prev) => prev,
  });
}

export function useActivityReport(days: number) {
  return useQuery({
    queryKey: ['report-activity', days],
    queryFn: () => api<ActivityReportDto>(`/api/reports/activity?days=${days}`),
    placeholderData: (prev) => prev,
  });
}

export function useProjectHealthReport() {
  return useQuery({
    queryKey: ['report-projects'],
    queryFn: () => api<ProjectHealthReportDto>('/api/reports/projects'),
  });
}

export function useCustomerHealthReport() {
  return useQuery({
    queryKey: ['report-customers'],
    queryFn: () => api<CustomerHealthReportDto>('/api/reports/customers'),
  });
}
