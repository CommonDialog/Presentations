import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

// The transaction type drizzle passes to db.transaction callbacks.
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type DbLike = Db | Tx;

/**
 * Run `fn` in a transaction with the tenant context set. Every RLS policy keys
 * off `app.org_id` (transaction-local), so all reads and writes inside `fn`
 * are constrained to this organization by the database itself.
 */
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
