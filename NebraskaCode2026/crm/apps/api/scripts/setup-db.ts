// Creates the crm and crm_test databases if missing, then applies migrations to both.
// Usage: npm run db:setup -w @crm/api  (requires DATABASE_URL in crm/.env)
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const baseUrl = new URL(config.DATABASE_URL);

async function ensureDatabase(name: string): Promise<void> {
  const adminUrl = new URL(baseUrl.toString());
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`created database ${name}`);
    } else {
      console.log(`database ${name} exists`);
    }
  } finally {
    await client.end();
  }
}

async function migrateDatabase(name: string): Promise<void> {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    console.log(`migrated ${name}`);
  } finally {
    await pool.end();
  }
}

for (const name of ['crm', 'crm_test']) {
  await ensureDatabase(name);
  await migrateDatabase(name);
}
console.log('done');
