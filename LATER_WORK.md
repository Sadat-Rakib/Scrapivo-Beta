# Later work (parked, do not build during Batches 1–3 / Intent v1)

- **Unverified-leads section**: leads with no evidence currently hidden; later show
  them below verified results, clearly labeled unverified.
- **Personalized questions full flow**: offer capture exists (mode + offer);
  deeper personalization (industry jargon, budget, timeline slots) comes later.
- **Embeddings / vector search**: deferred; craft/alias maps suffice for now.
- **BullMQ / PostGIS / background workers**: deferred; intent runs inline with caps.
- **browser-use agentic fallback**: deferred; Crawl4AI + Playwright cover fetching.
- **Audit-gated LLM writer**: reuse `personalize.server.ts` pattern when needed.
- **90-country hosted load**: local index is 90-country; hosted holds the demo
  slice until a bigger DB is chosen.

## Deferred Browser UX / Reliability — AFTER core V1 result delivery

- Restore visible browser action progress in `/discover`: searching, opening,
  navigating, scrolling, extracting, and researching candidates.
- Consider a mini-browser/session viewer for inspectable activity without
  exposing hidden model reasoning.
- Add conservative, site-respectful pacing and rate limiting. Detect rate
  limits, bot challenges, login walls, and CAPTCHAs; pause or skip rather than
  bypassing site protections.
- Add human-in-the-loop pause, resume, and takeover for legitimate user action.
- Improve telemetry for URL, action, page state, elapsed time, retries, and
  failure reason.
- This work is deferred until discovery → enrichment → qualification → output
  reliably returns results. Do not implement stealth, fingerprint evasion,
  CAPTCHA bypass, or login-control bypass.

## Data-asset pass — deferred follow-ups (2026-09-27)

- Real-Postgres replay of the frozen search-job sequence: the acceptance asserts
  the fake store's lease/claim semantics plus the migration SQL textually
  (FOR UPDATE SKIP LOCKED, unique upserts); a live Supabase harness is deferred.
- Wire `createSearchJob` (TanStack server fn, auth-gated) into an offline
  harness — the acceptance replicates its frozen context-pinning block through
  the same `store.update` call instead of calling the fn.
- Thread `createReuseRun()` into the real passRunner (parent workstream's
  documented wiring point); the acceptance drives reuse invariants via a
  scripted indexer double over the real freshness TTLs.
- Add a live-fire check of the outbox's ambiguous-delivery path against real
  provider adapters (Resend/Slack); covered offline by adapter overrides.
