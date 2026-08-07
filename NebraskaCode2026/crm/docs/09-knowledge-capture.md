# Prompt 9 — Automatic Knowledge Capture

Email / meeting transcript / call transcript in → summary, action items, timeline entries,
suggested updates, suggested tasks, suggested follow-up email out — with human approval
before anything changes. This phase also builds **the generic proposal pipeline** that
Prompts 10, 11, 13, and 20 reuse.

## Flow

1. **`POST /api/capture`** (`ai:use`) — `{sourceType, subject?, content, occurredAt?, and
   ≥1 of accountId/contactId/dealId/leadId}`.
2. **The source is a fact** — it is recorded immediately as an activity (email/meeting/call)
   with timeline entries on every linked record. No approval needed to *remember* something.
3. **Analysis** — one structured LLM call (`knowledge.capture` prompt; CRM context for the
   linked records is serialized into the prompt so suggestions are grounded). Output schema
   (`captureAnalysisSchema` in `@crm/shared`) is enforced server-side via structured outputs.
   - With a job runner (production `server.ts`): capture returns `202 {status: "queued"}` and
     analysis runs as a pg-boss job; `GET /api/captures/:activityId` is the poll endpoint.
   - Without one (tests, embedded): analysis runs inline and returns `200` with results.
4. **Summary** → `ai_artifacts` kind `summary`, born `approved` (changes no records), plus an
   `ai.summary` timeline entry on every linked record.
5. **Suggestions** → one `ai_artifacts` kind `proposal` (status `pending`) each:
   `update_field`, `create_task`, `followup_email`. Suggestions that can't be applied safely
   are dropped at creation: field not on the whitelist, or no linked entity of that type.

## The approval workflow

- `GET /api/proposals?status=` (`ai:use`) — the review queue.
- `POST /api/proposals/:id/approve` (`ai:review`) — validates the state machine
  (`pending → approved → applied`), **applies the change through the normal service layer**
  (`updateDeal`, `createTask`, `createActivity`, …) so validation, audit logging, and
  timeline entries are identical to a human edit, then marks the artifact `applied` with
  reviewer + timestamp. Apply failure leaves the proposal `pending` and returns the error.
- `POST /api/proposals/:id/reject` — `rejected`, reason stored; rejected proposals are kept
  (audit trail + future training signal).
- Field whitelist (enforced at both creation and apply): account
  `industry/description/phone/website/domain`, contact `title/phone/email`, deal
  `amount/expectedCloseDate/probability/name`. Deal values are coerced + validated
  (amount number, probability 0-100, date `YYYY-MM-DD`).
- Follow-up emails apply as **outbound draft activities** (`metadata.draft: true`) until
  Prompt 11 brings real sending.

## Web

- **Capture page** (`/capture`): source-type toggle, record pickers, paste content →
  summary + action items + sentiment and per-proposal Approve/Reject cards; polls while
  background analysis runs.
- **Approvals page** (`/approvals`): pending/applied/rejected queue — the "AI never changes
  records directly" review inbox.
- Timeline renders `ai.summary` entries (🤖).

## Tests

- API (101 total, 9 new): capture creates activity + summary + timeline entries; whitelist
  and unlinked-entity suggestions dropped; link requirement; approve-applies-through-services
  (deal amount actually changes, `deal.updated` timeline entry present); task creation with
  due date/priority/links; follow-up draft activity; reject stores reason and applies
  nothing; state machine (no double-approve, no reject-after-apply); tenant isolation.
- E2E (12 total, 3 new): capture through the **real async path** (202 → pg-boss worker →
  poll → summary render), source + AI summary on the account timeline, approvals queue page.
- The non-strict fake provider synthesizes schema-valid placeholder output, so the entire
  flow works offline with no API key; unit tests use the strict fake with scripted analyses.

## Notes

- Job worker registration lives in `server.ts` (`JOBS_ENABLED=false` to force inline mode).
- Playwright's globalSetup truncates after the server boots — it reseeds both the permission
  catalog **and** the prompt registry (second occurrence of this trap; documented in the
  setup file).
