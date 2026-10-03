# Phase A — positive-control evidence (Final-MVP PRD, 2026-10-03)

Post-Phase-D-first-fix runs through the real UI (`evidence/runs/PC{1,2,3}.json`):

## PC1 — "Find 5 plumbers in Calgary with public phone numbers." → **50 delivered, PASS**
funnel: raw 51 → deduped 50 → relevant 51 → enriched 50 → qualified 50 → **delivered 50**; TARGET_REACHED; ledger `unaccounted: 0`.
Proves the delivery machinery works end-to-end (understand → discover → relevant → enrich → qualify → deliver → UI). Supply was stored-corpus (local businesses DB) — the browser-live conversion criterion is judged on PC3/PC2.

## PC3 — "Find 5 local businesses in Calgary with a public phone number and website." → 0 delivered, HONEST_ZERO (partially improved)
Pre-fix: 10 relevant → 10 enriched → 0 qualified, `missing: contact_or_site` ×9.
Post-contact-pass: raw 163 → deduped 154 → **relevant 5 → enriched 5 → pending_enrichment 3**, `missing: contact_or_site` ×3, ledger closed.
The relevance gate narrows correctly; the remaining weak link is **domain discovery**: the slug-guess probe (name→.com/.co/.io) rarely resolves small-business sites, so the new /contact pass rarely triggers. Next: Pass 4 contact search queries ("<Name> Calgary contact") and discovered-link navigation (per the PRD's contact discovery order).

## PC2 — "Find SaaS companies currently hiring Account Executives in Toronto." → 0 delivered, HONEST_ZERO (signal)
raw 2 → 1 → relevant 0 → `UNPROVEN_CRITERION`. The loss is ACQUISITION WIDTH for signal queries — the query family for hiring-signal discovery produced ~2 candidates. Next: signal query families (PRD §13) in the widening ladder.

## Funnel conversion (PRD §16) — PC1 as the healthy reference
discovered 51 → parsed 51 → deduped 50 → relevant 51 → enriched 50 → qualified 50 → delivered 50 (100% conversion once candidates carry the required evidence — the machinery is proven; the gap is candidate SUPPLY for live queries, i.e. domain/contact discovery and signal query width).
