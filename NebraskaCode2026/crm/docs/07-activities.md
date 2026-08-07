# Prompt 7 — Activities

Emails, calls, meetings, notes, tasks, reminders — related to accounts, contacts, deals,
leads, and projects — all surfaced in one chronological timeline.

## Activities

- `POST/GET/PATCH/DELETE /api/activities` (+ `/restore`). Types: email, call, meeting, note;
  optional direction (inbound/outbound); free-form `metadata` jsonb (duration, participants —
  Prompts 11–13 will use it).
- **Links**: an activity relates to any number of accounts/contacts/deals/leads/projects
  (`activity_links`, one row per target, all validated in-org). At least one link required.
- **`occurredAt` is history, not log time** — it drives timeline position; backdated
  activities sort where they happened.
- List endpoint filters by any linked entity (`EXISTS` on the link table), type, and
  full-text-ish subject/body search.

### Timeline projection (deliberate append-only exception)

Timeline rows sourced from an activity are **projections**: one row per linked record,
carrying the activity's summary and occurredAt. Editing an activity (subject, time, links)
rebuilds its projections; archiving removes them; restoring recreates them. Rationale: a
corrected activity must not leave stale history — the activity is the fact, its timeline rows
are a view. All other timeline entries remain append-only. Implemented in one place
(`rebuildTimelineRows`, activities service).

## Tasks & reminders

- `POST/GET/PATCH/DELETE /api/tasks`. Defaults: assignee = creator, priority normal.
- Status changes validated against `taskTransitions` (completed/canceled reopen to open;
  canceled → completed is illegal). Completing stamps `completedAt`; reopening clears it.
- **Reminders** are data: `reminderAt` must be ≤ `dueAt`; the reminders view is
  `GET /api/tasks?open=true&dueBefore=…`. Actual notification delivery requires the
  background-job runner (Prompt 8) and the workflow engine (Prompt 15) — documented debt.
- Related records: direct FKs to account/contact/deal/lead/project (validated); linked task
  creation/completion writes a single timeline row targeting every linked record;
  unlinked tasks stay off the timeline.
- Sorting puts null due-dates last; overdue is a client-side derivation.

## One chronological timeline

- Per-record: `GET /api/{accounts|contacts|deals|leads}/:id/timeline` — record events, stage
  changes, activities, and task events interleave by `occurredAt` (uuidv7 id as tie-break).
- Org-wide: `GET /api/timeline` — the same stream across the whole organization.

## Web

- **ActivityComposer** on account, contact, and deal detail pages: type toggle
  (note/call/meeting/email), subject + notes, one click to log against the open record.
- **Tasks page**: My tasks / Everyone toggle, open-only by default with include-completed
  switch, overdue highlighting, checkbox complete/reopen, create form with due/reminder/
  priority and account/deal pickers.
- Timeline component: labels + icons for all entry types.

## Tests

- API (76 total, 17 new): link requirement + in-org validation, multi-link fan-out (one entry
  per record's timeline), occurredAt ordering, projection sync on edit, projection move on
  link replacement, archive/restore round-trip, entity/type filters + search, org feed
  chronology; task defaults, reminder-after-due rejection, state machine (including illegal
  canceled→completed), completedAt lifecycle, timeline entries for linked tasks only,
  open/dueBefore/account filters, assignee + link validation, nulls-last due sorting.
- E2E (9 total, 3 new): log a call from the account page → timeline; create linked task →
  complete from the tasks list → account timeline shows created + completed alongside the
  earlier call.
