import { z } from 'zod';

// Reports are computed live from CRM data at request time — nothing is
// materialized. Every endpoint takes its window/thresholds as query params.

export const reportPeriodSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  pipelineId: z.uuid().optional(),
});
export type ReportPeriodQuery = z.infer<typeof reportPeriodSchema>;

export const stalledQuerySchema = z.object({
  idleDays: z.coerce.number().int().min(1).max(365).default(14),
});
export type StalledQuery = z.infer<typeof stalledQuerySchema>;

export const revenueQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});
export type RevenueQuery = z.infer<typeof revenueQuerySchema>;

export interface SalesReportDto {
  periodDays: number;
  newDeals: { count: number; amount: number };
  won: { count: number; amount: number };
  lost: { count: number; amount: number };
  /** Percentage of deals closed in the period that were won; null when nothing closed. */
  winRate: number | null;
  avgWonDealSize: number | null;
  /** Average created→closed days for deals won in the period. */
  avgCycleDays: number | null;
  openPipeline: { count: number; amount: number; weighted: number };
  byOwner: {
    ownerId: string | null;
    ownerName: string;
    openCount: number;
    openAmount: number;
    wonCount: number;
    wonAmount: number;
  }[];
}

export interface VelocityStageRow {
  stageId: string;
  stageName: string;
  displayOrder: number;
  /** Average days deals spent in this stage (completed stays only). */
  avgDaysInStage: number | null;
  dealsEntered: number;
}

export interface VelocityReportDto {
  periodDays: number;
  stages: VelocityStageRow[];
  avgWonCycleDays: number | null;
  avgLostCycleDays: number | null;
}

export interface StalledDealDto {
  id: string;
  name: string;
  accountName: string;
  stageName: string;
  amount: number | null;
  ownerName: string | null;
  /** Days since the last stage move or logged activity, whichever is newer. */
  idleDays: number;
  lastMovedAt: string | null;
  lastActivityAt: string | null;
}

export interface StalledReportDto {
  idleDays: number;
  deals: StalledDealDto[];
  totalAmount: number;
}

export interface RevenueMonthRow {
  /** First day of the month, ISO date. */
  month: string;
  count: number;
  amount: number;
}

export interface RevenueReportDto {
  months: number;
  /** Won revenue by close month, oldest first. */
  actual: RevenueMonthRow[];
  /** Open-deal revenue by expected close month, weighted by probability. */
  projected: (RevenueMonthRow & { weighted: number })[];
}

export interface ActivityReportDto {
  periodDays: number;
  byType: { type: string; count: number }[];
  byUser: {
    userId: string;
    userName: string;
    activities: number;
    tasksCompleted: number;
  }[];
  tasks: { completedInPeriod: number; open: number; overdue: number };
}

export const projectHealthLevels = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealthLevel = (typeof projectHealthLevels)[number];

export interface ProjectHealthRow {
  id: string;
  name: string;
  accountName: string;
  status: string;
  health: ProjectHealthLevel;
  /** Why the project got its rating, e.g. "past due", "2 overdue tasks". */
  reasons: string[];
  dueDate: string | null;
  daysToDue: number | null;
  milestonesTotal: number;
  milestonesCompleted: number;
  openTasks: number;
  overdueTasks: number;
}

export interface ProjectHealthReportDto {
  projects: ProjectHealthRow[];
  summary: Record<ProjectHealthLevel, number>;
}

export const customerHealthLevels = ['healthy', 'watch', 'at_risk'] as const;
export type CustomerHealthLevel = (typeof customerHealthLevels)[number];

export interface CustomerHealthRow {
  accountId: string;
  name: string;
  health: CustomerHealthLevel;
  reasons: string[];
  openDeals: number;
  openAmount: number;
  wonRevenue: number;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  activeProjects: number;
  overdueTasks: number;
}

export interface CustomerHealthReportDto {
  accounts: CustomerHealthRow[];
  summary: Record<CustomerHealthLevel, number>;
}
