import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { softDelete, timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';
import { accounts, contacts } from './crm.js';
import { deals, leads } from './pipeline.js';
import { projects } from './projects.js';
import { activities } from './activities.js';
import { aiArtifacts } from './ai.js';

export const documents = pgTable(
  'documents',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storagePath: text('storage_path').notNull(),
    uploadedBy: uuid('uploaded_by'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('documents_org_idx').on(t.organizationId, t.createdAt.desc()),
    index('documents_account_idx').on(t.accountId),
    index('documents_deal_idx').on(t.dealId),
    index('documents_project_idx').on(t.projectId),
  ],
);

// Append-only. No updated_at, no soft delete: entries are written once and
// removed only when their subject record is hard-purged (FK cascade).
export const timelineEntries = pgTable(
  'timeline_entries',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entryType: text('entry_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    summary: text('summary').notNull(),
    detail: jsonb('detail').notNull().default({}),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    aiArtifactId: uuid('ai_artifact_id').references(() => aiArtifacts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'timeline_entries_has_target',
      sql`num_nonnulls(${t.accountId}, ${t.contactId}, ${t.dealId}, ${t.leadId}, ${t.projectId}) >= 1`,
    ),
    index('timeline_org_occurred_idx').on(t.organizationId, t.occurredAt.desc()),
    index('timeline_account_idx').on(t.accountId, t.occurredAt.desc()),
    index('timeline_contact_idx').on(t.contactId, t.occurredAt.desc()),
    index('timeline_deal_idx').on(t.dealId, t.occurredAt.desc()),
    index('timeline_lead_idx').on(t.leadId, t.occurredAt.desc()),
    index('timeline_project_idx').on(t.projectId, t.occurredAt.desc()),
  ],
);

export const customFieldType = pgEnum('custom_field_type', [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
  'url',
  'email',
]);

// Definitions only; values live in each entity's `custom` jsonb column.
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    fieldType: customFieldType('field_type').notNull(),
    required: boolean('required').notNull().default(false),
    options: jsonb('options'),
    rules: jsonb('rules').notNull().default({}),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('custom_fields_org_entity_key_unique').on(t.organizationId, t.entityType, t.key),
    check(
      'custom_fields_entity_type',
      sql`${t.entityType} in ('account', 'contact', 'deal', 'lead', 'project')`,
    ),
  ],
);
