# Prompt 13 — Telephony

Browser telephony on the simulated-provider architecture: click-to-call, recording,
transcription, timeline, call disposition, AI summaries, follow-up generation.

## Provider abstraction

`TelephonyProvider` (`initiateCall`) with `FakeTelephonyProvider` as the default — it
"places" the call and returns a provider call id plus a recording URL. A Twilio (or
similar) adapter implements the same interface; its status/recording/transcription
webhooks call the same completion service. No telephony account required to run the
product.

## Call lifecycle

1. **Click-to-call** — `POST /api/calls {contactId, dealId?, accountId?}`: requires the
   contact to have a phone number (400 otherwise), places the call through the provider,
   and opens an **in-progress call activity** linked to the contact, its account
   (inherited automatically), and optionally a deal — timeline entries fan out
   immediately.
2. **Completion** — `POST /api/calls/:activityId/complete {durationSeconds, disposition?,
   recordingUrl?, transcript?}`: stamps duration/recording/disposition into the call's
   metadata with an audit row; double-completion is rejected. When the call was linked to
   a deal, completion triggers the (debounced) Active CRM re-analysis.
3. **Transcription → AI** — a transcript is persisted as the call's body and routed
   through the **Prompt 9 capture pipeline** (`sourceType: call_transcript`): AI summary
   artifact + timeline entry, action items, and pending proposals — including
   **follow-up email drafts** (follow-up generation) and suggested tasks. Async via
   pg-boss when the runner is up, inline otherwise. Zero new AI plumbing.
4. **Disposition** — `POST /api/calls/:activityId/disposition` sets or corrects
   `connected / voicemail / no_answer / busy / wrong_number` with optional notes,
   audit-logged; 404 for non-call activities.

## Web

Contact detail gains a **Phone card** (softphone stand-in): 📞 Call → in-progress panel
with duration, disposition, and optional transcript → "Hang up & log". With a transcript,
the AI summary lands on the timeline via the background job.

## Tests

- API (135 passing, 7 new): provider invocation + in-progress activity + inherited account
  link, no-phone rejection, completion metadata + no-LLM-without-transcript, transcript →
  summary + `create_task` + `followup_email` proposals + persisted body, double-completion
  rejection, disposition set/correct with enum validation, non-call 404.
- E2E (21 total, 2 new): click-to-call from the contact page → hang up with transcript →
  call entry and AI summary on the timeline (background-job path; the test reloads until
  the async artifact lands, since the timeline view doesn't live-poll).

## Notes

- "Recording" is a stored URL from the provider; the fake generates a placeholder. Real
  playback arrives with a live adapter.
- Live transcription would arrive on the provider webhook and call the same completion
  endpoint — the interface point is already in place.
