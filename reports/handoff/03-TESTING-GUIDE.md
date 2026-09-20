# Testing guide

Install: `npm install`. Configure non-secret values from `.env.example`; Supabase auth/API configuration is required for authenticated Discover. Optional live paths require configured SearXNG/provider endpoints. Install browser: `npx agent-browser doctor`.

Run app: `npm run dev`. Open `/discover` as an authenticated user. Current Discover uses `runSpecSearch`; Gate 2C session API can be exercised through authenticated server-function clients and SSE endpoint `/api/research/<sessionId>/events`.

Run focused proof:

```powershell
rtk npm test -- src/lib/research-agent/research-agent.test.ts src/lib/research-agent/zero-ai.test.ts
rtk npm test -- src/lib/search/__tests__/m1-m3-runtime.test.ts src/lib/search/__tests__/m4-entity-resolve.test.ts src/lib/__tests__/jobs-provider.test.ts
rtk npx tsx scripts/research-agent-smoke.mts
rtk npm run build
```

Smoke queries: founders in Canada; copywriters looking for work; AI companies hiring designers; Toronto HVAC with phone; Edmonton no owned website; frontend jobs Toronto this week; seed SaaS investors.

Expected: evidence-backed qualified results only; quantity default 10; shortfall starts live research; closed/captcha rows reject or hand off; no email/phone guessing. Use `cancelResearchSession` and `continueResearchSession`; screenshot references occur in SSE events. `npm run build` is narrow launch check. Global typecheck may contain unrelated debt.

Storage: do not watch it during development. At end inspect `C:\ScrapivoGate2\logs\search-index-watchdog.log` and checkpoints once. Never clean Supabase from this branch.

