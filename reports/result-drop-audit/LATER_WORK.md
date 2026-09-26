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
