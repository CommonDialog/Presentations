import { z } from 'zod';
import { activityDirections, activityTypes, taskPriorities, taskStatuses } from './domain.js';
import { paginationSchema } from './crm.js';

// ---------- activities ----------

export const activityLinksSchema = z.object({
  accounts: z.array(z.uuid()).max(20).optional(),
  contacts: z.array(z.uuid()).max(20).optional(),
  deals: z.array(z.uuid()).max(20).optional(),
  leads: z.array(z.uuid()).max(20).optional(),
  projects: z.array(z.uuid()).max(20).optional(),
});
export type ActivityLinksInput = z.infer<typeof activityLinksSchema>;

function linkCount(links: ActivityLinksInput | undefined): number {
  if (!links) return 0;
  return (
    (links.accounts?.length ?? 0) +
    (links.contacts?.length ?? 0) +
    (links.deals?.length ?? 0) +
    (links.leads?.length ?? 0) +
    (links.projects?.length ?? 0)
  );
}

export const activityCreateSchema = z
  .object({
    type: z.enum(activityTypes),
    direction: z.enum(activityDirections).optional(),
    subject: z.string().trim().min(1).max(300),
    body: z.string().max(20000).optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    links: activityLinksSchema,
  })
  .refine((v) => linkCount(v.links) >= 1, {
    message: 'an activity must be linked to at least one record',
  });
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

export const activityUpdateSchema = z
  .object({
    direction: z.enum(activityDirections).nullable().optional(),
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(20000).nullable().optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    links: activityLinksSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' })
  .refine((v) => v.links === undefined || linkCount(v.links) >= 1, {
    message: 'an activity must keep at least one linked record',
  });
export type ActivityUpdateInput = z.infer<typeof activityUpdateSchema>;

export const activityQuerySchema = paginationSchema.extend({
  type: z.enum(activityTypes).optional(),
  query: z.string().trim().max(200).optional(),
  accountId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export interface ActivityLinkRef {
  id: string;
  label: string;
}

export interface ActivityDto {
  id: string;
  type: (typeof activityTypes)[number];
  direction: (typeof activityDirections)[number] | null;
  subject: string;
  body: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
  links: {
    accounts: ActivityLinkRef[];
    contacts: ActivityLinkRef[];
    deals: ActivityLinkRef[];
    leads: ActivityLinkRef[];
    projects: ActivityLinkRef[];
  };
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ---------- tasks ----------

export const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    priority: z.enum(taskPriorities).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    reminderAt: z.iso.datetime({ offset: true }).optional(),
    assigneeId: z.uuid().optional(),
    accountId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    dealId: z.uuid().optional(),
    leadId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    milestoneId: z.uuid().optional(),
  })
  .refine(
    (v) => !v.reminderAt || !v.dueAt || new Date(v.reminderAt) <= new Date(v.dueAt),
    { message: 'reminder must not be after the due date' },
  );
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: z.enum(taskPriorities).optional(),
    status: z.enum(taskStatuses).optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    reminderAt: z.iso.datetime({ offset: true }).nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
    accountId: z.uuid().nullable().optional(),
    contactId: z.uuid().nullable().optional(),
    dealId: z.uuid().nullable().optional(),
    leadId: z.uuid().nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    milestoneId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const taskQuerySchema = paginationSchema.extend({
  status: z.enum(taskStatuses).optional(),
  open: z.coerce.boolean().optional(), // open OR in_progress
  assigneeId: z.uuid().optional(),
  dueBefore: z.iso.datetime({ offset: true }).optional(),
  query: z.string().trim().max(200).optional(),
  accountId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  sort: z.enum(['dueAt', 'createdAt', 'priority']).default('dueAt'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  status: (typeof taskStatuses)[number];
  priority: (typeof taskPriorities)[number];
  dueAt: string | null;
  reminderAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  accountId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
