# Prompt 4 — Authentication & Security

## What exists now

| Concern | Implementation |
|---|---|
| Registration | `POST /api/auth/register` — creates organization, seeds system roles, creates admin user, signs in (one transaction for tenant data) |
| Login / logout | `POST /api/auth/login`, `POST /api/auth/logout`; both audit-logged (including failed logins) |
| Session | `GET /api/auth/me` — user, organization, effective permissions |
| User management | `GET/POST /api/users`, `PATCH /api/users/:id` (name, deactivate, roles) |
| Role management | `GET/POST /api/roles`, `GET /api/permissions` |

## Passwords & sessions

- **scrypt** (stdlib `node:crypto`, N=2¹⁵ r=8 p=1, 16-byte salt, constant-time compare).
  Self-describing hash format so parameters can be raised later without breaking old hashes.
- **Cookie sessions**: `sid` holds the session uuid, HMAC-signed (`SESSION_SECRET`),
  httpOnly, SameSite=Lax, Secure in production, 7-day TTL, stored in `sessions` — server-side
  revocable. Deactivating a user revokes all their sessions immediately.
- Login/register rate-limited (10/min/IP).

## Authorization model

`users → user_roles → roles → role_permissions → permissions` (global catalog of 22
codes, seeded idempotently at boot; catalog source of truth is
`src/modules/auth/permissions.ts`).

- Every org gets system roles **Admin** (everything) and **Member** (everything except
  `users:manage`, `settings:manage`, `workflows:manage`); custom roles are any subset.
- Route guards: `app.authenticate` (401) and `app.requirePermission(code)` (403) as Fastify
  preHandlers; permission codes are typed (`PermissionCode`), so a typo is a compile error.
- Invariant: an organization always retains ≥1 active Admin — deactivation and role changes
  that would break it are rejected.

## Tenant isolation (two layers)

1. **Application:** every query is scoped by the authenticated user's `organizationId`.
2. **Database (RLS):** migration `0002_rls.sql` enables and **FORCEs** row-level security on
   all 17 org-owned tables (policy: `organization_id = nullif(current_setting('app.org_id',
   true), '')::uuid`) and on the 5 join tables via `EXISTS` delegation to their parent —
   policy composition means the parent's policy supplies the tenant check.
   `withOrg(db, orgId, fn)` (src/lib/tenant.ts) opens a transaction and sets the
   transaction-local `app.org_id`; **outside such a transaction the database returns zero
   rows even to the table owner** — proven by test.
   Not under RLS (read before tenant context exists — login, session resolution):
   `organizations`, `users`, `sessions`, `permissions`.

## Audit logging

`audit_log` (append-only, RLS-scoped): actor, action, entity type/id, jsonb changes.
Currently written for: organization creation, user/role create/update, login, failed login,
logout. The Prompt 5 repository layer will route every business mutation through it.

## Tests (26 passing)

- `password.test.ts` — hash round-trip, wrong password, unique salts, malformed hashes.
- `auth.test.ts` — register/me, duplicate email 409, invalid payload 400, slug dedup,
  login/logout, forged + missing cookies 401.
- `users.test.ts` — system role seeding, member 403 vs admin 200, deactivation revokes
  sessions, last-admin protection (both paths), cross-org role assignment blocked,
  custom roles, unknown permission rejection.
- `rls.test.ts` — cross-tenant invisibility, zero rows without tenant context,
  cross-tenant write blocked (42501), tenant-scoped audit entries.

Integration tests run against `crm_test`, sequentially (shared database), with truncation
between tests.

## Known limitations (deliberate, revisit later)

- No password reset / email verification (no email infrastructure until Prompt 11).
- Sessions don't roll (fixed 7-day expiry).
- Permission set is loaded per request (two queries); caching is a Prompt 21 concern.
