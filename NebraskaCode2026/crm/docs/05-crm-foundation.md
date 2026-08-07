# Prompt 5 — CRM Foundation

The first working CRM: organizations (Prompt 4), accounts, contacts, timeline, activity
logging. No AI features.

## API

| Route | Permission | Notes |
|---|---|---|
| `GET /api/accounts` | accounts:read | search (`query` over name+domain, ilike, escaped), filter (`industry`, `ownerId`), sort (`name/createdAt/updatedAt` asc/desc), pagination (`page`, `pageSize` ≤ 100), stable tie-break ordering |
| `POST /api/accounts` | accounts:write | domain normalized to bare hostname (`https://www.Acme.COM/x` → `acme.com`) |
| `GET/PATCH/DELETE /api/accounts/:id` | read/write | PATCH: explicit `null` clears a field; DELETE = archive (soft) |
| `POST /api/accounts/:id/restore` | accounts:write | |
| `GET /api/accounts/:id/timeline` | accounts:read | paginated, newest first |
| `/api/contacts` (same verb set) | contacts:* | filter by `accountId`; duplicate-email creates **warning, not block**; account link validated in-org |

Behaviors shared by both modules:

- **Every mutation** runs in one tenant transaction (`withOrg` → RLS) and writes an
  `audit_log` row (with field-level diff on update) plus a timeline entry via the single
  `recordTimeline()` write path.
- Contact entries target contact **and** its account — one row, both timelines.
- Archived records: hidden from lists, visible in detail (restorable), un-editable (404 on
  PATCH).
- Cross-cutting error handling is one Fastify error handler mapping domain errors
  (`ValidationError`/`NotFoundError`/`ConflictError`/`RequestValidationError`) to
  400/404/409 — routes just throw.

## Web app

React SPA (react-router 8, TanStack Query 5): login/register page; nav shell with org name +
sign-out; accounts list (live search, industry filter, pagination, inline create); account
detail (edit form, contacts card, timeline, archive/restore); contacts list (search,
create with account picker, duplicate-email warning surfaced); contact detail (edit,
account link, timeline). Zod contracts and DTO types come from `@crm/shared` — the UI and
API cannot drift silently.

## Tests

- **API integration (44)**: CRUD, domain normalization, validation, unknown owner,
  archived-record semantics, pagination stability across pages, search by name/domain/email,
  industry filter + sort, tenant isolation end-to-end (list + direct fetch), dup-email
  warnings, foreign-account link rejection, timeline ordering and cross-record visibility.
- **E2E (Playwright, chromium)**: full journey — register org → create account (domain
  normalization visible in UI) → edit → contact creation with account link → both timelines
  → search hit/miss → sign-out. Runs against `crm_test` with its own truncate+reseed setup;
  API and Vite servers auto-started (ports 3001/5174; 5173 left to the long-running dev
  process on this machine).

Total: 46 API+unit tests, 8 shared tests, 2 e2e specs — all passing.

## Notes / debts

- `custom` jsonb is accepted verbatim; validation against custom-field definitions arrives
  with Prompt 18.
- Playwright boots webServers **before** globalSetup — the e2e setup reseeds the permission
  catalog after truncation for this reason (comment in `e2e/global-setup.ts`).
- react-router 8.3 warns about Node 22.22+; running 22.20 — works, upgrade Node at leisure.
