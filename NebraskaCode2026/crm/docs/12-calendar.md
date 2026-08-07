# Prompt 12 — Calendar Integration

Google/Microsoft calendar sync on the simulated-provider architecture: automatic meeting
creation, timeline updates, attendee matching, AI meeting preparation, meeting summaries.

## Provider abstraction

`CalendarProvider` (`createEvent`) with `FakeCalendarProvider` as the default. Google
Calendar / Microsoft Graph adapters implement the same interface; inbound sync arrives via
the webhook stand-in `POST /api/calendar/events`, which real adapters call after signature
verification. No OAuth apps are required to run the product.

## Inbound ingestion (`POST /api/calendar/events`)

1. **Dedup** by `providerEventId` (200 + `duplicate: true` on redelivery).
2. **Attendee matching**: each attendee email → known contact (bringing its account); the
   requesting user's own email is excluded; unknown attendees at corporate domains match
   accounts by domain; personal-mail domains never match. Unmatched attendees are kept in
   metadata — matching only, no auto-creation (per the prompt's wording).
3. **Automatic meeting creation**: a `meeting` activity with `occurredAt = startsAt`
   (future-dated is deliberate — scheduled meetings sort to the top of the timeline),
   metadata carrying start/end/location/attendees/organizer, linked to every matched
   contact and account → timeline entries fan out per record.
4. Events with **no CRM linkage at all are rejected** (400) — a meeting the CRM can't
   attach to anything is noise.

## Outbound (`POST /api/calendar/events/create`)

Creates the event through the provider, then runs the same ingestion locally — one code
path for both directions. Optional explicit `accountId`/`dealId` links.

`GET /api/calendar/upcoming` lists future meetings ordered by start time with attendees and
matched record ids.

## Meeting preparation (`POST /api/meetings/:id/prepare`)

Serializes what the CRM knows — meeting details, linked account/contacts, recent
interactions — into the `calendar.prepare` prompt; one structured call returns objectives,
talking points, open questions, risks, and per-known-attendee notes (schema-enforced,
grounded-only). Stored as a `summary` artifact (`payload.type = meeting_prep`), retrievable
via `GET /api/meetings/:id/prep`, with an `ai.meeting_prep` timeline entry on the linked
records.

## Meeting summaries (`POST /api/meetings/:id/summarize`)

Post-meeting transcript → persisted onto the meeting activity's body, then routed through
the **Prompt 9 capture pipeline** (`sourceType: meeting_transcript`) — summary artifact,
action items, and pending proposals all attach to the meeting activity. Async via pg-boss
when the job runner is up, inline otherwise. Full reuse; zero new AI plumbing.

## Web

**Meetings page** (`/meetings`): schedule form (title, times, attendees, account) going
through the provider, upcoming list with attendee counts and account links, and a per-meeting
**Prepare** button rendering objectives/talking points/questions/risks/attendee notes inline.

## Tests

- API (137 total, 9 new): matched attendees + timelines, domain-only matching with
  unmatched attendee bookkeeping, no-linkage rejection, provider-event dedup, upcoming
  ordering, outbound create-then-ingest through the fake provider, prep artifact round-trip
  + timeline entry, non-meeting rejection, transcript → capture pipeline with proposals and
  persisted body.
- E2E (19 total, 2 new): schedule a meeting via the UI → appears in upcoming with the
  matched attendee → Prepare renders the prep card.

## Notes

- The e2e API server now runs `NODE_ENV=test` (the suite's sign-in volume exceeded the
  login rate limit that protects real deployments; integration tests already ran this way).
- Recurring events, reschedule/cancel sync, and free-busy are provider-adapter concerns
  deferred until a live adapter lands.
