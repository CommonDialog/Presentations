# Prompt 10 — Active CRM

Continuous deal analysis: MEDDIC, BANT, buying signals, risks, competitors, next actions,
decision makers, pipeline health, confidence score. **Never modifies records; always
proposes.**

## The engine

`analyzeDeal` (src/modules/active/service.ts):

1. **Context** — the deal (fields, effective probability), account, deal contacts with
   roles, stage history, open tasks, and the last 10 interactions (bodies truncated) are
   serialized into the prompt. The engine reasons over evidence, not vibes — the prompt
   requires absent evidence to be reported as "not present", never invented.
2. **One structured call** (`active.analyze` prompt, `activeInsightSchema` enforced
   server-side): six MEDDIC pillars + four BANT pillars (each `present` + one-line
   assessment), signals, risks with severity, competitors, decision makers with champion
   flags, 0-3 next actions, `health` (healthy/at_risk/critical), `confidence` 0-100
   (clamped app-side), and reasoning.
3. **Storage** — an `ai_artifacts` kind `insight` row per analysis (history preserved;
   `GET /api/deals/:id/insight` returns the latest).
4. **Timeline discipline** — an `ai.insight` entry is written only on the first analysis or
   a health *change*; re-analysis at the same health stays silent (no timeline spam).
5. **Propose, never write** — next actions become `create_task` proposals in the Prompt 9
   pipeline, **deduped against pending proposals by title** so repeated analysis doesn't
   stack copies. Zero tasks exist until a human approves (tested).

## "Continuously"

Triggers enqueue a debounced background job (`pg-boss` `singletonKey = deal id`,
5-minute window — at most one analysis per deal per window regardless of event volume):

- logging an activity linked to a deal,
- capturing an email/transcript linked to a deal,
- moving a deal between stages,
- on-demand: `POST /api/deals/:id/analyze` (202 with jobs, inline 200 without).

Cost control is inherited from Prompt 8: every analysis is an `ai_calls` row with cost, so
`GET /api/ai/usage` shows exactly what the continuous engine spends per purpose.

## Web

Deal detail gains an **AI insight card**: health badge + confidence, reasoning, MEDDIC/BANT
checklists (hover for assessments), buying signals, severity-colored risks, competitor and
decision-maker lines, and a pointer to Approvals when next actions were proposed.
"Analyze deal" triggers the background job and the card polls until the new insight lands.

## Tests

- API (108 total, 7 new): full insight round-trip, next-action → pending proposal with zero
  tasks pre-approval, latest-insight supersession, timeline only on first/changed health
  (three-analysis sequence), proposal dedupe across analyses, confidence clamping,
  approve-creates-task through the pipeline, tenant isolation + null-before-analysis.
- E2E (14 total, 2 new): create deal → Analyze → insight card renders (health badge,
  MEDDIC/BANT) via the real job path → `ai.insight` on the deal timeline.

## Notes

- Decision makers/competitors are detection only (stored in the insight); linking a contact
  role from a detection could become a new proposal type later without schema changes.
- In inline mode (no job runner) automatic triggers are no-ops; analysis is on-demand.
