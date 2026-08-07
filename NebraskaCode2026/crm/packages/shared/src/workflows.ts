import { z } from 'zod';
import { taskPriorities } from './domain.js';

export const workflowTriggerTypes = [
  'lead.created',
  'contact.created',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'project.created',
] as const;
export type WorkflowTriggerType = (typeof workflowTriggerTypes)[number];

export const conditionOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] as const;

export const workflowConditionSchema = z.object({
  /** Dot-path into the trigger context, e.g. "deal.amount" or "lead.source". */
  field: z.string().min(1).max(200),
  op: z.enum(conditionOps),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

export const workflowActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    priority: z.enum(taskPriorities).optional(),
    dueInDays: z.number().int().min(0).max(365).optional(),
  }),
  z.object({
    type: z.literal('send_email'),
    /** "owner", "contact", or an explicit email address. */
    to: z.string().min(1).max(300),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20_000),
  }),
  z.object({
    type: z.literal('notify'),
    recipient: z.enum(['owner', 'actor']),
    message: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal('analyze_deal') }),
  z.object({ type: z.literal('create_onboarding_project') }),
  z.object({
    type: z.literal('post_message'),
    /** Delivered to the org's configured Slack/Teams incoming webhook. */
    target: z.enum(['slack', 'teams']),
    message: z.string().min(1).max(1000),
  }),
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export const workflowCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  triggerType: z.enum(workflowTriggerTypes),
  conditions: z.array(workflowConditionSchema).max(10).default([]),
  actions: z.array(workflowActionSchema).min(1).max(10),
  enabled: z.boolean().default(true),
});
export type WorkflowCreateInput = z.infer<typeof workflowCreateSchema>;

export const workflowUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    triggerType: z.enum(workflowTriggerTypes).optional(),
    conditions: z.array(workflowConditionSchema).max(10).optional(),
    actions: z.array(workflowActionSchema).min(1).max(10).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type WorkflowUpdateInput = z.infer<typeof workflowUpdateSchema>;

export interface WorkflowDto {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: WorkflowTriggerType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunDto {
  id: string;
  workflowId: string;
  triggerType: string;
  status: 'executed' | 'skipped' | 'failed';
  actionsExecuted: { type: string; note?: string }[];
  error: string | null;
  createdAt: string;
}

export interface WorkflowTemplateDto {
  key: string;
  name: string;
  description: string;
  definition: WorkflowCreateInput;
}

export interface NotificationDto {
  id: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}
