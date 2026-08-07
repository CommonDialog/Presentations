import { z } from 'zod';
import { taskPriorities } from './domain.js';

// ---------- capture input ----------

export const captureSourceTypes = ['email', 'meeting_transcript', 'call_transcript'] as const;
export type CaptureSourceType = (typeof captureSourceTypes)[number];

export const captureInputSchema = z
  .object({
    sourceType: z.enum(captureSourceTypes),
    subject: z.string().trim().min(1).max(300).optional(),
    content: z.string().min(10).max(100_000),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    accountId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    dealId: z.uuid().optional(),
    leadId: z.uuid().optional(),
  })
  .refine((v) => Boolean(v.accountId || v.contactId || v.dealId || v.leadId), {
    message: 'capture must be linked to at least one record',
  });
export type CaptureInput = z.infer<typeof captureInputSchema>;

// ---------- LLM analysis output (structured output schema) ----------
// Everything required/nullable rather than optional: structured outputs
// enforce the schema server-side, and a fixed shape keeps parsing trivial.

export const captureAnalysisSchema = z.object({
  summary: z.string(),
  actionItems: z.array(z.string()),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  suggestedUpdates: z.array(
    z.object({
      entityType: z.enum(['account', 'contact', 'deal']),
      field: z.string(),
      suggestedValue: z.string(),
      reason: z.string(),
    }),
  ),
  suggestedTasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      dueInDays: z.number().int(),
      priority: z.enum(taskPriorities),
    }),
  ),
  followUpEmail: z.nullable(z.object({ subject: z.string(), body: z.string() })),
});
export type CaptureAnalysis = z.infer<typeof captureAnalysisSchema>;

// ---------- proposals ----------

export type ProposalType = 'update_field' | 'create_task' | 'followup_email';

export interface ProposalDto {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  title: string;
  proposalType: ProposalType;
  payload: Record<string, unknown>;
  accountId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  sourceActivityId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface CaptureResultDto {
  activityId: string;
  status: 'queued' | 'analyzed';
  summary?: string;
  actionItems?: string[];
  sentiment?: string;
  proposals?: ProposalDto[];
}

export const proposalRejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
