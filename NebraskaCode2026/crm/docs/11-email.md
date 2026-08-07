# Prompt 11 — Email Integration

Inbound, outbound, threading, automatic contact creation, automatic company matching,
duplicate detection, timeline integration, AI summarization — on the approved
**simulated-provider architecture**: real interfaces, in-repo fake transport, no OAuth apps
required to run the product.

## Provider abstraction

`MailProvider` (`modules/email/provider.ts`): `send(message) → {providerMessageId}`.
Default implementation is `FakeMailProvider` (records sent messages; tests inspect them).
Gmail / Microsoft Graph adapters implement the same interface when live sync is wired;
inbound arrives through `POST /api/email/inbound`, which stands in for a signed provider
webhook and calls the same ingest service a real adapter would.

## Inbound pipeline (`ingestInboundEmail`)

1. **Duplicate detection** — provider message id lookup; redeliveries return the existing
   activity (`200 {duplicate: true}`), one activity per message guaranteed.
2. **Company matching** — sender domain → account `domain` column (the normalized field from
   Prompt 5 exists for exactly this). A dozen personal-mail domains (gmail, outlook, …)
   never match, even if an account claims them.
3. **Contact creation** — sender email → existing contact (no duplicates); unknown senders
   get a contact auto-created with the name parsed from the display name or the email local
   part (`sam_smith@` → Sam Smith), attached to the matched account. Known contacts
   contribute their account when domain matching found none.
4. **Threading** — `inReplyTo` → parent's thread; else normalized subject (Re:/Fwd: stripped
   recursively) + same counterpart → most recent matching thread; else a new thread key.
   Thread metadata lives on the email activity (`metadata.threadKey`);
   `GET /api/email/threads/:threadKey` returns the conversation in order.
5. **Timeline** — the email is recorded as an inbound activity linked to contact + account
   (Prompt 7 fan-out puts it on both timelines).
6. **AI summarization** — bodies ≥ 200 chars run through the Prompt 9 capture pipeline
   (same job, same artifacts, same approval flow for any suggestions); trivial emails skip
   the LLM entirely.

## Outbound

- `POST /api/email/send` — sends via the provider, records an outbound activity with links
  (recipient auto-matched to a contact when not specified), threads correctly:
  `inReplyToActivityId` reuses the parent's thread key and passes the provider message id as
  `inReplyTo` to the transport.
- `POST /api/email/drafts/:activityId/send` — the Prompt 9 follow-up drafts become real:
  transmits via the provider, clears `metadata.draft`, stamps `sentAt`; re-sending a
  non-draft is rejected.

## Web

Contact detail gains an email composer (visible when the contact has an address): subject +
message → sent through the provider → appears in the timeline as an outbound email.

## Tests

- API (120 total, 12 new): subject normalization; auto-created contact with parsed names
  (display-name and local-part paths); domain matching links account + contact and lands on
  the account timeline; personal domains never match; known-sender dedup; provider-id
  duplicate detection; summarization gate (long analyzed / short skipped) via the capture
  pipeline; threading by reply-id and by subject fallback plus new-thread separation; thread
  endpoint ordering; outbound send with provider inspection + timeline; reply threading with
  `inReplyTo` propagated to the transport; draft send + flag clearing + double-send
  rejection.
- E2E (17 total, 3 new): send from the contact page → timeline; simulated inbound webhook →
  contact auto-created and searchable → email on their timeline.

## Notes

- Live adapters remain the documented next step: OAuth + webhook verification per provider,
  calling the identical service functions. Nothing in the pipeline assumes the fake.
- The inbound route currently authenticates as a user session; real webhooks will use
  provider signatures instead (noted for Prompt 22's security review).
