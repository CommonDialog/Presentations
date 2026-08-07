import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditCols, softDelete, timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';
import { accounts, contacts } from './crm.js';
import { deals, leads } from './pipeline.js';
import { milestones, projects } from './projects.js';

export const activityType = pgEnum('activity_type', ['email', 'call', 'meeting', 'note']);
export const activityDirection = pgEnum('activity_direction', ['inbound', 'outbound']);
export const taskStatus = pgEnum('task_status', ['open', 'in_progress', 'completed', 'canceled']);
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high', 'urgent']);

export const activities = pgTable(
  'activities',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: activityType('type').notNull(),
    direction: activityDirection('direction'),
    subject: text('subject').notNull(),
    body: text('body'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('activities_org_occurred_idx').on(t.organizationId, t.occurredAt.desc()),
    // Email threading looks emails up by provider message id / thread key
    // stored in metadata; partial expression indexes keep those O(log n).
    index('activities_email_provider_msg_idx')
      .on(t.organizationId, sql`(${t.metadata}->>'providerMessageId')`)
      .where(sql`${t.type} = 'email'`),
    index('activities_email_thread_idx')
      .on(t.organizationId, sql`(${t.metadata}->>'threadKey')`)
      .where(sql`${t.type} = 'email'`),
  ],
);

// One row per activity↔record link. Typed FK columns instead of a polymorphic
// (entity_type, entity_id) pair so referential integrity stays in the database.
export const activityLinks = pgTable(
  'activity_links',
  {
    id: uuidPk(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [
    check(
      'activity_links_exactly_one_target',
      sql`num_nonnulls(${t.accountId}, ${t.contactId}, ${t.dealId}, ${t.leadId}, ${t.projectId}) = 1`,
    ),
    unique('activity_links_no_duplicates')
      .on(t.activityId, t.accountId, t.contactId, t.dealId, t.leadId, t.projectId)
      .nullsNotDistinct(),
    index('activity_links_account_idx').on(t.accountId),
    index('activity_links_contact_idx').on(t.contactId),
    index('activity_links_deal_idx').on(t.dealId),
    index('activity_links_lead_idx').on(t.leadId),
    index('activity_links_project_idx').on(t.projectId),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('open'),
    priority: taskPriority('priority').notNull().default('normal'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    reminderAt: timestamp('reminder_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    ...timestamps,
    ...auditCols,
    ...softDelete,
  },
  (t) => [
    index('tasks_org_assignee_status_idx').on(t.organizationId, t.assigneeId, t.status),
    index('tasks_org_due_idx').on(t.organizationId, t.dueAt),
    index('tasks_account_idx').on(t.accountId),
    index('tasks_deal_idx').on(t.dealId),
    index('tasks_project_idx').on(t.projectId),
  ],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    check('task_dependencies_no_self', sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);
