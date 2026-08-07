import pg from 'pg';
import { ALL_PERMISSION_CODES, PERMISSIONS } from '../../api/src/modules/auth/permissions.js';
import { DEFAULT_PROMPTS } from '../../api/src/ai/prompts.js';

// Playwright boots the webServers BEFORE globalSetup runs, so the API's own
// boot-time seed happens before this truncate. Reseed the permission catalog
// here or registration breaks on role-permission FKs.
export default async function globalSetup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://localhost:5432/crm');
  url.pathname = '/crm_test';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const result = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (result.rows.length > 0) {
      const names = result.rows.map((r) => `"${r.tablename}"`).join(', ');
      await client.query(`truncate table ${names} cascade`);
    }
    for (const code of ALL_PERMISSION_CODES) {
      await client.query(
        'insert into permissions (code, description) values ($1, $2) on conflict (code) do nothing',
        [code, PERMISSIONS[code]],
      );
    }
    for (const prompt of DEFAULT_PROMPTS) {
      await client.query(
        'insert into ai_prompts (name, system_template, user_template) values ($1, $2, $3) on conflict (name) do nothing',
        [prompt.name, prompt.systemTemplate, prompt.userTemplate],
      );
    }
  } finally {
    await client.end();
  }
}
