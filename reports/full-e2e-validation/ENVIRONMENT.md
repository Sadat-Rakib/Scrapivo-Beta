# ENVIRONMENT — Scrapivo Full E2E Validation

Snapshot: branch `rc/mvp-local-testing-baseline` @ `2fcf028a0f56794080cf61049a35e6bc4320ac2d` (local commit, NOT pushed; main untouched at `7805e75`).

## Machine
- OS: Windows 10.0.26200 (win32), Git Bash shell. Machine RAM 15.6 GB, memory-bound (build needs `NODE_OPTIONS='--max-old-space-size=4096'`; errno=1455 = Windows commit-limit, not a code bug).
- Docker daemon DOWN → local SearXNG (:8888) unavailable for entire run. Discovery falls back to in-browser DuckDuckGo/Bing; source health reports degraded. Zero results are NOT automatically bugs.

## Runtime configuration (PRD §5)
- Browser worker: `npm run worker:local` → loopback :8788 (forces local no-persist).
- App: `SCRAPIVO_LOCAL_NO_PERSIST=true SCRAPIVO_BROWSER_ADAPTER=worker npm run dev -- --port 8080` → http://localhost:8080.
- `SCRAPIVO_LOCAL_NO_PERSIST` only blocks search-generated persistence; user-triggered UI actions still write to the Supabase project (Save Lead, Watches, Projects/ICPs, profile edits).
- Never run `scripts/start-mvp-testing.ps1`. No deploy/Vercel/push.

## Authentication
- Authorized demo account only. Credentials resolved by `tools/qa-auth.mts` (env `QA_EMAIL`/`QA_PASSWORD`, else literals parsed from `e2e/ship-it.spec.ts`); secrets never printed/committed.
- Playwright storageState: `.auth/qa-demo.json` (gitignored; written Sep 30 23:35 during Kiro's pass). `.auth/local-user.json` is the older RC ui-gate session.

## Known environment limits (not defects)
- Free LLM quotas (Groq `openai/gpt-oss-20b` exhausted 01:25 Oct 1 during Kiro's parallel lanes) → understanding falls down provider ladder / deterministic path; clarify stage can take ~60 s.
- Live browser-backed run: 3.5–5.5 min. Allow ~7 min before calling a run suspicious (PRD §35).
- 55 vitest failures (KNOWN_RED) + 43 typecheck errors predate this pass (frozen baseline).

## Test phases run (times local MDT)
- Kiro phase: Sep 30 21:14 – Oct 1 02:09 (interrupted mid-analysis; lanes killed ~01:25).
- Continuation phase: Oct 1 02:42 – 08:20 (suite complete, gates re-verified NEW_FAILURES=0, report finalized).
