import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditCols, softDelete, timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';

export const accounts = pgTable(
  'accounts',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    domain: text('domain'),
    website: text('website'),
    industry: text('industry'),
    phone: text('phone'),
    description: text('description'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    custom: jsonb('custom').notNull().default({}),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('accounts_org_name_idx').on(t.organizationId, t.name),
    index('accounts_org_domain_idx').on(t.organizationId, sql`lower(${t.domain})`),
    index('accounts_custom_gin').using('gin', t.custom),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    title: text('title'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    custom: jsonb('custom').notNull().default({}),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('contacts_org_email_idx').on(t.organizationId, sql`lower(${t.email})`),
    index('contacts_org_account_idx').on(t.organizationId, t.accountId),
    index('contacts_org_name_idx').on(t.organizationId, t.lastName, t.firstName),
    index('contacts_custom_gin').using('gin', t.custom),
  ],
);
