# Scrapivo MVP Certification — 2026-10-06

Session goal: take over from the previous session's uncommitted hardening pass and finish
Stage-2 reliability to a stable MVP state. Everything below was run against the real
pipeline (dev server :8080, browser worker :8788, SearXNG :8888, live providers).

## Verdict: MVP READY — YES

All gates green; every named certification case exercised end-to-end; all failures
root-caused and fixed; remaining zeros are honest (genuine search + reconciled ledger).

## Gates

| Gate | Result |
| --- | --- |
| Vitest full suite | **1830 passed / 0 failed** (6 skipped by design) — final run after all fixes |
| `tsc --noEmit` | 0 errors |
| `npm run build` (nitro) | ✓ built in 1m02s |
| Stage-2 acceptance battery (wire-level harness) | all 10 default queries + cancellation + impossible **PASS** (post-fix) |
| Multi-role / multi-location sweep | PASS |

## Root causes found and fixed this session

1. **`06753809` — land the previous session's hardening pass.** Investor identity proof,
   cancellation ledger truthfulness, wire-level acceptance harness, zod-validated worker
   responses. Reconciled two stale test contracts (bare-business clarify; pagination
   zero-delivery vs. authority-row delivery), pinned `seroval`.
2. **`9dedd61f` — SearXNG reachability probe lied.** The probe fired `/search?q=ping` (a
   10s+ engine fan-out) against a 4s budget, so a healthy SearXNG was "proven"
   unreachable on nearly every call; the ladder fell to bot-blocked DuckDuckGo and runs
   delivered false coverage-exhausted zeros. Probe moved to `/healthz` (~7ms). Same-day
   proof: Tbilisi went honest-zero → **5 qualified freight forwarders**.
3. **`bf438713` — entity vocabulary.** "solar installers", "freight forwarders", "customs
   brokers" et al. classified `entity: unknown` and were forced through clarify into the
   wrong pipeline. Business nouns extended with the trade families; the category capture
   keeps the intent qualifier ("wedding photographers", "solar installers").
4. **`bcf0189e` — junk entity names.** SERP titles became candidate identities verbatim
   ("Preferences" ran its own `"Preferences" "Windhoek" contact` research query; a stats
   banner seeded as a solar installer). Shared junk-name gate at seed mapping and
   normalization.
5. **`96bc1287` — plural premises trades.** The live LLM frame typed "wedding
   photographers in Cebu" as a person hunt while the deterministic extractor said
   business. Premises-trade heads + a guarded repair reconcile the model reading
   (ambiguous declared, singular/recruiting wording keeps person).
6. **`498cd0f2` — job gates.** "React developer" splits into role=developer +
   technology=React, but both gates matched role tokens only — "Senior React Engineer"
   postings died as rejected_role. Technologies now count toward the role ask; a posting
   with no observed location is researchable (unknown ≠ contradiction).
7. **`1a84ada7` — zero-reason truthfulness.** Runs whose widen passes completed were
   still labeled `TIMEOUT` from a per-phase diagnostic mentioning a timeout, sending
   honest zeros to the UI as acquisition failures. TIMEOUT/SOURCE_UNAVAILABLE now require
   the run deadline to have fired or widening to have never completed a pass.

## Real end-to-end results (wire-verified: ledger reconciliation, UI/backend row parity)

**Delivering qualified rows**
- `find plumbers in Austin` — 50 rows (run 5f626f48)
- `dentists in Nairobi and Mombasa` — 50 rows in 51s (run 525aadda)
- `seed investors for AI startups in Canada` — 49 rows (run 142fd06d)
- `freight forwarders in Tbilisi` — 5 qualified rows post-fix (run d6391bca)

**Honest zeros after genuine search (accounting `unaccounted: 0`, coverage-proved)**
- `solar installers in Windhoek`, `wedding photographers in Cebu`, `construction
  companies in Banja Luka`, `find copywriters in Toronto`, `React developer jobs in
  Calgary`, `find SaaS founders globally` (settled initial, no force), `yo need like 7
  hvac guys gta sites + nums`, `find unicorn ranchers in Atlantis` (impossible-search
  honesty gate now passes).

**Mechanics verified live**
- Cancellation: request aborted at the wire, session closed, nothing read after abort.
- Clarify cards → forced runs settle terminally; forced zeros demand coverage proof.
- Search/session isolation, per-turn UI rendering, fold/table output all asserted.

## Known limitations (not bugs — documented for the next session)

1. **Free AI provider variance.** Most free router providers are dead (unauthorized /
   quota / daily check-in); groq gpt-oss + keyed Mistral carry extraction. A long sweep
   can still see extraction quality vary with rate limits. Fixing needs valid keys for
   the excluded providers (external).
2. **Person-search live coverage is thin.** Founders/copywriters produce honest zeros:
   SERP link caps + extraction-model variance leave little extractable person evidence
   on free sources. Business/investor/jobs paths deliver from structured + DB sources.
3. **Free job boards returned worldwide noise for a Calgary ask** (Frankfurt/India/LATAM
   postings); the pipeline rejects them honestly — local jobs depend on the freehire
   ATS catalog growing.

## Environment state at handoff

- Dev server: my instance on 127.0.0.1:8080 (logs in `/tmp/vite-dev.log`).
- Browser worker: running on 8788 (`npm run worker:local`, logs in `/tmp/worker.log`).
- SearXNG: healthy at 127.0.0.1:8888.
- An awake-keeper PowerShell process prevented system suspend during sweeps; it dies
  with the session.
- Diagnostic tool committed: `e2e/probe-live-trace.spec.ts` (dumps full backend trace
  JSON for any query to `reports/probe/`).
