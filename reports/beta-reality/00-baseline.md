# Beta Reality — 00 Baseline (2026-09-27)

- HEAD `9666f54`, working tree clean (freehire submodule + generated routeTree only).
- Real dev app found ALREADY RUNNING (node PID 29212, http://127.0.0.1:8080) but DEAD: Vite overlay
  `[plugin:vite:react-babel] src/routes/_authenticated/profile.tsx: Export 'ProfilePage' is not defined (257:9)`.
  Whole app 500s since commit `f528978` (WS3 added a trailing `export { ProfilePage };` re-export in a
  TanStack route file; route transform fails it). Fixed by exporting at declaration and removing the
  EOF re-export. Backend-only passes never noticed.
- SearXNG live (docker `scrapivo-searxng`, :8888).
- Auth: real Supabase. Test identity provisioned via admin API (email confirmed):
  `beta-reality-test@scrapivo.dev` (id 543a4b96-d467-4eed-8880-bdf574037fbe). Login through real UI verified.
- BLOCKER B1 (environment): 6 migrations NOT applied to remote Supabase (`search_jobs`,
  `projects_ext`, `source_yield`, `notifications`, `watch_v2`, `search_jobs` base). REST introspection
  confirms tables absent. Durable jobs / Watch / project tables will 500 at runtime. No DB password or
  access token in env → could not push migrations from this session. Owner must apply
  `supabase/migrations/2026*` or provide DATABASE_URL.
- Observability: `search_history` table exists (query, results_count, sources_searched, transcript);
  rows are written when a run COMPLETES — stopped runs do not appear. Live-battery runs therefore
  complete (or reach first batch) before harvesting.
