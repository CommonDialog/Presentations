import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';

// Programmatic REST access. The token is shown once at creation; only its
// SHA-256 hash is stored. A key authenticates as the user who created it,
// with that user's permissions.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** First characters of the token, for display ("crm_ab12…"). */
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('api_keys_token_hash_unique').on(t.tokenHash),
    index('api_keys_org_idx').on(t.organizationId),
  ],
);

// Per-org connection settings for chat/enrichment integrations.
export const integrations = pgTable(
  'integrations',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    config: jsonb('config').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('integrations_org_kind_unique').on(t.organizationId, t.kind),
    check('integrations_kind', sql`${t.kind} in ('slack', 'teams', 'linkedin')`),
  ],
);

// Outbound webhook subscriptions on CRM events (the workflow trigger types).
export const webhooks = pgTable(
  'webhooks',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** HMAC-SHA256 signing secret; the signature ships as X-CRM-Signature. */
    secret: text('secret').notNull(),
    /** Event names; empty array = all events. */
    events: jsonb('events').notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [index('webhooks_org_idx').on(t.organizationId, t.enabled)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull(), // delivered | failed
    statusCode: integer('status_code'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt)],
);
