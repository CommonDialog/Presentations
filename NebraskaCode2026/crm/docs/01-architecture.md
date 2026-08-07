# Prompt 1 — Project Foundation & Architecture

Decisions approved by Chris in Prompt 0: all-TypeScript stack, Anthropic Claude as default LLM,
simulated external providers behind real interfaces, PostgreSQL.

## Technology stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere (strict, TS 7) | One language across API, web, shared contracts; approved in Prompt 0 |
| Runtime | Node.js 22 | Current LTS on the dev machine |
| API framework | Fastify 5 | Fast, minimal magic, first-class plugin/DI-lite model, `inject()` for HTTP tests without sockets. NestJS considered; rejected as heavier than needed when we control the layering ourselves |
| Validation / contracts | Zod 4 | Runtime validation + inferred static types; shared between API and web via `@crm/shared` |
| ORM / DB access | Drizzle ORM (arrives Prompt 2) | SQL-first: Prompt 2 demands hand-designed schema, indexes, cascade rules; Drizzle stays close to the SQL instead of hiding it |
| Database | PostgreSQL | Approved. Also carries background jobs (pg-boss) and embeddings (pgvector) — one stateful dependency total |
| Background jobs | pg-boss (arrives Prompt 8) | Postgres-backed queue; no Redis, no containers |
| Frontend | React 19 + Vite 8 | SPA; Vite dev server proxies `/api` to Fastify |
| Styling | Tailwind CSS 4 | Utility CSS, no runtime dependency |
| Data fetching | TanStack Query (arrives Prompt 5) | Cache/invalidation for CRUD-heavy UI |
| Unit/integration tests | Vitest 4 | One test runner for API, shared, and web |
| E2E tests | Playwright (arrives Prompt 5) | Browser automation already available in this environment |
| LLM | Anthropic Claude behind a provider abstraction (Prompt 8) | Approved default; abstraction keeps providers swappable |

## Folder structure / solution organization

```
crm/
  package.json            npm workspaces root (apps/*, packages/*)
  tsconfig.base.json      strict compiler options shared by all packages
  .env.example            required environment variables, documented
  docs/                   one numbered doc per prompt phase
  apps/
    api/                  Fastify API server
      src/
        config.ts         env parsing (Zod) — the only place process.env is read
        app.ts            buildApp(): composition root; registers plugins/modules
        server.ts         entry point; listen() only
        modules/<name>/   one folder per functional module (health today;
                          auth, accounts, contacts, pipeline… in later prompts)
      test/               integration tests via app.inject(), no sockets
    web/                  React SPA (Vite)
      src/                main.tsx, App.tsx; feature folders arrive with features
  packages/
    shared/               Zod schemas + TS types shared API↔web; no runtime deps
```

Rules:

- **Module = folder** under `apps/api/src/modules/`. Each module owns its routes,
  service (business logic), and repository (persistence). Nothing reaches into another
  module's repository; cross-module calls go through services.
- **`packages/shared` is the contract.** Request/response schemas live there once, are
  validated at the API boundary, and typed in the web client. No server-only code in shared.
- **`buildApp()` takes its config as an argument** so tests construct isolated app instances.

## Backend architecture

Layered, enforced by convention now and by the Prompt 22 review later:

```
routes (HTTP, Zod validation)  →  services (business rules, pure TS)  →  repositories (Drizzle/SQL)
```

- Routes never touch the database; repositories never make business decisions (Prompt 3
  requires business logic separate from persistence).
- Cross-cutting concerns — auth context, tenant scoping, audit logging — are Fastify
  plugins/decorators applied at the composition root (Prompt 4).
- The timeline and the AI proposal pipeline will be modules other modules depend on,
  not code they each reimplement (risk #1 and #2 in the Prompt 0 analysis).

## Frontend architecture

- SPA with feature folders mirroring API modules (`src/features/<name>/`).
- Server state via TanStack Query keyed by API routes; forms validated with the same
  Zod schemas the API enforces.
- Routing added when there is more than one screen (Prompt 5).
- Dev: Vite on :5173 proxying `/api` to Fastify on :3001 — no CORS in development.

## Database strategy

- PostgreSQL, accessed through Drizzle; migrations are SQL files, forward-only, committed.
- Every tenant-owned table carries `organization_id`; row-level security policies enforce
  isolation in the database, not just the app layer (Prompt 4).
- Soft delete (`deleted_at`) and audit columns designed into the schema in Prompt 2, not bolted on.
- pgvector for embeddings and pg-boss job tables live in the same database — one backup,
  one connection string, no extra infrastructure.

## Authentication approach

- Cookie sessions (httpOnly, SameSite=Lax) stored in Postgres — revocable server-side,
  no token refresh machinery, right default for a browser SPA.
- RBAC: users → roles → permissions, all organization-scoped; API authorization enforced
  per-route via a Fastify guard, tenant isolation enforced twice (app filter + Postgres RLS).
- Full design lands in Prompt 4.

## AI integration strategy

- `LlmProvider` interface in the API (complete/stream/embed, structured outputs via Zod);
  Anthropic Claude is the default implementation, a deterministic fake is the test implementation.
- All AI work runs as pg-boss background jobs with retry policies; every call logged with
  token counts and cost (Prompt 8).
- AI output is never a direct write: it becomes an AI artifact / proposal awaiting human
  approval (Prompts 9–10). This is the product's central architectural rule.

## Testing strategy

- **Unit** (Vitest): services with fake repositories — business rules tested without a DB.
- **Integration** (Vitest): `app.inject()` against a real test database; every route.
- **E2E** (Playwright): critical user journeys per phase, added from Prompt 5 on.
- AI features tested against the fake provider; provider adapters get thin contract tests.
- Gate: `npm run test` and `npm run typecheck` green at every prompt boundary.

## Deployment strategy

- **No containers** — hard constraint.
- Development: `npm run dev:api` + `npm run dev:web`, local Postgres.
- Production shape: `vite build` static assets served by any web server or the API itself;
  the API is a plain Node process under a service manager (NSSM/systemd/PM2); Postgres is a
  managed instance. Configuration is environment variables only (`.env.example` is the contract).
- Migrations run as a release step, before the new process starts.

## Verified in this phase

- `npm run test` — API health integration test passes (Vitest, `app.inject()`).
- `npm run typecheck` — all three workspaces clean under TS 7 strict.
- `npm run build -w @crm/web` — production build succeeds.
- Live boot: `GET /api/health` → `{"status":"ok","version":"0.1.0",...}`.

No business logic implemented, per the prompt.
