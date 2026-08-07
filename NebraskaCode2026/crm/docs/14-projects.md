# Prompt 14 — Projects

Post-sale project management: projects, milestones, tasks, dependencies, Kanban, Gantt,
customer portal, project timeline, customer onboarding.

## Projects & milestones

- CRUD with the domain-model lifecycle enforced (`projectTransitions`): planned → active →
  on_hold/completed/canceled, reopen and revive paths included. **Completing a project with
  incomplete milestones is blocked** unless the caller passes `waiveMilestones: true` (the
  domain's "explicitly waived" rule); completion stamps `completedAt`, reopening clears it.
- Milestones: ordered, dated, `milestoneTransitions` enforced; **completing a milestone with
  open tasks is blocked**; completion writes a `project.milestone_completed` timeline entry.
  Deleting a milestone detaches its tasks (FK set-null), never deletes them.
- Timeline entries throughout (`project.created/updated/status_changed/completed`), including
  fan-out to the account (and deal, for onboarding projects).

## Task dependencies

- `POST /api/tasks/:id/dependencies` — same-project only, self-dependency rejected, and
  **cycle detection** via graph walk (a→b→c→a is a 400 with a clear message).
- **Blocked enforcement** lives in the tasks service: a task cannot move to in-progress or
  completed while any dependency is still open — the error names the blockers. Canceled
  dependencies count as satisfied (they will never complete).

## Kanban & Gantt

- `GET /api/projects/:id/board` — tasks grouped by status with `dependsOn`, a computed
  `blocked` flag, and milestone names. The web Kanban drags tasks between status columns
  (server-validated — blocked moves bounce with the error).
- `GET /api/projects/:id/gantt` — computed date range, milestones, and tasks with
  start/due/dependencies. Rendered as a hand-rolled SVG chart (month ticks, milestone
  diamonds, status-colored task bars) — no chart library.

## Customer onboarding

`POST /api/deals/:id/create-project` — **won deals only**: creates the onboarding project on
the deal's account (owner inherited) with four seeded milestones (Kickoff +7d,
Implementation +30d, Training +45d, Go-live +60d) and a `project.created` timeline entry
visible from the deal. Won deals show a "🚀 Start onboarding project" button.

## Customer portal

- New `portal_tokens` table, deliberately **outside RLS** (like sessions): a portal visitor
  has no tenant context, so the token itself is the capability — the lookup resolves the
  organization, then everything runs under normal RLS.
- `POST /api/projects/:id/portal` issues (and rotates) a token; `DELETE` revokes.
- `GET /api/portal/:token` — fully unauthenticated, customer-safe fields only: project
  name/status/dates, milestones, task progress counts. **Planned/canceled projects are
  invisible** per the domain visibility rule; revoked or unknown tokens 404.
- Public web page at `/portal/:token` (outside the authenticated shell): progress bar,
  milestone checklist, no internal data.

## Tests

- API (148 passing, 13 new): lifecycle + waiver + reopen, clean completion, milestone
  task-guard + timeline, milestone deletion detaching tasks, dependency add/self/cycle/
  cross-project rejections, blocked-start enforcement with unblocking, board grouping with
  blocked flags, Gantt range math, onboarding milestones + deal timeline + non-won
  rejection, portal round-trip (anonymous fetch, task counts, portalEnabled flag), portal
  visibility rules (planned hidden, revocation, bad token).
- E2E (24 total, 3 new): create project → milestone → task → Kanban drag → Gantt render;
  portal enabled in one browser context and verified in a **fresh unauthenticated context**.
