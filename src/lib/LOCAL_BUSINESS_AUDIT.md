# Local Businesses — pipeline audit (Phase C1)

## Pipeline map

1. **Discover** — OSM Overpass + Geoapify/Foursquare directory mode (`local-businesses.functions.ts`)
2. **Normalize** — `leadToRow` → name/phone/email/website/domain; junk + craft filters
3. **Dedupe** — key = `name|phone|domain` (stronger than name-only)
4. **Website provenance** — `listed` | `verified_no_website` | `unreachable` | `unknown`
5. **Contacts** — shared `discoverContactsForDomain` (+ Cheerio fallback)
6. **Opportunity tags** — `deriveOpportunityTags` (no Lighthouse; heuristics only)

## Capability gap matrix

| Capability                  | Status                                                  |
| --------------------------- | ------------------------------------------------------- |
| Place discovery (Tier A/B)  | Working via OSM + places APIs                           |
| Website presence provenance | P0 shipped (`website_status` + tags)                    |
| Contact harvest             | Routed through shared Contact Intelligence              |
| SEO heuristics              | HTTPS / thin / missing meta → `seo_poor` / `weak_https` |
| Explainable score           | Sort prefers verified email + phone; score from sources |
| Lighthouse                  | Deferred (worker + cost)                                |
| Maps ToS scrapers           | Out of scope                                            |

## Baseline

Use `scripts/verify-local-baseline.mts` (fixtures) and `scripts/probe-local-places.mts` / `smoke-all-features.mts` for live Tier A/B probes.
