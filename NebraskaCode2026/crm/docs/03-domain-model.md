# Prompt 3 — Domain Model

Business logic lives in services (`apps/api/src/modules/*/service.ts`, from Prompt 5 on) and
never in repositories; repositories move data, services decide. The vocabulary and state
machines below are code in `packages/shared/src/domain.ts`, shared by API and web.
Properties are listed by business meaning; physical columns are in `docs/02-database.md`.

Conventions that apply to every tenant entity, stated once:

- **Tenancy rule:** every entity belongs to exactly one Organization; cross-organization
  references are invalid in all cases.
- **Provenance:** created/updated timestamps and acting-user ids are maintained
  automatically; every mutation is audit-logged.
- **Soft delete:** business records are archived (`deletedAt`), never destroyed by users;
  archived records are excluded from lists/search, restorable, and hard-purged only by
  explicit administrative action. Applies to: Account, Contact, Lead, Deal, Activity, Task,
  Project, Document.

---

## Organization

- **Purpose:** the tenant; the isolation boundary for every other entity.
- **Properties:** name, slug (URL identity).
- **Relationships:** has Users, Roles, and all tenant data.
- **Business rules:** slug is globally unique and immutable after creation. Deleting an
  organization purges the tenant completely (the only true cascade delete in the product).
- **Validation:** name 1–200 chars; slug lowercase kebab, 2–63 chars.
- **Lifecycle / transitions:** created → active. No state machine in scope (no
  billing/suspension in the PRD).

## User

- **Purpose:** a person who signs in and acts inside one organization.
- **Properties:** email, name, password hash, active flag.
- **Relationships:** belongs to Organization; has Roles (many-to-many); owns Accounts,
  Contacts, Deals, Projects; is assigned Tasks; has Sessions.
- **Business rules:** email is the login identity, globally unique (case-insensitive). Users
  are **deactivated, never deleted** — history must keep pointing at them. A deactivated
  user cannot sign in and their sessions are revoked immediately; their record ownership is
  unaffected until reassigned.
- **Validation:** valid email; name 1–100 chars; password policy enforced at auth boundary
  (Prompt 4), never stored in the domain.
- **Lifecycle / transitions:** invited/created → active ⇄ deactivated.

## Role & Permission

- **Purpose:** what a user may do. Permission = one capability (global catalog, seeded).
  Role = an org-scoped named set of permissions.
- **Properties:** role: name, description, isSystem; permission: code, description.
- **Relationships:** Role belongs to Organization, aggregates Permissions, granted to Users.
- **Business rules:** system roles (Admin at minimum) are created with the organization and
  cannot be edited or deleted. Every organization must always have at least one user holding
  the Admin role. Permission checks always evaluate inside the caller's organization.
- **Validation:** role name 1–50 chars, unique per organization.
- **Lifecycle / transitions:** none (configuration, not state).

## Account

- **Purpose:** a company the organization sells to or serves; the hub every other customer
  record hangs off.
- **Properties:** name, domain, website, industry, phone, description, owner, custom values.
- **Relationships:** has Contacts, Deals, Projects, Activities (via links), Tasks, Documents,
  AI artifacts, a Timeline.
- **Business rules:** name required; domain is the matching key for Prompt 11's email→company
  matching, so it's stored normalized (lowercase, no protocol). Archiving an account leaves
  children untouched but hides the account from lists; purging an account takes its deals,
  projects, and record-scoped content with it.
- **Validation:** name 1–200; domain a bare hostname; website a valid URL; custom values
  validated against Custom Field Definitions.
- **Lifecycle / transitions:** active ⇄ archived (soft delete). No status machine — pipeline
  state lives on Deals, not Accounts.

## Contact

- **Purpose:** a person, usually at an account; whom activities and deals actually involve.
- **Properties:** first/last name, email, phone, title, account, owner, custom values.
- **Relationships:** optionally belongs to an Account; participates in Deals
  (deal-contacts, with role and primary flag); linked from Activities; has a Timeline.
- **Business rules:** may exist without an account (e.g. auto-created from an email, Prompt
  11) and be attached later. Email is the dedup/matching key: creation flows warn on an
  existing same-email contact in the organization but don't hard-block (people share
  inboxes). Detaching from an account never deletes the contact.
- **Validation:** first+last name required; email syntactically valid when present; phone
  stored as entered (display formatting is UI concern).
- **Lifecycle / transitions:** active ⇄ archived.

## Lead

- **Purpose:** an unqualified hand-raiser; deliberately separate from Account/Contact so the
  CRM stays clean until qualification.
- **Properties:** person fields (name, email, phone), company, source, status, owner,
  custom values, conversion pointers (account/contact/deal, converted at).
- **Relationships:** standalone until conversion; conversion creates/links Account +
  Contact and optionally a Deal. Linked from Activities and Tasks; has a Timeline.
- **Business rules:** conversion is **one-way and atomic**: qualify → convert produces the
  target records in one transaction, stamps the pointers, and freezes the lead (terminal
  `converted`). A lead needs at least a name or a company to exist. Disqualified leads keep
  their history and can be re-worked.
- **Validation:** email valid when present; status per state machine.
- **Lifecycle / transitions (`leadTransitions`):**
  `new → working|qualified|disqualified`, `working → qualified|disqualified`,
  `qualified → converted|disqualified`, `disqualified → working`, `converted` terminal.

## Pipeline & Pipeline Stage

- **Purpose:** the configurable sales process; stages carry the process semantics.
- **Properties:** pipeline: name, default flag, order. Stage: name, order, default
  probability (0–100), isWon, isLost flags.
- **Relationships:** Pipeline has ordered Stages; Deals reference both.
- **Business rules:** exactly one default pipeline per organization; a new organization gets
  a seeded default pipeline. A pipeline needs ≥1 open stage, ≥1 won stage, ≥1 lost stage to
  be usable. A stage may be won or lost, not both. Stages/pipelines in use by deals cannot be
  deleted (DB-enforced RESTRICT) — they're reordered or renamed instead.
- **Validation:** names 1–100, unique in scope; probability 0–100; won stages imply
  probability 100, lost imply 0.
- **Lifecycle / transitions:** configuration, no state machine.

## Deal

- **Purpose:** a revenue opportunity moving through the pipeline; the forecasting unit.
- **Properties:** name, account, pipeline, current stage, status, amount + currency,
  probability override, expected close date, closed at, win/loss reason, owner, custom
  values.
- **Relationships:** belongs to Account; involves Contacts (with roles, one primary);
  accumulates Stage History, Activities, Tasks, Documents, AI artifacts; has a Timeline.
- **Business rules:**
  - Effective probability = explicit override if set, else current stage's default.
  - Expected revenue = amount × effective probability (forecasting, Prompt 6).
  - Every stage change writes a Stage History row (from, to, who, when) — this is business
    data, not audit.
  - Moving into a won/lost stage sets status accordingly, stamps `closedAt`, and — for
    lost — requires a win/loss reason. Won requires an amount.
  - Reopening (won|lost → open) clears `closedAt` and reason, and returns the deal to an
    open stage; allowed for correction, always audit-logged.
  - Stage and pipeline must belong together; changing pipeline requires choosing a stage in
    the new pipeline.
- **Validation:** name 1–200; amount ≥ 0 with 2 decimals; currency ISO-4217 code;
  probability 0–100; close date a calendar date.
- **Lifecycle / transitions (`dealStatusTransitions`):** `open → won|lost`,
  `won|lost → open` (correction only). Stage-to-stage movement within open is free-form
  (any order — sales reality), each move recorded.

## Activity

- **Purpose:** a record of something that happened — email, call, meeting, or note; the raw
  material of the timeline and of every AI feature.
- **Properties:** type, direction (for email/call), subject, body, occurred at,
  type-specific metadata (participants, duration, recording ref…).
- **Relationships:** linked to any number of Accounts, Contacts, Deals, Leads, Projects via
  activity links (each link targets exactly one record); source for AI artifacts; feeds
  Timeline entries.
- **Business rules:** activities are historical facts — they get corrected, not
  re-lived: `occurredAt` is when it happened, not when it was logged. Every activity
  produces one timeline entry per linked record. An activity with zero links is allowed
  transiently (e.g. inbound email awaiting matching) but the goal state is ≥1 link.
- **Validation:** type required; subject 1–300; occurredAt not in the far future (> 1 day).
- **Lifecycle / transitions:** created → (edited) → archived. No status machine.

## Task

- **Purpose:** something someone must do; the only entity with a deadline and an assignee.
- **Properties:** title, description, status, priority, due at, reminder at, completed at,
  assignee, related record (account/contact/deal/lead/project, milestone).
- **Relationships:** optionally tied to one primary related record; in projects, optionally
  scheduled under a Milestone and ordered by Task Dependencies (DAG).
- **Business rules:** completing stamps `completedAt`; reopening clears it. Reminders fire
  only for open/in-progress tasks. A task cannot depend on itself and dependency cycles are
  rejected (checked at edit time). Project tasks respect dependencies: a task isn't
  startable until its dependencies are completed (advisory in UI, enforced on Kanban/Gantt
  moves in Prompt 14).
- **Validation:** title 1–200; reminder ≤ due when both set; status/priority from enums.
- **Lifecycle / transitions (`taskTransitions`):** `open ⇄ in_progress`, either →
  `completed|canceled`, `completed|canceled → open` (reopen).

## Project

- **Purpose:** post-sale delivery — onboarding and implementation work for an account.
- **Properties:** name, description, account, status, start/due dates, completed at, owner,
  custom values.
- **Relationships:** belongs to Account; has Milestones and Tasks (with dependencies);
  Activities and Documents link to it; has a Timeline; customer-visible via portal
  (Prompt 14).
- **Business rules:** typically born from a won deal (Prompt 14 onboarding), but creatable
  standalone. Completing a project requires all milestones completed or explicitly waived
  (confirmation). Status drives portal visibility: only active/on_hold/completed projects
  appear to customers.
- **Validation:** name 1–200; start ≤ due when both set.
- **Lifecycle / transitions (`projectTransitions`):** `planned → active|canceled`,
  `active → on_hold|completed|canceled`, `on_hold → active|canceled`,
  `completed → active` (reopen), `canceled → planned` (revive).

## Milestone

- **Purpose:** a named checkpoint that groups project tasks and anchors the Gantt view.
- **Properties:** name, due date, status, display order.
- **Relationships:** belongs to Project; Tasks optionally attach to it.
- **Business rules:** completing a milestone requires its tasks completed/canceled.
  Deleting a milestone detaches its tasks (they survive).
- **Validation:** name 1–200.
- **Lifecycle / transitions (`milestoneTransitions`):** `pending ⇄ in_progress`,
  either → `completed`, `completed → in_progress` (reopen).

## Document

- **Purpose:** a file attached to a customer record; searchable content (Prompt 17).
- **Properties:** name, mime type, size, storage path, uploader, related record.
- **Relationships:** attached to one Account, Contact, Deal, or Project; may source a
  Timeline entry.
- **Business rules:** storage path is opaque to the domain (local disk now, pluggable
  backend later — Prompt 0 clarification #8). Documents are immutable blobs: replacing
  content = new document version (new row), metadata (name) is editable.
- **Validation:** name 1–255; size > 0; mime type present.
- **Lifecycle / transitions:** uploaded → (archived).

## Timeline Entry

- **Purpose:** the product's spine — one chronological, append-only stream answering
  "what has happened with this record?"
- **Properties:** entry type (open vocabulary: `activity.email`, `deal.stage_changed`,
  `ai.summary`, …), occurred at, actor, summary line, structured detail, target record
  refs, source refs (activity/document/AI artifact).
- **Relationships:** targets ≥1 business record; optionally points at its source object.
- **Business rules:** entries are **written only by services as a side effect of domain
  events** — never directly by users, never edited, never deleted (they disappear only when
  their target is purged). Rendering order is `occurredAt` desc; ties broken by id (uuidv7 =
  creation order).
- **Validation:** summary 1–500; ≥1 target ref (DB-enforced).
- **Lifecycle / transitions:** append-only; none.

## Custom Field Definition

- **Purpose:** tenant-defined schema extension for accounts, contacts, deals, leads,
  projects (Prompt 18 builds the full no-code layer on this).
- **Properties:** entity type, key, label, field type, required flag, options (for selects),
  rules (Prompt 18: visibility/requiredness rules), display order, active flag.
- **Relationships:** belongs to Organization; values live inside each entity's `custom` map.
- **Business rules:** key is immutable once created (values reference it); deactivating
  hides the field but preserves stored values; type changes are forbidden (create a new
  field instead). Required-ness is enforced on create/update of the target entity, but only
  for user-driven writes — AI proposals surface missing required fields instead of failing.
- **Validation:** key snake_case 1–63; label 1–100; select types require ≥1 option; values
  validated by field type on every entity write.
- **Lifecycle / transitions:** active ⇄ inactive.

## AI Artifact (incl. Proposal)

- **Purpose:** every AI output, first-class and inspectable: summaries, insights
  (MEDDIC/BANT/risks, Prompt 10), copilot conversations, and — critically — **proposals**:
  suggested record changes awaiting human review.
- **Properties:** kind, status, title, payload (structured, kind-specific), model + token
  counts + cost, source activity, target record refs, reviewer + reviewed at.
- **Relationships:** belongs to Organization; about ≤1 each of Account/Contact/Deal/Lead/
  Project; sourced from an Activity; may produce a Timeline entry.
- **Business rules:** the product's central invariant — **AI never mutates records
  directly.** Only kind `proposal` carries mutations; applying one happens through the same
  services a human write uses (validation, audit, timeline included), stamps reviewer, and
  is the only path to status `applied`. Non-proposal kinds are born `approved`. Every
  artifact records model and cost (Prompt 8 tracking). Rejected proposals are kept — they
  are training signal and audit trail.
- **Validation:** payload shape validated per kind (Zod schemas arrive with Prompts 8–10);
  cost/tokens non-negative.
- **Lifecycle / transitions (`aiProposalTransitions`):** `pending → approved|rejected`,
  `approved → applied`, `rejected`/`applied` terminal.

---

## Cross-entity rules

1. **Separation of concerns:** services own every rule above; repositories only persist.
   The web app never re-implements a rule — it imports the same enums/state machines from
   `@crm/shared` for UX (disable invalid buttons), while the API remains the enforcer.
2. **Transactionality:** multi-record operations (lead conversion, deal stage change +
   history + timeline, proposal application) are single transactions.
3. **Timeline completeness:** any domain event a seller would care about produces exactly
   one timeline entry per affected record — the Prompt 5 service layer provides one
   `timeline.record()` API so modules can't drift.
4. **Ownership:** `owner`/`assignee` must be an active user of the same organization.
