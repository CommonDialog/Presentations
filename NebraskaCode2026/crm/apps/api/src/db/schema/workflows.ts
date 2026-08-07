import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';

export const workflows = pgTable(
  'workflows',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    triggerType: text('trigger_type').notNull(),
    conditions: jsonb('conditions').notNull().default([]),
    actions: jsonb('actions').notNull().default([]),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [index('workflows_org_trigger_idx').on(t.organizationId, t.triggerType, t.enabled)],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    triggerType: text('trigger_type').notNull(),
    status: text('status').notNull(), // executed | skipped | failed
    context: jsonb('context').notNull().default({}),
    actionsExecuted: jsonb('actions_executed').notNull().default([]),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('workflow_runs_workflow_idx').on(t.workflowId, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    link: text('link'),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.read, t.createdAt)],
);
