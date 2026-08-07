import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

// PostgreSQL 18 ships uuidv7(): time-ordered UUIDs, index-friendly inserts.
export const uuidPk = (name = 'id') =>
  uuid(name)
    .primaryKey()
    .default(sql`uuidv7()`);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// Plain uuids, deliberately no FK: users are deactivated, never hard-deleted,
// and the audit trail must survive any cleanup.
export const auditCols = {
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
};

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
