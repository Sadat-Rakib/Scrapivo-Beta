# Beta Reality — 09 Fixed Failures (this session)

| fix | file | root cause | behavior change | regression test |
|---|---|---|---|---|
| Dead dev app | `src/routes/_authenticated/profile.tsx` | trailing `export { ProfilePage }` re-export breaks the TanStack/vite route transform → whole app 500 since `f528978` | export moved to the declaration; app renders | manual UI verification (login → composer) |
| Premature run death | `src/lib/search/search-run.server.ts` + `spec-search.functions.ts` | flat 120s `MAX_RUN_MS` aborted every interactive search mid-research (source of the honest-looking zeros in B1/B3/B4) | adaptive budget: 120s + 20s × requested target, capped 10 min | typecheck; live retest pending owner validation |
| Fabricated contact emails | `src/lib/contact.functions.ts` | `guessEmailPatterns` pushed first.last@domain addresses at "probable/possible" verification tier — Canva CEO email shown as verified | only SMTP-verified pattern addresses may surface; probable/possible dropped | manual; unit test still to add |
| LLM-invented contacts | `src/lib/contact/pie-top-leads.server.ts` | PIE waterfall step 5 merged LLM-extracted emails/phones (model-invented, not verbatim) | step 5 disabled; only regex extraction from real page text contributes contacts | manual; unit test still to add |
| SERP browsing waste | `src/lib/research-agent/browser-research.server.ts` | browser navigated and paginated Bing SERP pages (8 pages/10 actions observed) | `recognizeUrl(url).kind === "search"` pages are refused before navigation, user-safe event emitted | pacing/research suites 40/40 |
| Furniture-page waste in discovery | `src/lib/search/browser-live.server.ts` | discovery reader opened microsoft.com/support-style pages and scrolled/extracted 8-10 pages (the §15 Microsoft regression, captured live twice) | `classifyPageRelevance` gate on every opened page: IRRELEVANT/ERROR pages are skipped before extraction (WRONG_ENTITY deliberately not applied — directories legitimately span entities) | live battery evidence; retest pending |
| Relevance gate lacked entity context | same file (verifyCandidateFromSnapshot) | classify call never received the entity name, so WRONG_ENTITY could never fire | `entityName` now passed from the candidate row | existing suites green |
| Test suite pollution | `vitest.config.ts` | exclude list had lost `**/node_modules/**` → vendored maplibre tests executed; `.agents/**` skill self-tests executed | excludes repaired | suite runs clean of foreign files |

Not fixed this session (see 10-open-limitations): understanding clarify gate (F1–F5), role
qualification, accelerator routing, people/company zero-yield. The three fix subagents dispatched
all died to a host-side captcha infrastructure error ("Captcha instance/verification timed out"),
so fixes beyond the parent's capacity were recorded instead of forced.
