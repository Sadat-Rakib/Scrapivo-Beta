# HARD GATE — first browser row (Task 5)

## Real run (server core, headed Chromium, no persistence)
- Harness: `browser-trace.mts custom product headed`, which calls `runSpecSearchCore` with `force=true`, forced live discovery, and the real progress publisher. Raw evidence: `BROWSER_TRACE_CUSTOM_PRODUCT_HEADED_gate6.json`. Page captures are in `captures/`.
- Query: **"B2B SaaS founders with public contact details"**. Spec: `role=founder, industry=saas, require_contact=true`.
- Path:
  - Stored people index returned nothing.
  - SearXNG was unavailable, recorded once.
  - The in-browser DuckDuckGo search, headed, returned organic results. One result was `capchase.com/top-25-b2b-saas-founder-list`.
  - Founder cards on that page were extracted deterministically: name, role and company as three adjacent lines.
  - Each founder's company site was resolved from the list page's own link to it, then checked against the company name.
  - Each site's `/contact` route was opened and confirmed to show contact content.
  - Each lead then went through qualification, streaming and the final page.
- Result: `QUALIFIED_RESULTS`, 5 final rows, 3 streamed while researching, about 123 seconds:
  - Andrew Breen, Founder & CEO @ Outshine
  - Alex Circei, CEO & Co-Founder @ Waydev
  - Garry Drummond, CEO & Founder @ LOCH Technologies
  - Jennifer Dulski, CEO & Founder @ Rising Team
  - Amir Kaplan @ ifeel
- Evidence audit (`audit` in the JSON): every identity and cohort excerpt of every final row matched the captured source page. Every `contact_page_url` was a captured first-party page. No email or phone is attached: none was observed that names the founder. Earlier runs attached other people's addresses (for example `yutong@withaccend.com` for Pranjal Daga, `anna@mimohq.com` for Henrik Grim). That was fixed in `contact-attribution.ts`.
- Rejected candidates, each with a structured reason: Mark Corbett, Pranjal Daga, Henrik Grim, Ajay Kamble and Erik Kostelnik were all `MISSING_QUERY_REQUIRED: contact`, because no first-party contact page or attributable contact was observed.
- Relevance judgment: all five are named, current founders or CEOs of B2B SaaS companies. Each is bound to a company through a list card on a page explicitly titled "Top 25 B2B SaaS Founder List". Each has an observed first-party contact route. They are relevant to the query.

## Deterministic integration fixture
`src/lib/search/__tests__/first-browser-row.test.ts` runs the same core with fixture pages and asserts:
- the final row carries the list-page identity evidence
- the website and contact page were observed
- no contact details were fabricated
- the streamed row key equals the final row key, and it streamed exactly once
- a founder with no contact channel does not qualify.

## UI step
The authenticated Discover screenshot is pending the one-time local sign-in (Q2=a). The first sign-in window timed out after 15 minutes without a login. UI acceptance is re-attempted in Tasks 5F, 10 and 20.

## Full Gate #1
- Tests: canonical `vitest --exclude .kilo/** --maxWorkers=2` gave 1,439 total, 1,368 passed, 56 failed, 15 skipped. Every failure is in KNOWN_RED, with **0 new**. Three KNOWN_RED entries now pass.
- Typecheck: 43 errors, identical to the checkpoint baseline, with **0 new**.
- Build: `npm run build` with `NODE_OPTIONS=--max-old-space-size=4096` **succeeded** in 1m 35s. The output is `.vercel/output` with 3,915 static files and `__server.func`. Node peaked at 5.3 GB private memory, and free commit memory fell to 0.42 GB. The earlier checkpoint failures (errno 1455, and hitting the 1.5 GB heap limit) came from the machine's commit memory and an undersized heap, not from the code.
