# Solutions research (Phase D)

For each CRITICAL/HIGH gap: **reuse first**, then OSS/API.

## CRITICAL: company/person live-none

| Candidate | Verdict |
|-----------|---------|
| A. Reuse `searchWebBoolean` / SearXNG inside `live-gapfill` | **CHOOSE** — already in-tree, env-gated, buyer filters optional for directory |
| B. Call full `searchAllSources` from spec path | Too heavy / slow; keep as optional force |
| C. New OpenMagpie/Scout clone | Reject until A fails |
| D. browser-use agent | Defer (LATER_WORK) |

**Decision:** Implement `defaultWeb` in `live-gapfill.ts` for `company`/`person` (and business fallback when OSM empty) mapping SERP hits → SpecRows with url evidence.

## CRITICAL: enrich-before-show

| Candidate | Verdict |
|-----------|---------|
| Tighten completeness for business/company | **CHOOSE** — require phone\|email\|url\|explicit no_website |
| Always run discoverContacts on every row | Too expensive; cap remains 8 |

## HIGH: extract/clarify

Single lexicon fixes in `search-spec-extract.ts` + clarifier `mentionsPlace` — no new package.

## HIGH: social OSS (Scout / OpenMagpie / Harken)

| Project | In workspace? | Role |
|---------|---------------|------|
| Scout | Patterns only | Keep contact harvest; don’t clone CLI |
| OpenMagpie | No | Evaluate later if social signal backlog remains after SearXNG reconnect |
| Harken | No | Same |
| In-tree reddit/social-dorks | Yes | Prefer reconnect on legacy/spec hybrid |

**Decision:** Do not add new deps in Phase E. Document as Phase G+ research.

## Geo expansion

Reuse Overture pipeline + OSM; no paid Maps dependency required for MVP live fill.

## Roles

Evidence hierarchy: official site > registry > directory > LLM. Spec path already directory-first; do not add LLM title invent.
