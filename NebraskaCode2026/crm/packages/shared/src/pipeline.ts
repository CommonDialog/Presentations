import { z } from 'zod';
import { leadStatuses } from './domain.js';
import { paginationSchema } from './crm.js';

// ---------- pipelines ----------

export interface PipelineStageDto {
  id: string;
  name: string;
  displayOrder: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface PipelineDto {
  id: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStageDto[];
}

// ---------- leads ----------

const leadPerson = {
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  company: z.string().trim().max(200).optional(),
  email: z.email().toLowerCase().optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().max(100).optional(),
  ownerId: z.uuid().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
};

export const leadCreateSchema = z
  .object(leadPerson)
  .refine((v) => Boolean(v.firstName?.trim() || v.lastName?.trim() || v.company?.trim()), {
    message: 'a lead needs at least a name or a company',
  });
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z
  .object({
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    company: z.string().trim().max(200).nullable().optional(),
    email: z.email().toLowerCase().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    source: z.string().trim().max(100).nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const leadStatusSchema = z.object({
  status: z.enum(leadStatuses),
});

export const leadQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  status: z.enum(leadStatuses).optional(),
  ownerId: z.uuid().optional(),
  sort: z.enum(['createdAt', 'company', 'lastName']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type LeadQuery = z.infer<typeof leadQuerySchema>;

export const leadConvertSchema = z.object({
  accountId: z.uuid().optional(),
  deal: z
    .object({
      name: z.string().trim().min(1).max(200),
      amount: z.number().nonnegative().max(1e12).optional(),
      expectedCloseDate: z.iso.date().optional(),
    })
    .optional(),
});
export type LeadConvertInput = z.infer<typeof leadConvertSchema>;

export interface LeadDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: (typeof leadStatuses)[number];
  ownerId: string | null;
  custom: Record<string, unknown>;
  convertedAccountId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface LeadConvertResult {
  lead: LeadDto;
  accountId: string;
  contactId: string | null;
  dealId: string | null;
}

// ---------- deals ----------

export const dealCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: z.uuid(),
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  amount: z.number().nonnegative().max(1e12).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.iso.date().optional(),
  ownerId: z.uuid().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type DealCreateInput = z.infer<typeof dealCreateSchema>;

export const dealUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    amount: z.number().nonnegative().max(1e12).nullable().optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    expectedCloseDate: z.iso.date().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type DealUpdateInput = z.infer<typeof dealUpdateSchema>;

export const dealMoveSchema = z.object({
  stageId: z.uuid(),
  winLossReason: z.string().trim().min(1).max(500).optional(),
});
export type DealMoveInput = z.infer<typeof dealMoveSchema>;

export const dealQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
  accountId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  sort: z.enum(['name', 'amount', 'expectedCloseDate', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type DealQuery = z.infer<typeof dealQuerySchema>;

export const dealContactAddSchema = z.object({
  contactId: z.uuid(),
  role: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

export interface DealDto {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  pipelineId: string;
  stageId: string;
  status: 'open' | 'won' | 'lost';
  amount: number | null;
  currency: string;
  probability: number | null;
  effectiveProbability: number;
  expectedRevenue: number | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  winLossReason: string | null;
  ownerId: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DealContactDto {
  contactId: string;
  firstName: string;
  lastName: string;
  role: string | null;
  isPrimary: boolean;
}

export interface StageHistoryDto {
  id: string;
  fromStageId: string | null;
  fromStageName: string | null;
  toStageId: string | null;
  toStageName: string | null;
  changedBy: string | null;
  changedAt: string;
}

export interface BoardColumnDto {
  stage: PipelineStageDto;
  deals: DealDto[];
  totalAmount: number;
  weightedAmount: number;
}

export interface BoardDto {
  pipeline: PipelineDto;
  columns: BoardColumnDto[];
}

export interface ForecastStageRow {
  stageId: string;
  stageName: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
}

export interface ForecastDto {
  pipelineId: string;
  stages: ForecastStageRow[];
  openCount: number;
  openAmount: number;
  weightedForecast: number;
  wonCount: number;
  wonAmount: number;
  lostCount: number;
}
