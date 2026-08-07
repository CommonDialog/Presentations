// Load-test harness: boots the API against crm_test, seeds a realistic org,
// and measures latency/throughput over real HTTP.
//
//   npx tsx scripts/bench.ts baseline     # writes bench-baseline.json
//   npx tsx scripts/bench.ts optimized    # writes bench-optimized.json
//
// Compare runs:
//   npx tsx scripts/bench.ts --compare bench-baseline.json bench-optimized.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { seedPermissions } from '../src/modules/auth/service.js';
import { seedPrompts } from '../src/ai/prompts.js';

const envPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

interface Stats {
  requests: number;
  errors: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

function stats(latencies: number[], elapsedMs: number, errors: number): Stats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    requests: latencies.length,
    errors,
    rps: Math.round((latencies.length / elapsedMs) * 1000),
    p50: Math.round(pick(0.5) * 100) / 100,
    p95: Math.round(pick(0.95) * 100) / 100,
    p99: Math.round(pick(0.99) * 100) / 100,
    mean: Math.round((latencies.reduce((s, v) => s + v, 0) / latencies.length) * 100) / 100,
  };
}

async function runScenario(
  name: string,
  total: number,
  concurrency: number,
  fire: () => Promise<Response>,
): Promise<Stats> {
  // warmup
  for (let i = 0; i < 15; i++) await fire();

  const latencies: number[] = [];
  let errors = 0;
  let issued = 0;
  const started = performance.now();
  async function worker() {
    while (issued < total) {
      issued += 1;
      const t0 = performance.now();
      try {
        const res = await fire();
        await res.arrayBuffer();
        if (res.status >= 400) errors += 1;
      } catch {
        errors += 1;
      }
      latencies.push(performance.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const result = stats(latencies, performance.now() - started, errors);
  console.log(
    `${name.padEnd(28)} p50 ${String(result.p50).padStart(7)}ms  p95 ${String(result.p95).padStart(7)}ms  ${String(result.rps).padStart(5)} req/s${result.errors ? `  ERRORS ${result.errors}` : ''}`,
  );
  return result;
}

function compare(aPath: string, bPath: string): void {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8')) as Record<string, Stats>;
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8')) as Record<string, Stats>;
  console.log(`\n${'scenario'.padEnd(28)} ${'p50 (ms)'.padStart(19)} ${'p95 (ms)'.padStart(19)} ${'req/s'.padStart(17)}`);
  for (const key of Object.keys(a)) {
    if (!b[key]) continue;
    const f = (x: number, y: number, invert = false) => {
      const delta = invert ? ((y - x) / x) * 100 : ((x - y) / x) * 100;
      return `${x} → ${y} (${delta >= 0 ? '-' : '+'}${Math.abs(Math.round(delta))}%)`;
    };
    const rps = `${a[key]!.rps} → ${b[key]!.rps} (${b[key]!.rps >= a[key]!.rps ? '+' : ''}${Math.round(((b[key]!.rps - a[key]!.rps) / a[key]!.rps) * 100)}%)`;
    console.log(`${key.padEnd(28)} ${f(a[key]!.p50, b[key]!.p50).padStart(19)} ${f(a[key]!.p95, b[key]!.p95).padStart(19)} ${rps.padStart(17)}`);
  }
}

async function main() {
  const [arg1, arg2, arg3] = process.argv.slice(2);
  if (arg1 === '--compare' && arg2 && arg3) {
    compare(arg2, arg3);
    return;
  }
  const label = arg1 ?? 'run';

  const base = loadConfig();
  const url = new URL(base.DATABASE_URL);
  url.pathname = '/crm_test';
  const config = { ...base, NODE_ENV: 'test' as const, DATABASE_URL: url.toString() };
  const { db, pool } = createDb(config.DATABASE_URL);

  // reset + reseed
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  await db.execute(
    sql.raw(`truncate table ${tables.rows.map((r) => `"${String(r.tablename)}"`).join(', ')} cascade`),
  );
  await seedPermissions(db);
  await seedPrompts(db);

  const app = buildApp({ config, db, logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  // ---- seed one org with realistic volume ----
  const reg = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationName: 'Bench Org',
      name: 'Bench Admin',
      email: 'bench@bench.test',
      password: 'bench-password-123',
    }),
  });
  const cookie = reg.headers.getSetCookie()[0]!.split(';')[0]!;
  const headers = { 'Content-Type': 'application/json', cookie };
  const get = (p: string) => fetch(`${origin}${p}`, { headers });
  const post = (p: string, body: unknown) =>
    fetch(`${origin}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });

  console.log('seeding…');
  const accountIds: string[] = [];
  for (let i = 0; i < 100; i++) {
    const res = await post('/api/accounts', {
      name: `Account ${i} ${i % 7 === 0 ? 'Acme' : 'Corp'}`,
      domain: `acct${i}.test`,
      industry: i % 2 ? 'Software' : 'Manufacturing',
    });
    accountIds.push((await res.json()).id);
  }
  for (let i = 0; i < 300; i++) {
    await post('/api/contacts', {
      firstName: `First${i}`,
      lastName: `Last${i}`,
      email: `c${i}@acct${i % 100}.test`,
      accountId: accountIds[i % 100],
    });
  }
  const pipelines = await (await get('/api/pipelines')).json();
  const stages = pipelines.pipelines[0].stages.filter((s: { isWon: boolean; isLost: boolean }) => !s.isWon && !s.isLost);
  for (let i = 0; i < 200; i++) {
    await post('/api/deals', {
      name: `Deal ${i}`,
      accountId: accountIds[i % 100],
      amount: 1000 + i * 137,
      stageId: stages[i % stages.length].id,
    });
  }
  for (let i = 0; i < 300; i++) {
    await post('/api/activities', {
      type: ['call', 'note', 'meeting'][i % 3],
      subject: `Interaction ${i} about pricing`,
      body: `Discussion number ${i} covering rollout, pricing tiers, and next steps.`,
      links: { accounts: [accountIds[i % 100]] },
    });
  }
  for (let i = 0; i < 150; i++) {
    await post('/api/tasks', { title: `Task ${i}`, accountId: accountIds[i % 100] });
  }
  console.log('seeded. running scenarios…\n');

  const results: Record<string, Stats> = {};
  let counter = 0;
  results['GET accounts list'] = await runScenario('GET accounts list', 300, 10, () => get('/api/accounts'));
  results['GET deal board'] = await runScenario('GET deal board', 200, 10, () => get('/api/deals/board'));
  results['GET reports/sales'] = await runScenario('GET reports/sales', 200, 10, () => get('/api/reports/sales?days=30'));
  results['GET reports/customers'] = await runScenario('GET reports/customers', 100, 5, () => get('/api/reports/customers'));
  results['GET search'] = await runScenario('GET search', 200, 10, () => get('/api/search?q=acme'));
  results['GET notifications'] = await runScenario('GET notifications', 300, 10, () => get('/api/notifications'));
  results['POST deal (write)'] = await runScenario('POST deal (write)', 150, 10, () => {
    counter += 1;
    return post('/api/deals', { name: `Bench deal ${counter}`, accountId: accountIds[counter % 100], amount: 500 });
  });
  results['POST activity (write)'] = await runScenario('POST activity (write)', 150, 10, () => {
    counter += 1;
    return post('/api/activities', {
      type: 'note',
      subject: `Bench note ${counter}`,
      links: { accounts: [accountIds[counter % 100]] },
    });
  });

  const outFile = `bench-${label}.json`;
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nsaved ${outFile}`);

  await app.close();
  await pool.end();
}

await main();
