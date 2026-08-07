# Prompt 8 — AI Foundation

The AI abstraction layer. No AI workflows yet — Prompts 9, 10, 13, and 20 build on this.

## Provider abstraction (`apps/api/src/ai/`)

- **`LlmProvider`** interface: `complete`, `completeStructured` (Zod schema → validated
  object), `stream` (delta callback + final result). **`EmbeddingProvider`**: `embed`.
- **`AnthropicProvider`** — the default implementation (`@anthropic-ai/sdk`):
  - Default model `claude-opus-4-8` (configurable via `AI_MODEL`; per-call override).
  - Adaptive thinking on every request; `max_tokens` defaults to 16 000.
  - Structured outputs via `client.messages.parse()` + `zodOutputFormat` — schema
    enforcement happens server-side, not by prompt-begging.
  - Streaming via `messages.stream()` + `finalMessage()`.
- **`FakeLlmProvider`** — deterministic test double: queue text/structured responses,
  `failNext(n)` to exercise retries; unqueued structured calls throw rather than invent
  schema-shaped data. **`FakeEmbeddingProvider`** — hashed character trigrams, L2-normalized,
  256-dim: stable, offline, similar-text-similar-vector.
- Provider selection (`config.AI_PROVIDER`): `auto` (default — Anthropic when
  `ANTHROPIC_API_KEY` is set, fake otherwise), `anthropic`, `fake`. Tests inject providers
  through `buildApp({ llm, embedder })`.

## AiService — the mandatory gateway

Feature code never calls a provider directly; `app.ai` wraps every call with:

- **Retry policy**: exponential backoff, max 2 retries, retrying 429/5xx/transport errors
  only (the SDK's own 2 retries sit beneath this).
- **Logging**: one `ai_calls` row per logical call — provider, model, operation, purpose
  (e.g. `knowledge.summarize_email`), prompt name, token usage, **cost** (rate card in
  `pricing.ts`: Fable $10/$50, Opus 4.8 $5/$25, Sonnet 5 $3/$15, Haiku $1/$5 per MTok),
  latency, attempt count, success/error. Failures are logged too.
- `GET /api/ai/usage?days=` — totals + per-purpose aggregation for the org.

## Prompt management

`ai_prompts` (global, not tenant-scoped): name → versioned system/user templates. Code
defaults seed at boot (insert-only, so operator edits survive deploys); `{{var}}` rendering
with hard errors on missing variables; `PUT /api/ai/prompts/:name` bumps the version.
Feature prompts register in `DEFAULT_PROMPTS`.

## Conversation history

`ai_conversations` + `ai_messages` (RLS-scoped; messages via EXISTS delegation): create,
append (user/assistant/system), fetch ordered, list per user. Storage layer for the
Prompt 20 copilot.

## Embeddings

`ai_embeddings`: per-entity chunked vectors stored as `real[]`. **pgvector is not installed
on this server** (checked `pg_available_extensions`), so similarity is app-side cosine over
the org's vectors — O(n) per query, fine at demo scale. Upgrade path documented: install
pgvector → `vector(n)` column + HNSW index → move ranking into SQL. `upsertEntityEmbeddings`
replaces an entity's chunks; `searchSimilar` ranks org-wide with optional type filter.

## Background jobs

`createJobRunner` (pg-boss 10, `pgboss` schema in the same database — no Redis):
`enqueue(name, data, {retryLimit, retryDelaySeconds})` with default policy 3 retries +
exponential backoff; `work(name, handler)`; graceful `stop()`. Workers register in
`server.ts` as later prompts add them; tests run their own runner against `crm_test`.

## Tests (92; 1 gated)

Pricing math, prompt seed/render/missing-var/version-bump, service logging (usage, latency,
attempts), retry-then-succeed and give-up-and-log-failure paths, structured output
validation, stream accumulation, conversation CRUD + tenant isolation, embedding determinism
and ranking, embed-call logging, usage endpoint aggregation, pg-boss enqueue/process and
fail-twice-then-succeed retry. A live Anthropic smoke test runs only when
`ANTHROPIC_API_KEY` is set (skipped otherwise) — the deterministic suite never spends money.

## Notes

- Add `ANTHROPIC_API_KEY` to `crm/.env` to switch the app from fake to live AI — no code
  change needed (`AI_PROVIDER=auto`).
- Anthropic has no embeddings endpoint; when live semantic search matters (Prompt 17), add a
  Voyage AI adapter behind `EmbeddingProvider`.
