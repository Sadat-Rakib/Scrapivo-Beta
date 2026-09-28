# Beta Reality — 10 Open Limitations (evidence-backed, next triage order)

1. **PEOPLE/COMPANY ZERO-YIELD (biggest blocker).** Plain people/company searches return 0–1
   despite finding 14–19 candidate links (B1: 19 links → 0; B3: 1 site → 0; B4: 15 leads → 1).
   The signal path resolves people fine (B10 returned 2 real founders), so acquisition exists but
   identity/qualification drops everything. Trace: discovery rows → qualification gate in
   `src/lib/search/qualify.ts` + identity evidence requirements. Not root-caused this session.
2. **UNDERSTANDING gate (F1–F5).** Bare "jobs"/"investors"/"accelerators" launch without any
   clarification; "weather in Paris" launches a search (no off-topic gate); "need buyers" asks
   location instead of offer/purpose; accelerators are not a first-class subtype (routed to
   companies, discovery queries lost the word "accelerator"). Root zone: readiness/mode-gate
   branches per entity class (an investor-noun routing override exists from an older pass). The
   legacy red test cluster encodes these contracts (classified A).
3. **ROLE QUALIFICATION.** "CTOs at AI startups in London" returned a Conference Director at a
   non-AI company — evidenced-role/company constraints are not enforced in `qualify.ts`.
4. **JOBS source mix.** Live rows came from UK/PL aggregator boards (whatjobs, adzuna) rather than
   ATS feeds; Canada eligibility not visibly enforced; ATS adapters + board seeds did not win the
   plan. Trace source-plan ordering for jobs (`jobs-provider.ts` bounded tier) + location filter.
5. **Take Control is not functional** ("coming next" label). Beta limitation — document, don't fake.
6. **BLOCKER (environment): 6 migrations unapplied** on the remote Supabase (`search_jobs`,
   `projects_ext`, `source_yield`, `notifications`, `watch_v2`) — durable jobs, Watch, project
   tables 500 at runtime. Owner must run `supabase/migrations/2026*` (no DB password/CLI link in
   this environment).
7. **Observability:** `search_history.results_count` disagrees with the UI (49 vs 0/1) — the count
   appears to aggregate attempts, not delivered rows.
8. **Repeated identical queries observed** (B2: same site:linkedin query ×3) — widening dedupe of
   executed queries not effective in the live path.
9. Adaptive budget + furniture gate + SERP skip deployed mid-session; end-to-end live validation
   of those three is still pending (dev-server HMR state made the final retest inconclusive).

Session-level limitation: B11/B12 were not run live (context budget); fix subagents could not run
(host captcha errors) so those fixes were done by the parent or documented.
