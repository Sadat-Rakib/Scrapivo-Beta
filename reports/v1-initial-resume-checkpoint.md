# Research Agent V1 resume checkpoint

Status: **BLOCKED for initial-product acceptance**. `/discover` serves HTTP 200 at `http://127.0.0.1:8080/discover`, and the local SearXNG container is running, but all three live acceptance searches returned zero qualified rows. Do not label this build testable yet.

Completed before this session: SearchSpec, DB-first retrieval, free provider ladder, browser adapter, evidence/qualification, progress feed, and initial Research Agent/URL field modules were already present. Preserve the existing working tree.

Finished this session: partial seed browser research, one-pass source-page inspection, thin-page handling, query-aware research stop, no-website check accounting, source/contact URL safeguards, no-website display evidence, SaaS-company classification, a 120-second UI run abort, a 15-second city-company S3 tier cap, and a focused runtime probe script. Focused tests: 79 passed. Typecheck remains red with 39 errors in 13 files.

Real search results: A Austin plumbers: 58 OSM hits, 0 verified/returned, 68.7 s on final run. B global SaaS founders: 15 live-web and 5 browser candidates, 0 verified/returned, 131.4 s. C Toronto SaaS companies: 15 live-web and 9 browser candidates, 0 verified/returned, 140.0 s. Probe output: `tmp/v1-A2.log`, `tmp/v1-B2.log`, `tmp/v1-C2.log`. The direct core probe lacks the UI's registered abort signal, so its over-120-second times do not prove the UI timeout is ineffective.

First remaining blockers: A has no eligible structured-absence seeds after OSM mapping, so zero candidates receive absence verification. B and C still spend browser time on source pages and end with incomplete identity/destination/contact rows. C's mixed-geography S3 fallback times out even after the cap. UI browser automation was unavailable, so actual result rendering was not exercised.

Next steps: (1) trace OSM `structured_website_absent` through `live-gapfill` and ensure real no-site POIs reach research; (2) make browser extraction from list pages yield researched founder/company entities within the 120-second run budget; (3) rerun each acceptance query once, then verify rendered rows in `/discover` with an available browser.
