import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './helpers.js';
import { organizations } from './identity.js';

// Customer-defined record subtypes (e.g. deal: "New Business" vs "Renewal").
// Entities store their record type key in custom jsonb under "_recordType",
// so no entity-table migration is needed to adopt them.
export const recordTypes = pgTable(
  'record_types',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('record_types_org_entity_key_unique').on(t.organizationId, t.entityType, t.key),
    check(
      'record_types_entity_type',
      sql`${t.entityType} in ('account', 'contact', 'deal', 'lead', 'project')`,
    ),
  ],
);

// One layout per (entity type, record type); record_type_id null = the
// entity-wide default. Sections are jsonb: ordered field groups with
// progressive-disclosure flags (collapsed, visibleWhen conditions).
export const entityLayouts = pgTable(
  'entity_layouts',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    recordTypeId: uuid('record_type_id').references(() => recordTypes.id, { onDelete: 'cascade' }),
    sections: jsonb('sections').notNull().default([]),
    ...timestamps,
  },
  (t) => [
    unique('entity_layouts_org_entity_rt_unique')
      .on(t.organizationId, t.entityType, t.recordTypeId)
      .nullsNotDistinct(),
    index('entity_layouts_org_entity_idx').on(t.organizationId, t.entityType),
    check(
      'entity_layouts_entity_type',
      sql`${t.entityType} in ('account', 'contact', 'deal', 'lead', 'project')`,
    ),
  ],
);
