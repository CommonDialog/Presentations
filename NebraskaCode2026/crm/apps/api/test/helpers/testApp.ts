import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createDb, type Db } from '../../src/db/client.js';
import { seedPermissions } from '../../src/modules/auth/service.js';
import { seedPrompts } from '../../src/ai/prompts.js';

// Integration tests run against crm_test (created by db:setup), never crm.
const envPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

export function testConfig(): Config {
  const base = loadConfig();
  const url = new URL(base.DATABASE_URL);
  url.pathname = '/crm_test';
  // Auth caching off in tests: permission/role changes must apply instantly.
  return { ...base, NODE_ENV: 'test', DATABASE_URL: url.toString(), AUTH_CACHE_TTL_MS: 0 };
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  close: () => Promise<void>;
}

export async function buildTestApp(): Promise<TestContext> {
  const config = testConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  const app = buildApp({ config, db, logger: false });
  await app.ready();
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Truncate every public table, then restore boot-time seeds (permission catalog). */
export async function resetDb(db: Db): Promise<void> {
  const result = await db.execute(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = result.rows.map((r) => `"${String(r.tablename)}"`).join(', ');
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  await seedPermissions(db);
  await seedPrompts(db);
}

let orgCounter = 0;

export interface TestOrg {
  organizationId: string;
  userId: string;
  email: string;
  password: string;
  cookies: { sid: string };
}

/** Register a fresh organization + admin and return the session cookie. */
export async function registerOrg(app: FastifyInstance, name?: string): Promise<TestOrg> {
  orgCounter += 1;
  const orgName = name ?? `Test Org ${orgCounter}`;
  const email = `admin${orgCounter}@${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '')}.test`;
  const password = 'correct-horse-battery';
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { organizationName: orgName, name: 'Test Admin', email, password },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (!sid) throw new Error('no session cookie');
  const body = res.json();
  return {
    organizationId: body.organizationId,
    userId: body.userId,
    email,
    password,
    cookies: { sid: sid.value },
  };
}

// pg returns numerics as strings; tests occasionally need raw client access.
export { pg };
