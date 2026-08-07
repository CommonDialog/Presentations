# Prompt 0 — Architect Analysis

Source PRD: the 23 prompts (0–22), per Chris's direction. No other requirements document exists.
Status: **awaiting approval — no code written.**

## 1. Executive summary

An AI-native, multi-tenant CRM. Core CRM records (accounts, contacts, leads, opportunities,
activities, tasks) sit on a unified chronological timeline. Communication channels (email,
calendar, telephony) sync into that timeline. An AI layer analyzes every interaction and
**proposes** changes — summaries, field updates, tasks, follow-ups, MEDDIC/BANT assessments —
but never commits them without human approval. Post-sale work continues in a project module
with a customer portal. A workflow engine, dynamic reporting, natural-language search, no-code
customization, external integrations, and a copilot complete the product. Built in 23 phases,
ending with performance optimization and a principal-architect review.

## 2. Functional modules

| Module | Prompts | Scope |
|---|---|---|
| Identity & Tenancy | 4 | Organizations, users, roles, permissions, row-level security, tenant isolation, audit logging |
| Core CRM | 5 | Accounts, contacts, CRUD, search, filtering, pagination, timeline, activity logging |
| Sales Pipeline | 6 | Leads, opportunities, stages, probability, forecasting, stage history, win/loss, drag-and-drop board |
| Activities & Timeline | 7 | Emails, calls, meetings, notes, tasks, reminders; one chronological timeline across all records |
| AI Platform | 8 | Provider abstraction, prompt management, conversation history, structured outputs, streaming, embeddings, background jobs, retries, logging, cost tracking |
| Knowledge Capture | 9 | Email/meeting/call transcripts → summary, action items, timeline entries, suggested updates/tasks/follow-up email; approval workflow |
| Active CRM Engine | 10 | Continuous analysis: MEDDIC, BANT, buying signals, risks, competitors, next actions, decision makers, pipeline health, confidence; propose-only |
| Email Integration | 11 | Inbound/outbound sync, threading, auto contact creation, company matching, dedup, AI summarization |
| Calendar Integration | 12 | Google + Microsoft, meeting creation, attendee matching, prep, summaries |
| Telephony | 13 | Browser click-to-call, recording, transcription, disposition, AI summaries, follow-ups |
| Projects | 14 | Projects, milestones, tasks, dependencies, Kanban, Gantt, customer portal, onboarding |
| Workflow Engine | 15 | Triggers, conditions, actions (email, tasks, notifications, AI, project), reusable workflows |
| Reporting | 16 | Sales dashboards, forecasts, win rates, velocity, stalled deals, revenue, activity, project/customer health; dynamic generation |
| Global Search | 17 | All entities + emails + documents + AI summaries; natural-language queries |
| Customization | 18 | Custom fields, dynamic layouts, progressive disclosure, field rules, record types, validation; no code |
| Integrations | 19 | LinkedIn, Slack, Teams, webhooks, REST API, import/export, enrichment providers |
| AI Copilot | 20 | Q&A, account summaries, meeting prep, email drafts, next actions, risk prediction, report generation, navigation, explainability; no fabrication |
| Cross-cutting | 2, 21, 22 | Documents, custom fields, AI artifacts, soft delete, auditing; performance; final review |

## 3. Core domain model

Entities named in the prompts:

- **Organization** — tenant boundary. Everything below is organization-scoped.
- **User** — belongs to an organization; has roles/permissions.
- **Role / Permission** — authorization model incl. row-level security.
- **Account** — a company. Has contacts, opportunities, activities, projects, documents.
- **Contact** — a person, usually tied to an account; matched from email/calendar attendees.
- **Lead** — pre-qualified prospect; converts into account/contact/opportunity.
- **Opportunity (Deal)** — pipeline record: stage, probability, expected revenue, stage history, win/loss reason. (Prompt 2 says "Deals," Prompt 6 says "Opportunities" — treated as one entity; naming to be confirmed.)
- **Activity** — email, call, meeting, or note; linked to accounts, contacts, opportunities, projects; feeds the timeline.
- **Task** — standalone or activity-derived; reminders; also exists inside projects.
- **Project / Milestone** — post-sale delivery; task dependencies; customer-visible via portal.
- **Document** — files attached to records; searchable.
- **Timeline entry** — the unified chronological stream; written by every module.
- **Custom field (+ values)** — customer-defined schema extensions; record types and layout rules.
- **AI artifact** — summaries, extracted insights, proposals, copilot conversations, embeddings, cost records.
- **Proposal (pending change)** — the approval-workflow object AI produces instead of direct writes (Prompts 9, 10). Implied by "human approval workflow," modeled explicitly.

Key structural decisions this model forces:

1. **The timeline is the spine.** Nearly every module writes to it; it must be an append-only, polymorphic stream designed once, early (Prompt 5), not retrofitted.
2. **AI never writes records.** All AI output lands as artifacts/proposals; a single approval pipeline serves Prompts 9, 10, 11, 13, and 20.
3. **Tenancy is pervasive.** Every table carries the organization key; row-level security from Prompt 4 onward.

## 4. Architectural risks

1. **The proposal/approval pipeline is the load-bearing wall.** Five later prompts depend on it. If Prompt 9's design is ad hoc, Prompt 10+ forces a rewrite.
2. **Timeline coupling.** One table written by ~10 modules; contention, ordering, and polymorphism need deliberate design in Prompt 2, not Prompt 7.
3. **External providers need real credentials.** Gmail/Microsoft Graph OAuth apps, a telephony provider, Slack/Teams apps, enrichment APIs. LinkedIn in particular has no generally available API for this use — that item may only be achievable as a stub or manual import.
4. **Custom fields vs. everything else.** The storage choice (EAV vs. JSON columns) ripples into search, filtering, reporting, validation, and layouts. Deciding it in Prompt 2 avoids pain in Prompt 18.
5. **Continuous AI analysis cost.** Prompt 10 says "continuously analyze." Naive implementation re-analyzes on every event; needs debouncing, incremental context, and the Prompt 8 cost tracking to be real.
6. **Frontend scope.** Drag-and-drop pipeline board, Kanban, Gantt, dynamic layouts, customer portal, copilot chat — the UI is a product in itself.
7. **Breadth vs. depth.** The 23 prompts describe a multi-year commercial product. The realistic risk is shallow vertical slices that Prompt 22 then indicts. Mitigation: keep each phase's scope honest and let the final review say so.

## 5. Areas needing clarification

Decision-critical (blocking Prompt 1):

1. **Tech stack.** Prompt 1 says "solution organization," which smells like .NET — confirm stack before scaffolding.
2. **LLM provider.** Abstraction is required regardless; which provider is the default implementation?
3. **Real vs. simulated external services.** Do email/calendar/telephony/Slack/enrichment integrate against live providers (OAuth apps, paid accounts) or against an in-repo simulated provider behind the same interfaces? This decides half the effort in Prompts 11–13 and 19.
4. **Database.** A Postgres connection is available in this environment — assume PostgreSQL?

Non-blocking (resolve at the named prompt):

5. Lead/Deal/Opportunity naming (Prompt 2/6).
6. Customer-portal identity — are portal customers Users, or a separate principal? (Prompts 4, 14.)
7. "Fully tested" bar — unit + integration? A coverage target? (Prompt 5.)
8. Document storage backend — local disk vs. cloud blob storage. (Prompt 2.)
9. Call-recording consent/compliance handling. (Prompt 13.)
10. Import/export formats. (Prompt 19.)
11. Expected data volumes / tenant count for Prompt 21's load-testing targets.

## 6. Suggested implementation order

The prompt sequence 0→22 is dependency-correct as written. Callouts:

- **Prompt 2 must pre-decide** custom-field storage, timeline shape, soft delete, and auditing even though their features land later — schema churn is the most expensive churn.
- **Prompt 8 is a hard gate** for 9–13 and 20; nothing AI ships before the abstraction, job runner, and cost tracking exist.
- **Prompt 9's approval workflow should be built as the generic proposal pipeline**, then reused verbatim in 10, 11, 13, 20.
- Prompts 11–13 (email/calendar/telephony) are order-independent among themselves.
- Defer nothing from 4 (security) — retrofitting tenancy is a rewrite.

## 7. Assumptions

1. The 23 prompts are the complete PRD; no features beyond them will be invented.
2. Project lives at `NebraskaCode2026/crm` in the existing repo (approved).
3. Single web application; no native mobile.
4. English-only UI.
5. One organization's data never visible to another — full multi-tenancy, not workspaces-lite.
6. "Deals" and "Opportunities" are one entity.
7. AI proposals share one approval pipeline product-wide.
8. No Docker/containers anywhere in the deployment strategy unless explicitly requested.
9. Each prompt is a working increment: the app runs and its tests pass at every phase boundary.
10. Chris approves each phase before the next begins.
