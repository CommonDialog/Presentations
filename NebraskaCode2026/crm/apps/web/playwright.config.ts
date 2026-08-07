import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const envPath = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

// E2E runs against crm_test, same as API integration tests — never the dev database.
const testDbUrl = (() => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://localhost:5432/crm');
  url.pathname = '/crm_test';
  return url.toString();
})();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    // 5174: your long-running dev server owns 5173
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    // wide enough that all six board columns are in-viewport for drag-and-drop
    viewport: { width: 1720, height: 900 },
  },
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: path.resolve(import.meta.dirname, '../api'),
      port: 3001,
      reuseExistingServer: false,
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        API_PORT: '3001',
        // test env: disables the login rate limiter (the suite signs in
        // many times per minute) — matches the API integration test setup
        NODE_ENV: 'test',
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort --host 127.0.0.1',
      cwd: import.meta.dirname,
      port: 5174,
      reuseExistingServer: false,
    },
  ],
});
