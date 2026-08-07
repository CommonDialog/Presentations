import { z } from 'zod';
import { workflowTriggerTypes } from './workflows.js';

// ---------- API keys (REST API access) ----------

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// ---------- chat integrations (Slack / Teams) ----------

export const chatIntegrationKinds = ['slack', 'teams'] as const;
export type ChatIntegrationKind = (typeof chatIntegrationKinds)[number];

export const integrationKinds = ['slack', 'teams', 'linkedin'] as const;
export type IntegrationKind = (typeof integrationKinds)[number];

export const integrationUpsertSchema = z.object({
  kind: z.enum(integrationKinds),
  /** slack/teams: { webhookUrl }; linkedin: {} (simulated provider). */
  config: z.object({ webhookUrl: z.url().max(500).optional() }),
  enabled: z.boolean().default(true),
});
export type IntegrationUpsertInput = z.infer<typeof integrationUpsertSchema>;

export interface IntegrationDto {
  id: string;
  kind: IntegrationKind;
  config: { webhookUrl?: string };
  enabled: boolean;
}

// ---------- outbound webhooks ----------

export const webhookEventTypes = workflowTriggerTypes;

export const webhookCreateSchema = z.object({
  url: z.url().max(500),
  /** Omitted = a signing secret is generated server-side. */
  secret: z.string().min(8).max(200).optional(),
  /** Empty = subscribe to all events. */
  events: z.array(z.enum(webhookEventTypes)).default([]),
  enabled: z.boolean().default(true),
});
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;

export const webhookUpdateSchema = z
  .object({
    url: z.url().max(500).optional(),
    events: z.array(z.enum(webhookEventTypes)).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;

export interface WebhookDto {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

export interface WebhookDeliveryDto {
  id: string;
  event: string;
  status: 'delivered' | 'failed';
  statusCode: number | null;
  error: string | null;
  createdAt: string;
}

// ---------- import / export ----------

export const importEntityTypes = ['account', 'contact', 'lead'] as const;
export type ImportEntityType = (typeof importEntityTypes)[number];

export const exportEntityTypes = ['account', 'contact', 'deal', 'lead', 'project'] as const;
export type ExportEntityType = (typeof exportEntityTypes)[number];

export const importRequestSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface ImportResultDto {
  entityType: ImportEntityType;
  created: number;
  skipped: { row: number; reason: string }[];
}

// ---------- enrichment ----------

export interface AccountEnrichmentDto {
  provider: string;
  applied: string[];
  suggestions: {
    industry?: string | undefined;
    description?: string | undefined;
    website?: string | undefined;
    employeeCount?: number | undefined;
    linkedinUrl?: string | undefined;
  };
}

export interface ContactEnrichmentDto {
  provider: string;
  applied: string[];
  suggestions: {
    title?: string | undefined;
    location?: string | undefined;
    linkedinUrl?: string | undefined;
  };
}
