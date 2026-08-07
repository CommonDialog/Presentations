import { index, jsonb, numeric, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './helpers.js';
import { organizations } from './identity.js';
import { accounts, contacts } from './crm.js';
import { deals, leads } from './pipeline.js';
import { projects } from './projects.js';
import { activities } from './activities.js';

export const aiArtifactKind = pgEnum('ai_artifact_kind', [
  'summary',
  'insight',
  'proposal',
  'conversation',
]);

// Proposals move pending → approved → applied, or pending → rejected.
// Non-proposal kinds (summaries, insights) are born approved.
export const aiArtifactStatus = pgEnum('ai_artifact_status', [
  'pending',
  'approved',
  'rejected',
  'applied',
]);

export const aiArtifacts = pgTable(
  'ai_artifacts',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: aiArtifactKind('kind').notNull(),
    status: aiArtifactStatus('status').notNull().default('pending'),
    title: text('title').notNull(),
    payload: jsonb('payload').notNull().default({}),
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    sourceActivityId: uuid('source_activity_id').references(() => activities.id, {
      onDelete: 'set null',
    }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('ai_artifacts_org_kind_status_idx').on(t.organizationId, t.kind, t.status),
    index('ai_artifacts_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('ai_artifacts_account_idx').on(t.accountId),
    index('ai_artifacts_deal_idx').on(t.dealId),
  ],
);
