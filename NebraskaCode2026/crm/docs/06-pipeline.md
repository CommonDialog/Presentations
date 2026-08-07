# Prompt 6 — Opportunity Pipeline

Leads, deals, stages, probability, forecasting, expected revenue, stage history, win/loss
reasons, drag-and-drop board, timeline integration.

## Pipeline & stages

Every new organization is seeded (inside the registration transaction) with a default
**Sales Pipeline**: Qualification 10% → Discovery 25% → Proposal 50% → Negotiation 75% →
Closed Won 100% (won) / Closed Lost 0% (lost). `GET /api/pipelines` lists pipelines with
ordered stages. Pipeline management UI is deliberately deferred (settings territory,
Prompt 18); stages in use are delete-protected at the database level.

## Deals

- `POST /api/deals` — created in the first open stage (or a given open stage); creating
  directly in a won/lost stage is rejected. Writes the initial stage-history row.
- **Effective probability** = per-deal override ?? current stage probability.
  **Expected revenue** = amount × effective probability. Both computed server-side and
  returned on every DealDto (with `accountName` for display).
- `POST /api/deals/:id/move` — the only way to change stage (PATCH cannot). Enforces:
  won requires an amount; lost requires a `winLossReason`; won↔lost jumps are illegal
  (`dealStatusTransitions`) — reopen first; reopening clears `closedAt` + reason. Every
  move writes `deal_stage_history` + audit + a typed timeline entry
  (`deal.stage_changed` / `deal.won` / `deal.lost` / `deal.reopened`).
- `GET /api/deals/:id/history` — full stage history with stage names (creation row included).
- Deal contacts: link/unlink with role + single-primary invariant (`isPrimary` on one row at
  a time). Feeds Prompt 10's decision-maker tracking.
- `GET /api/deals/board?pipelineId=` — stages × deals with per-column total and weighted
  amounts. `GET /api/deals/forecast` — per-open-stage rows plus openCount/openAmount/
  weightedForecast/won/lost aggregates.
- List endpoint: search, pipeline/stage/status/account/owner filters, sort, pagination.

## Leads

- CRUD with the "name or company" existence rule (enforced on create and post-merge on update).
- `POST /api/leads/:id/status` — `leadTransitions` state machine enforced; `converted` is
  unreachable here (convert endpoint only).
- `POST /api/leads/:id/convert` — **one transaction**: reuse or create the account, create a
  contact when the lead has a person name, optionally create a deal (linked to the contact as
  primary), stamp conversion pointers, freeze the lead (edits rejected afterward). Only
  qualified leads convert.
- Conversion reuses the same in-transaction insert helpers as the normal create endpoints
  (`insertAccount` / `insertContact` / `insertDeal`), so audit, timeline, and validation are
  identical on both paths.

## Web

- **Pipeline board** (`/deals`): forecast strip (open, weighted, won, lost), native HTML5
  drag-and-drop between columns, per-column totals; dropping on Closed Lost opens a
  loss-reason prompt (required, cancellable); new-deal form.
- **Deal detail**: edit (amount, probability override, close date), stage move with loss
  reason, linked contacts with primary badge, full stage history, timeline.
- **Leads** (`/leads`): list with status filter + badges, create form; **lead detail** with
  status action buttons driven by the shared state machine (invalid actions simply don't
  render), convert flow with optional deal, links to converted records, timeline.

## Tests

- API (59 total, 15 new): seeding, effective probability + expected revenue math, override
  precedence, closed-stage creation rejection, history rows, won-requires-amount,
  lost-requires-reason, lost→won blocked, reopen clears fields, board grouping + weighted
  totals, forecast aggregates, single-primary contacts, lead state machine, unqualified
  conversion rejection, atomic conversion (account/contact/deal/primary link/frozen lead),
  convert-into-existing-account.
- E2E (6 specs): lead create → qualify → convert; board drag between stages with live
  forecast updates (DataTransfer-dispatch pattern — synthesized mouse DnD is flaky);
  loss-reason dialog cancel path; win via detail page; complete history verification.
