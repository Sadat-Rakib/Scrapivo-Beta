# Worker runtime gate (Tasks 5A–5F)

Query: "B2B SaaS founders with public contact details", product path (`runSpecSearchCore`), headed, `SCRAPIVO_BROWSER_ADAPTER=worker`, worker started with `npm run worker:local` (loopback :8788), local no-persist active.

## Result (run `worker_gate2`)
- Runtime trace: `{ requested: "worker", used: "worker" }` (no fallback).
- Outcome `QUALIFIED_RESULTS`, 5 qualified rows, 3 streamed while researching (Garry Drummond, Jennifer Dulski, Amir Kaplan).
- Rows: Andrew Breen/Outshine, Alex Circei/Waydev, Garry Drummond/LOCH Technologies, Jennifer Dulski/Rising Team, Amir Kaplan/ifeel. Each has an observed first-party `/contact` page; no email/phone attached (none attributable to the person).
- Evidence audit: every excerpt re-validates against the captured page text (0 mismatches); every contact page captured.
- Provenance: every evidence item `acquisition=browser` with the worker session id; unique `ev:` ids.
- Browser: one worker session for the run, 25 pages, status `completed`, `retained: true`, frame captured.
- Trace file: `BROWSER_TRACE_CUSTOM_PRODUCT_HEADED_worker_gate2.json`.

## Bug found and fixed on the way
Run `worker_gate1` stopped at the discovery time budget (90 s) with 4 qualified rows, but the worker session was closed as "cancelled": the adapter treated any aborted signal as a user cancel. `AgentBrowser.close(session, outcome)` now carries the outcome; discovery passes `cancelled` only for a user cancel (not a deadline or time budget). Regression test in `src/browser-worker/__tests__/worker-adapter.test.ts`.

## Takeover (5F)
- Server: `src/lib/search/scrapy-browser-control.{ts,server.ts,functions.ts}` (authenticated, owner-scoped, closed command set: take, release, close, click, text, key, scroll; no URLs or scripts). `getScrapyBrowserState` returns live worker frames plus `adapter`, `controller`, `retained`, `canControl`.
- UI: `ScrapyBrowser` shows Take control / Give control back / Close browser; while in control the frame is a click target (letterbox-aware mapping to 1280×800), with typing, keys and scroll. The mini-browser stays mounted after the search settles.
- A person keeps control if the run ends while they drive (worker close no longer resets the controller).
- Real-Chromium test: owner takes over the kept-open session, the agent is refused (`HUMAN_CONTROL`), scroll + click reach the page, control returns, close ends the session; another user gets `NOT_FOUND`.

## FULL GATE #2
- Tests: 1514 total, 1443 passed, 56 failed + 1 suite-level; all KNOWN_RED except `Promotional Videos/film/lib/motion.test.js` ("No test suite found"). That folder was created at 22:35 on 2026-09-29, after the pass baseline (17:51), by parallel promo-film work in this workspace; same failure mode as the known `motion-reel-kit` entry. Not caused by this pass.
- Typecheck: 43 errors = baseline, 0 new.
- Build: `npm run build` exit 0 with `--max-old-space-size=4096`.
- Client bundle scan (`.vercel/output/static`, 69 files): no Playwright code, no worker routes, no worker token names or values, no service-role key name.

## Streaming, cancellation, hangs (Tasks 6–7)
- Candidate survival ledger (`src/lib/search/candidate-ledger.ts`, hooked into `runSpecSearchCore`): every funnel candidate ends in one fate (`returned`, `qualified_more`, `rejected` + code, `gated`, `incomplete`, `excluded`, `unaccounted`), including rows the QualifiedLead projection would refuse in the UI (`LEAD_VIEW_*`). The result carries `candidateLedger`; one `[candidate-ledger]` log line per run. The UI names streamed leads missing from the final list with a plain reason (`StreamedReconciliationNote`). Real-core test: two founders stream, page size 1, the second is reported "on the next page" and `unaccounted` = 0.
- Progress stream: lead rows now survive the 80-event activity cap (own cap 200; activity trimmed first; ids stay monotonic).
- Real cancelled run on the worker (`worker_cancel1`): Stop fired at 55.2 s through `cancelRegisteredSearchRun`; the run returned `SEARCH_CANCELLED` with 0 rows at 57.5 s (2.3 s later); no progress events or streamed rows after the cancel; the worker session ended `closed` (not retained), `active: 0` on the worker.

## After the semantic review
- A person keeps control when the same run re-uses its lane (next branch of a multi-place search); the agent's steps wait on `HUMAN_CONTROL`.
- The idle sweeper reclaims any untouched lane, including an abandoned person-controlled one, so leaked lanes cannot pin the two worker slots.
- Retained-lane eviction for a new session runs behind that lane's queue.
- Chromium's environment also drops URL/URI/DSN/proxy variables and any value carrying `user:pass@` credentials.
- A worker → in-process switch is traced even when the in-process runtime also fails to start.

## Known environment limit
Under heavy memory pressure (free RAM ~0.3 GB during the first matrix pass) the worker occasionally failed to start Chromium within the 60 s session budget (m06, m08, m10, m12, m16, m18 in pass 1 ran on the reported in-process fallback). With more free memory, pass 2 ran every query on the worker.
