# Initial V1 final shipping pass — 2026-09-26

Status: **BLOCKED for manual acceptance**. `/discover` returned HTTP 200, but the Austin no-website query returned zero qualified rows on the final live run. Do not label this tree ready for manual V1 testing.

Finished: OSM and indexed Overture null-website records now enter bounded verification as unverified seeds with structured provenance. Official sites reject no-site claims. Source-page snippets now yield founder/company entity seeds; generic headings are filtered; official destinations and public contact pages receive priority. Toronto city-company S3 tier is capped at 5 seconds. Browser research has its own bounded SearXNG quota and no recency filter for official-site lookups. The qualified-lead record retains `contact_page_url`.

Final live outputs: A `tmp/v1-A6.log`: 10 indexed business seeds accepted, 3 website-check actions before 120-second abort surfaced at 149.1 seconds, 0 qualified/returned. B `tmp/v1-B4.log`: 1 real founder returned in 101.6 seconds. C `tmp/v1-C4.log`: 2 real Toronto SaaS companies returned with official sites and public phones, one public email, in 94.2 seconds; S3 timed out at 5 seconds.

Focused verification: 78 tests passed across six touched-path files. Typecheck: 39 known baseline errors remain; no introduced errors. `/discover`: HTTP 200. Automated UI interaction was not exercised.

Files saved this pass: `src/lib/indexed/search-index.server.ts`, `src/lib/search/{live-gapfill,osm-local-businesses.server,place-disambiguate.server,browser-live.server,browser-research,source-plan,searxng.server,verification,qualified-lead}.ts`, `src/lib/spec-search.functions.ts`, and focused tests in `src/lib/search/__tests__/` plus `browser-live.server.test.ts`.

Next starting point: inspect the first three research actions in `tmp/v1-A6.log` and the browser research budget/abort path. The final A run found search results for its first Overture plumber but exhausted the interactive window while checking the next candidates. Preserve evidence gates; never infer no website from a null stored field alone.
