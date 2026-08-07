import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditCols, softDelete, timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';
import { accounts, contacts } from './crm.js';

export const leadStatus = pgEnum('lead_status', [
  'new',
  'working',
  'qualified',
  'disqualified',
  'converted',
]);

export const dealStatus = pgEnum('deal_status', ['open', 'won', 'lost']);

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('pipelines_org_name_unique').on(t.organizationId, t.name)],
);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    probability: integer('probability').notNull().default(0),
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pipeline_stages_pipeline_name_unique').on(t.pipelineId, t.name),
    index('pipeline_stages_pipeline_order_idx').on(t.pipelineId, t.displayOrder),
    check('pipeline_stages_probability_range', sql`${t.probability} between 0 and 100`),
  ],
);

export const leads = pgTable(
  'leads',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    company: text('company'),
    email: text('email'),
    phone: text('phone'),
    source: text('source'),
    status: leadStatus('status').notNull().default('new'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    custom: jsonb('custom').notNull().default({}),
    convertedAccountId: uuid('converted_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    convertedContactId: uuid('converted_contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    convertedDealId: uuid('converted_deal_id').references(() => deals.id, {
      onDelete: 'set null',
    }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('leads_org_status_idx').on(t.organizationId, t.status),
    index('leads_org_email_idx').on(t.organizationId, sql`lower(${t.email})`),
  ],
);

export const deals = pgTable(
  'deals',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStages.id, { onDelete: 'restrict' }),
    status: dealStatus('status').notNull().default('open'),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    currency: text('currency').notNull().default('USD'),
    probability: integer('probability'),
    expectedCloseDate: date('expected_close_date'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    winLossReason: text('win_loss_reason'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    custom: jsonb('custom').notNull().default({}),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('deals_org_stage_idx').on(t.organizationId, t.stageId),
    // account pages, customer-health laterals, exports all join by account
    index('deals_account_idx').on(t.accountId),
    index('deals_org_status_idx').on(t.organizationId, t.status),
    index('deals_org_close_date_idx').on(t.organizationId, t.expectedCloseDate),
    index('deals_org_owner_idx').on(t.organizationId, t.ownerId),
    index('deals_custom_gin').using('gin', t.custom),
    check('deals_probability_range', sql`${t.probability} is null or ${t.probability} between 0 and 100`),
  ],
);

export const dealContacts = pgTable(
  'deal_contacts',
  {
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    role: text('role'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.contactId] })],
);

export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    fromStageId: uuid('from_stage_id').references(() => pipelineStages.id, {
      onDelete: 'set null',
    }),
    toStageId: uuid('to_stage_id').references(() => pipelineStages.id, {
      onDelete: 'set null',
    }),
    changedBy: uuid('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('deal_stage_history_deal_idx').on(t.dealId, t.changedAt)],
);
