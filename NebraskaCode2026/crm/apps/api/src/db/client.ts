import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(
  connectionString: string,
  options: { poolMax?: number } = {},
): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max: options.poolMax ?? 10 });
  return { db: drizzle(pool, { schema }), pool };
}
