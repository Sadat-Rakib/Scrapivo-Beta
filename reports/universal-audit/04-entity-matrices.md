# Entity / industry / people / social / enrichment matrices

## Business (local)

| Capability | Status | Sources | Notes |
|------------|--------|---------|-------|
| Overture file retrieve | PARTIAL | `local_businesses_{iso}.jsonl` | 91 files |
| OSM Overpass | PARTIAL | `osm-local-businesses.server.ts` | Needs category+location |
| Geoapify / Foursquare | PARTIAL | adapters exist | Legacy fan-out / optional |
| Craft extract nouns | PARTIAL | BUSINESS_NOUNS | Missing coffee roasters, yoga studios, many trades |
| Semantic craft→OSM tag | PARTIAL | osm craft map | Coffee→cafe exists downstream; extract never reaches it |
| No-website filter | PARTIAL | opportunity criterion | Works when entity=business |

## Company

| Capability | Status | Sources | Notes |
|------------|--------|---------|-------|
| S3 / companies JSONL | PARTIAL | companies_complete + parquet | business_model filter empties many |
| D2C/B2B/B2C extract | PARTIAL | extractBusinessModel | Forces company entity; founders lose role |
| Live discovery | BROKEN | none in live-gapfill | |
| Startup extras | PARTIAL | startup-sources, dealroom, YC import | Not on default thin path |

## People / roles

| Capability | Status | Notes |
|------------|--------|-------|
| Role extract | PARTIAL | ROLE_AFTER missing `ctos?` plural |
| People S3 | PARTIAL | Matrix shows rows; industry filters thin |
| Live people | BROKEN | live-none |
| Title hierarchy | MISSING | No semantic family map beyond regex |
| Role hallucination controls | PARTIAL | Directory rows; LLM titles not primary on spec path |

## Jobs

| Capability | Status | Notes |
|------------|--------|-------|
| Live fleet | PARTIAL | provider-jobs + live-jobs |
| Title sanitize | BROKEN | `&#x28;` hex entities not decoded |
| Clarifier | PARTIAL | Role-only ready; location optional |
| Why-match | PARTIAL | Hardcoded “Open role” |

## Social / signals

| Adapter | Status on spec path | Status on legacy path |
|---------|---------------------|------------------------|
| Reddit RSS / PullPush / ScrapeCreators | UNUSED | PARTIAL |
| Social dorks | UNUSED | PARTIAL |
| SearXNG webboolean | UNUSED by gapfill | PARTIAL |
| Stealth LinkedIn/IG/FB | UNUSED | PARTIAL if worker up |
| YouTube transcripts | UNUSED | PARTIAL |
| Fediverse | UNUSED | PARTIAL |
| freehire Telegram | SEPARATE | Jobs only |
| Signal → structured lead | MISSING / WEAK | Lead has snippet; Discover SpecRow lacks evidence URL field usage |

## Enrichment (exact fields today)

| Field | Who fetches | Gate |
|-------|-------------|------|
| email / phone from site | enrich-incomplete → discoverContacts | person/investor/job incomplete only |
| page text | scrape/stealth workers | legacy enrichLeadsFromUrls |
| bio / social | contact-finder / website-bio | opt-in deep enrich |
| why_match | deriveWhyMatch | often null for browsing businesses |
| location compose | naive join address+locality+region+country | duplicates tokens |

Business/company **name-only** completeness → enrich-before-show **does not run**.
