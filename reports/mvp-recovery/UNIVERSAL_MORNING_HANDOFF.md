# UNIVERSAL MORNING HANDOFF — 2026-10-04

## What was generalized?
- Business discovery queries are now derived from the user's category string (6 families, no trade vocabulary).
- Deterministic extraction handles first-party entity pages AND directory/list pages for ANY category — no extraction LLM needed.
- Semantic trade matching: "heating and cooling" matches "HVAC" via trade-family intersection.
- Person cards normalize via subject-bound role fields (no founder/CEO vocabulary).
- The research queue scales with the requested count (was capped at 6).

## What actually works now?
- PC1 Calgary plumbers: 50 delivered end-to-end.
- PC3 Calgary businesses: 3 delivered, browser-supplied, first-party domains.
- HVAC Toronto / Cebu photographers: 2 each delivered — first live-browser conversions, below target.
- Cebu extraction→normalization: 10/10 with zero rejections, LLM-free.
- Premature zero, unexplained CANCELLED, target-cap: all fixed and regression-tested.

## What still fails?
- Live-browser delivered counts are below requested targets (2/10, 2/5, 3/5). First loss: contact-research trigger for website-less candidates + contact-need wiring in computeResearchNeeds.
- Signal queries (hiring) are acquisition-thin.

## MVP ready? NOT YET — the delivery machinery is proven; the contact-research trigger is the last P0 wire.
## Investor demo ready? NO — several consecutive diverse searches must succeed first.

## Commit to test: `3c6b110` (rc/mvp-local-testing-baseline)
Start: `SCRAPIVO_LOCAL_NO_PERSIST=true SCRAPIVO_BROWSER_ADAPTER=worker npm run dev -- --port 8080` (warm 60-90s).

## Five new queries to try (never used in development)
1. Find 8 commercial kitchen equipment suppliers around Kuala Lumpur, need websites and a way to contact them, prefer smaller companies
2. Find pest control companies in Phoenix with phone numbers
3. Find immigration lawyers in Vancouver with public contact information
4. need like 7 hvac companies around toronto/gta, need sites and numbers, real ones i can actually contact
5. Find landscape architects in Melbourne with websites
