import { z } from 'zod';
import { milestoneStatuses, projectStatuses, taskStatuses } from './domain.js';
import { paginationSchema } from './crm.js';
import type { TaskDto } from './activities.js';

// ---------- projects ----------

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: z.uuid(),
  description: z.string().max(5000).optional(),
  startDate: z.iso.date().optional(),
  dueDate: z.iso.date().optional(),
  ownerId: z.uuid().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    startDate: z.iso.date().nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    status: z.enum(projectStatuses).optional(),
    /** Completing with open milestones requires an explicit waiver. */
    waiveMilestones: z.boolean().optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

export const projectQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  status: z.enum(projectStatuses).optional(),
  accountId: z.uuid().optional(),
});
export type ProjectQuery = z.infer<typeof projectQuerySchema>;

export interface ProjectDto {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  description: string | null;
  status: (typeof projectStatuses)[number];
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  ownerId: string | null;
  portalEnabled: boolean;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ---------- milestones ----------

export const milestoneCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dueDate: z.iso.date().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const milestoneUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    dueDate: z.iso.date().nullable().optional(),
    displayOrder: z.number().int().min(0).optional(),
    status: z.enum(milestoneStatuses).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export interface MilestoneDto {
  id: string;
  projectId: string;
  name: string;
  dueDate: string | null;
  status: (typeof milestoneStatuses)[number];
  displayOrder: number;
}

// ---------- dependencies / board / gantt ----------

export const dependencySchema = z.object({ dependsOnTaskId: z.uuid() });

export interface ProjectTaskDto extends TaskDto {
  dependsOn: string[];
  blocked: boolean;
  milestoneName: string | null;
}

export interface ProjectBoardDto {
  project: ProjectDto;
  columns: { status: (typeof taskStatuses)[number]; tasks: ProjectTaskDto[] }[];
}

export interface GanttDto {
  project: ProjectDto;
  rangeStart: string;
  rangeEnd: string;
  milestones: MilestoneDto[];
  tasks: {
    id: string;
    title: string;
    status: (typeof taskStatuses)[number];
    startAt: string;
    dueAt: string | null;
    milestoneId: string | null;
    dependsOn: string[];
  }[];
}

// ---------- onboarding & portal ----------

export const createProjectFromDealSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export interface PortalViewDto {
  projectName: string;
  accountName: string;
  status: (typeof projectStatuses)[number];
  startDate: string | null;
  dueDate: string | null;
  milestones: { name: string; status: (typeof milestoneStatuses)[number]; dueDate: string | null }[];
  taskCounts: { total: number; completed: number };
}
