import { date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditCols, softDelete, timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';
import { accounts } from './crm.js';

export const projectStatus = pgEnum('project_status', [
  'planned',
  'active',
  'on_hold',
  'completed',
  'canceled',
]);

export const milestoneStatus = pgEnum('milestone_status', [
  'pending',
  'in_progress',
  'completed',
]);

export const projects = pgTable(
  'projects',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: projectStatus('status').notNull().default('planned'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    custom: jsonb('custom').notNull().default({}),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('projects_org_account_idx').on(t.organizationId, t.accountId),
    index('projects_org_status_idx').on(t.organizationId, t.status),
  ],
);

export const milestones = pgTable(
  'milestones',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dueDate: date('due_date'),
    status: milestoneStatus('status').notNull().default('pending'),
    displayOrder: integer('display_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('milestones_project_order_idx').on(t.projectId, t.displayOrder)],
);
