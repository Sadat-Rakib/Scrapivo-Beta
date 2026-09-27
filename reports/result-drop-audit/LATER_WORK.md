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


## PRODUCT-COMPLETION PASS — COMPLETED (2026-09-26)

Moved OUT of deferred (implemented, verified in battery):
- ~~Persistent browser worker~~ → PlaywrightBrowserAdapter behind AgentBrowser
  (SCRAPIVO_BROWSER_ADAPTER=cli forces legacy). One browser/run, ~50-150ms per
  action; C founders yield 3→9 verified.
- ~~Browser viewer (Scrapy mini browser)~~ → screenshot-based in-product
  viewer (scrapy-browser.tsx) + session registry + owner-scoped state endpoint.
- ~~Row-level progress streaming~~ → verified leads stream as typed events
  with payload; UI shows "✓ verified while researching" lines.
- ~~Investor retrieval~~ → broad-then-enrich; REQUIRED.investor=[]; token
  sector matching; I1 20/20 in 12s, I2 real AI-infra investors.
- ~~Off-topic routing~~ → deterministic domain boundary (weather etc.) at ~0.3s.
- ~~Home mascot hero~~ → page-mascot cat (local assets), personalized greeting.
- ~~Stage timings~~ → retrievalTrace.timings + [spec-run] log.

STILL DEFERRED (real future work):
- Browser candidate research concurrency >1 (multi-page per run).
- Pause/resume + Take Control UI (session status protocol already typed).
- Dynamic widening rounds (discovery → re-discovery on low yield).
- TTL cache layer + staleness-aware read-back of write-back rows.
- Deep signal research phase for D-type queries.
- Generic entity-driven result table columns (current tables are per-entity).
- Right-dock desktop Scrapy panel (inline card ships today).
