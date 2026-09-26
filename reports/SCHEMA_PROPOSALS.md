# SCHEMA + CATEGORY PROPOSALS (for approval — NO transformation run)

Mapping decisions (machine-readable): `reports/mappings/*.json`.
Verification checklist per cohort: source rows = cleaned + incomplete; mapping/null
deltas; duplicate stats; representative records; drops/renames; type consistency
→ `reports/<cohort>_verification.md`. Exports: `exports/<entity>_sample_200.csv` only.

## P1 — PEOPLE (canonical LOCKED by user; mapping proposed, pending approval)

Source columns: First Name, Last Name, Title, Comp name, Website, Email, Phone,
Comp Phone, Employees, Pers Linkedin, Comp Linkedin, Facebook, Twitter, Country,
Industry, Tech Used, Keywords, SEO Description.

| canonical | source | transform | drop? |
|---|---|---|---|
| Name | First Name + Last Name | trim, collapse spaces, Title-case preserved | — |
| Title | Title | trim, null-like→null (`-`, `n/a`, `unknown`) | — |
| Company Name | Comp name | trim, suffix-normalize (Inc/Inc./LLC case-insensitive) for matching only (display preserved) | — |
| Website | Website | lowercase host, strip tracking params, null-like→null | — |
| Email | Email | lowercase, trim, RFC-shape check (score, not reject) | — |
| Phone | Comp Phone ONLY | E.164-normalize where possible (score, not reject) | — |
| Employees | Employees | numeric-range parse (`1-10`, `50+`) else raw string | — |
| Personal LinkedIn | Pers Linkedin | URL-normalize, must match linkedin.com/in/ shape for full pts | — |
| Company LinkedIn | Comp Linkedin | URL-normalize, company shape for full pts | — |
| Facebook/Twitter/Country/Industry | same | trim; Country→ISO2 map (unmatched kept raw + flagged); Industry→canonical taxonomy proposal after seeing values | — |
| Tools Used | Tech Used | split on `,|;|/`, trim, dedupe, keep raw string too | — |
| — | Phone (personal) | NEVER carried (privacy rule) | DROP |
| — | Keywords, SEO Description | not identity/contact signal | DROP |

`Company vs Company Name vs Organization` (multi-file case): unify ONLY after value
evidence (shared domains/addresses/LinkedIn) recorded in mapping file; else separate.

## P2 — INVESTORS (proposal; both raws preserved in `raw/investors/`)

Sources: `investors_merged.json` (8098, dirty) + `investors_complete.jsonl` (1252,
old-bar). Canonical proposal: `id, name, kind(individual|firm), firm, role/title,
location{raw,city,country}, stages[], sectors[], check_min/max_usd, email, linkedin,
website, image_url, bio, bio_source, bio_scope, provenance[], quality_score{+components}`.
Adapters (not truth): `cheque_size"$25K-$500K"`→min/max parse; `investment_stages/
investment_sectors/investment_locations`→canonical arrays; `profile_photo.local_path`→
image_url fallback w/ low confidence; free-string `type`→kind mapper (unmapped→`unknown`,
never dropped). Old `completeness>=8` NOT a filter — replaced by quality score +
sufficient/incomplete split AFTER profiling. `reports/mappings/investors_mapping.json`
holds every equivalence decision.

## P3 — COMPANIES (proposal)

Source: `companies_complete.jsonl` (315,208 Companies-House-shaped rows).
Canonical: `registry_id, name, jurisdiction, status, address_*, locality, country,
sic_codes[], industries[], website, domain, linkedin, one_liner, confidence, evidence[],
last_seen, snapshot_month, quality_score{+components}`. SIC→industry category map
proposed after value census. Dormant/shell rows NOT deleted → low-score incomplete.

## P4 — LOCAL BUSINESSES (proposal)

Source: 91 Overture extracts. Canonical: `registry_id, name, category(canonical craft),
categories_raw[], address_*, locality, region, country, lat/lon, phone, email, website,
domain, confidence, evidence[], quality_score{+components}`. Craft taxonomy = existing
`CRAFT_CATEGORIES` extended only with value evidence per country file; landmarks/parks
→ junk flag (kept, scored low), never deleted.

## Quality score (locked)

`email30 + phone25 + website25 + linkedin20` with validity checks; components stored.
Sufficient/incomplete thresholds proposed AFTER score distribution observed (defaults
to propose: sufficient = score≥40 AND (name + org) present; per-entity tuning at review).

## Examples (from head reads)

- Investor sufficient: `Aaref Hilaly / Bain Capital Ventures / Partner / SF / email +
  site + linkedin + image` → high score.
- Investor incomplete-candidate: merged row with `cheque_size` but no email/image →
  mid/low score → incomplete → enrichment queue.
- Company incomplete-candidate: `! LTD / HARROGATE / industries[] / website null` →
  low score → incomplete, preserved.
- Business junk-candidate: `Farallon Island Lighthouse / landmark` → flagged non-prospect,
  preserved with category intact.
