import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './identity.js';
import { projects } from './projects.js';

/**
 * Customer-portal capability tokens. Deliberately NOT under RLS (like
 * sessions): a portal visitor has no tenant context — the token itself is the
 * capability, and the lookup resolves the organization before any RLS query.
 */
export const portalTokens = pgTable(
  'portal_tokens',
  {
    token: text('token').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('portal_tokens_project_idx').on(t.projectId)],
);
