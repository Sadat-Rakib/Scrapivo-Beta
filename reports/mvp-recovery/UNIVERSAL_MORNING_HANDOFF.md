# UNIVERSAL_MORNING_HANDOFF.md — 2026-10-04

## What architecture was generalized this session?
1. **Business query families** (source-plan.ts): business discovery now generates 6 category-derived variants (`{category} {location}`, `{category} companies {location}`, `{category} services {location}`, `{category} directory {location}`, `{category} contact {location}`, `{category} near {location}`) — all derived from the user's own category string. No trade vocabulary.
2. **Discovery pass width**: the browser pass executes up to the planner's own maxQueries bound (was a flat 6).
3. **Deterministic local-entity extraction** (from the prior session, landed + fixtures green): first-party single-entity mode + directory list mode, spec-category as the trade anchor.

## What the holdout found (the honest part)
The holdout reruns (HVAC Toronto + Cebu photographers) after the universal families landed: **every browser query still EXTRACTION_EMPTY (ent=0)** — SERPs succeeded, pages were navigated, but the deterministic layer yielded 0.
Root cause (committed, `7a759e8`): `deterministicLocalEntities.hasTrade()` matches the user's literal category tokens against page text. Reached pages describe the trade with SYNONYMS ("heating and cooling" vs "HVAC"). **The fix is precisely scoped**: extend `hasTrade` in `deterministicLocalEntities` to also accept `tradeFamilyOf(line) === tradeFamilyOf(category)` using the TRADE_FAMILIES map already landed in `src/lib/canonical/businesses.server.ts` (6bf6d31 — hvac/heating/cooling family exists). One import + one OR clause + tests.

## What should the owner personally test first?
After the hasTrade fix lands (next session's first task), run these five never-seen queries:
1. `Find 8 commercial kitchen equipment suppliers around Kuala Lumpur, need websites and a way to contact them`
2. `Find pest control companies in Phoenix with phone numbers`
3. `Find immigration lawyers in Vancouver with public contact information`
4. `need like 7 hvac companies around toronto/gta, need sites and numbers, real ones i can actually contact`
5. `Find video production studios in Montreal with websites`

## State
- Branch `rc/mvp-local-testing-baseline`, HEAD `7a759e8`.
- Gates at close: typecheck 43 frozen, last full-vitest NEW_FAILURES=0, deterministic fixtures 5/5.
- Verdict: **NOT MVP READY** (holdout exposed the semantic category gap; everything else in the funnel is instrumented and the fix is one scoped edit).
- Dev server start: `SCRAPIVO_LOCAL_NO_PERSIST=true SCRAPIVO_BROWSER_ADAPTER=worker npm run dev -- --port 8080`, warm 60-90s.
