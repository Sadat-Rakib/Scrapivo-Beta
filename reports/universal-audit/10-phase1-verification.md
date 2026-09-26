# 10 — Phase 1 full system verification (independent audit)

**Date:** 2026-09-15  
**Auditor stance:** Prior agent claims and [09-post-implementation-reality-check.md](09-post-implementation-reality-check.md) treated as **hypotheses**, not facts.  
**Mode:** Audit-only — **no product code changes**.  
**Artifacts:** this file + [tmp/phase1-verification-traces.jsonl](../../tmp/phase1-verification-traces.jsonl)  
**Battery tooling (non-product):** [scripts/phase1-verification-battery.mts](../../scripts/phase1-verification-battery.mts)

---

## 1. Executive summary

Phase 1 **machinery is real** on the SPEC path: need-phrase semantics, evidence schema, qualification gate, free-first SearXNG ladder, Reddit social provider wire-up, and Supabase persist of stamped live rows all exist in code and exercise at runtime.

Phase 1 is **not trustworthy as “qualified leads”** yet. Independent replay of A–G shows:

| Strength | Failure |
|----------|---------|
| A: OSM `no_website` structural evidence + evidence-backed why_match | C: **funding** evidence qualifies a **developers** need (wrong claim type) |
| Extract: plurals / need≠industry / funding→company | E: **aggregator list pages** stamped `verified` and upserted as companies |
| Directory-without-evidence dropped under `signal_required` | D: Monster/LinkedIn agency pages qualified as “companies needing marketing” |
| Free path uses SearXNG; paid SERP not required | UI maps only `why_match` — not `evidence[]`, scores, disposition, verification |
| Persist round-trip via Supabase (no `DATABASE_URL`) | Social provider runs but returns **HTTP 404** this run (0 hits; fail-closed, no fabricate) |
| Unit Tests 1–10 green (19) | Tests are **fixture/mock** — can pass while product quality is wrong |

**Manual testing readiness:** `YES — READY WITH KNOWN LIMITATIONS`  
**Final Phase 1 verdict:** `PHASE 1 NOT VERIFIED — CRITICAL GAPS REMAIN`  
**Trust question:** `YES, WITH LIMITATIONS` — safe to explore Discover UX and A/G-shaped flows; **do not trust** C/D/E rows as verified buying/funding leads.

---

## 2. Repository state

| Field | Value |
|-------|--------|
| Branch | `main` |
| HEAD | `9efae83` |
| Working tree | **Dirty** — large uncommitted Phase 1 + Discover surface (not on origin as committed Phase 1) |
| `SPEC_SEARCH_ENABLED` | `true` |
| `SEARXNG_URL` | set → `http://127.0.0.1:8888` — **HTTP 200** JSON (probed 2026-09-15) |
| `DATABASE_URL` | **absent** |
| `SUPABASE_URL` / service role | **set** — persist path uses Supabase upsert |
| `USE_PAID_SOURCES` | set / true |
| `SERPER_API_KEY` | set (present but **not required** on SPEC live-gapfill when SearXNG returns hits) |

Proof ladder used everywhere below: **code → unit → runtime → user-visible → persist → repeat**.

---

## 3. Claim → proof matrix

| Claim (1A–1G / product) | Status | Highest proof rung |
|-------------------------|--------|-------------------|
| 1A Request semantics (entity ≠ need; plurals; funding entity) | **VERIFIED** | runtime extract + A–G parse |
| 1B Evidence schema + evidence-backed why_match | **PARTIAL** | runtime why_classes; wrong claim types still qualify |
| 1C Directory contamination gate | **PARTIAL** | gate drops bare directory; any claim type still qualifies |
| 1D Live → VERIFIED → persist → re-read | **PARTIAL** | Supabase upsert+round-trip; VERIFIED definition weaker than L1.5 prose |
| 1E Social provider on SPEC | **PARTIAL** | code+execute; runtime **404** → 0 hits (not fabricated) |
| 1E Funding / startup path | **PARTIAL** | entity+funding criteria VERIFIED; identity quality FAILED |
| 1F Free-first (no paid required when free works) | **VERIFIED** | runtime provider logs |
| 1G Regression / acceptance Tests 1–10 | **PARTIAL** | unit green; live quality gaps remain |
| User sees evidence / scores / verification | **PARTIAL** | only `why_match` text in Discover Lead mapping |
| Empty qualified page = success when no evidence | **VERIFIED** (design) | gate behavior; A–G not empty this run when weak evidence present |

Allowed labels: `VERIFIED | PARTIAL | UNVERIFIED | FAILED | BLOCKED BY ENVIRONMENT | NOT IMPLEMENTED`.

---

## 4. 1A verification (request semantics)

**Code:** `need-phrase.ts`, `search-spec-extract.ts`, `search-spec.ts`.

**Extract battery (traces `kind=extract`):**

| Case | Result |
|------|--------|
| Plurals (`needing websites/developers/marketers`, `looking for copywriters`) | `signal_required=true`; opportunity / requested_* set |
| Synonyms (`need`, `looking for`, `seeking`, `hiring`, `require`) | signal true where expected |
| Ambiguity: `marketing companies in Austin` | `signal=false`, `industry=marketing` (identity) |
| Ambiguity: `companies needing marketing` | `signal=true`, `requested_service=marketing`, **industry=null** |
| Funding queries | `entity=company`, `funding_status=recent`, `signal_types` includes `funding` |
| Negatives: `gyms in Toronto`, `SaaS companies in Europe` | `signal_required=false` |

**Runtime A–G parse:** matches extract (A opportunity `no_website`; D no industry marketing; E company+funding).

**Status: VERIFIED** at semantics/extract layer.

---

## 5. 1B verification (evidence / why_match)

**Code:** `evidence.ts`, `live-gapfill.ts` (`evidenceFromWebHit`, `deriveWhyMatch`, `applyWhyMatchGate`).

**What works:**

- Typed `Evidence` with `observed_at`, `evidence_type`, `supports`, `extraction_method`.
- A rows: `evidence_types=["no_website"]`, why_class `evidence_opportunity`, OSM provenance text.
- G rows: hiring excerpts in why_match (not host-only `Live web result · …`).

**Critical weakness (code + runtime):**

```287:298:src/lib/search/live-gapfill.ts
  } else if (looksFunding || funding) {
    out.push(
      makeEvidence({
        ...
        evidence_type: "funding",
```

- Branch fires on **snippet “funded/raises…”** even when the query asks for **developers** (C: Founder Institute → `evidence_types:["funding"]`, disposition `qualified`).
- Also fires when `funding_status` is set on the **spec** (`|| funding`), which can stamp funding evidence on non-funding text for E-path hits.

**Status: PARTIAL** — schema and evidence-backed strings exist; claim-type fidelity is not enforced.

---

## 6. 1C verification (qualification)

**Code:** `qualify.ts`; gate via `applyWhyMatchGate` / `applyQualificationGate` in `spec-search.functions.ts`.

**Verified:**

- `signal_required` + no evidence → not `qualified` (unit Test 3; A–G `directory_rows_without_evidence=0` on final pages).
- Separate `relevance_score` / `intent_score` on SpecRow (runtime samples).

**Failed product invariant:**

- `hasQualifyingEvidence` accepts **any** of hiring | service_request | no_website | funding | social_ask — **not** “evidence that supports *this* query’s claim”.
- C funding evidence → qualified for developer need.
- D Monster “Marketing Jobs” hiring list → qualified for “companies needing marketing help”.

**Status: PARTIAL**.

---

## 7. 1D verification (persist / lifecycle)

**Code:** `persist-live.server.ts`; schema `supabase/migrations/20260910000000_search_index.sql`.

| Check | Result |
|-------|--------|
| name+url alone ≠ VERIFIED | Unit Test 6; `isVerifiedForPersist` requires claim evidence + URL |
| Persist without `DATABASE_URL` | Uses **Supabase** service-role upsert (`via:"supabase"`) |
| Round-trip re-read | B/C/D/E/F/G: `round_trip_found` matched sampled keys |
| A OSM rows | `skipped=3` — no website URL → registry key gate (honest skip) |

**Gap vs L1.5 hard prose:** VERIFIED may be stamped from **SERP title/snippet** evidence alone (same URL). That meets the *code* gate, not the stricter “title/snippet alone cannot establish verification” contract in §L1.5 of report 09.

**Status: PARTIAL** (runtime persist proven; verification bar soft).

---

## 8. 1E verification (social + funding)

### Social

- Wired on SPEC (`runSocialSignalGapfill` after live gapfill when `signal_required`).
- Provider id `reddit-public-search`; maps hits → `social_ask` evidence (unit Test 7 with **mocked** hits).
- This verification run: `social_probe` → **HTTP 404**, `hit_count=0`, `fabricated=false`, `capability_executed=true`.
- A–G logs: `[social-signal] reddit-public-search reddit search HTTP 404` — no social rows on pages.

**Status: PARTIAL** (capability present; live social leads **BLOCKED BY ENVIRONMENT** / upstream 404).

### Funding

- Extract + live-web path for E: 15 qualified rows, all funding why_class.
- `adversarial_notes.e_aggregator_titles` lists ProjectStartups, Handpicked, VCBacked, Seedtable, Failory unicorn list — **list/directory pages**, not individual funded startups.
- All 15 stamped verified and persisted.

**Status: PARTIAL** (path VERIFIED; identity/event separation **FAILED** at user-visible quality).

---

## 9. 1F verification (free-first)

| Probe | Result |
|-------|--------|
| A–G live-web cases | `provider_used:"searxng"`, `cost_class:"self_hosted"` |
| Dedicated `free_first_probe` | `free_provider_used:true`, `paid_provider_called:false` |
| Unit Test 10 | `shouldSkipPaidSerp` + log shape (fixture; does not call Spec core) |

With `SERPER_API_KEY` and `USE_PAID_SOURCES` set, SPEC live-gapfill still completed on SearXNG alone this run.

**Status: VERIFIED** for “SPEC live discovery does not require paid SERP when free returns results.”

---

## 10. 1G verification (acceptance tests)

```text
npx vitest run src/lib/search/__tests__/phase1-acceptance.test.ts
→ 19 passed (1 file), ~5.3s transform+tests
```

| Test | What it actually proves | Strength |
|------|-------------------------|----------|
| 1 Plural signals | `extractNeedPhrase` / `extractSearchSpec` flags | meaningful (parse) |
| 2 Semantic direction | industry ≠ marketing on need query | meaningful (parse) |
| 3 Directory gate | synthetic row without evidence dropped | meaningful (unit gate) |
| 4 Evidence schema | constructors + empty SERP ≠ no_website | meaningful (unit) |
| 5 why_match from evidence | fixture excerpt → string; host-only null under signal | meaningful (unit) |
| 6 VERIFIED persist gate | name+url false; claim evidence true | meaningful (unit); soft vs L1.5 |
| 7 Social | interface + **mocked** hits → gate | **weak** (no live Reddit) |
| 8 Funding extract | Berlin query → company + funding | meaningful (parse) |
| 9 relevance vs intent | scores on fixture | meaningful (unit) |
| 10 Free-first | `shouldSkipPaidSerp` + manual `logProviderUse` | **weak** (no Spec/SearXNG) |

**Could pass while product is wrong?** **Yes** — C/E/D quality failures above are invisible to Tests 1–10.

**Status: PARTIAL**.

---

## 11. A–G replay (this audit)

Source: `tmp/phase1-verification-traces.jsonl` (`kind=runtime`, 2026-09-15). Forced answers: A `mode=selling`+`offer=websites`; others `mode=looking`.

| ID | Query | Parse | Engines | Final rows | Why class | Persist (Supabase) | Audit note |
|----|-------|-------|---------|------------|-----------|-------------------|------------|
| **A** | Toronto restaurants needing websites | business, `no_website` | pg, s3, **live-osm** | **3** | evidence_opportunity | 0 attempted / 3 skipped (no URL) | Strongest Phase 1 demo |
| **B** | people looking for copywriters | person, role copywriter | s3, live-web | **1** | evidence_hiring | 1 / round-trip 1 | Facebook **group** as person lead |
| **C** | founders needing developers in SF | person, role developer | pg, live-web | **1** | evidence_signal (**funding**) | 1 / 1 | **Wrong claim type** |
| **D** | companies needing marketing help in Austin | company, requested_service marketing; **industry≠marketing** | pg, live-web | **2** | hiring + service_request | 2 / 2 | Jobs board + agency ≠ needers |
| **E** | recently funded startups in Berlin | company, funding recent | live-web (s3 timeout) | **15** | funding | 15 / 5 sampled | **Aggregators** |
| **F** | people asking for website help | person, opportunity no_website | s3, live-web | **1** | service_request | 1 / 1 | Facebook group; weak person identity |
| **G** | companies hiring copywriters in NY | company, role copywriter | pg, live-web | **4** | evidence_hiring | 4 / 4 | Best live-web hiring shape |

Compared to pre-Phase-1 failures in 09 (signal false, directory dump, industry=marketing, entity unknown, no persist): **those blocking parse/path failures are closed**. Quality failures remain.

---

## 12. Adversarial tests

| Probe | Outcome |
|-------|---------|
| C funding-on-developer | **FAILED** product claim — `c_funding_evidence_on_developer_need: ["Founder Institute…"]` |
| E aggregator identity | **FAILED** quality — 5/5 sampled titles are lists/directories |
| D industry marketing | **PASS** parse (`d_industry_marketing:false`); **FAIL** lead quality |
| Ambiguity extract pairs | **PASS** need vs identity at extract |

---

## 13. Negative tests

| Query | Extract | Expectation |
|-------|---------|-------------|
| `gyms in Toronto` | `signal_required=false`, business | Directory browse — no signal gate required |
| `SaaS companies in Europe` | `signal_required=false`, industry SaaS | Same |

Not run as full Spec empty-expectation assertions beyond extract (no guarantee UI returns zero). Gate design: empty qualified set is allowed SUCCESS when evidence absent — **not** observed on B–G this run because weak SERP evidence passed the gate.

---

## 14. Anti-hallucination audit

| Check | Result |
|-------|--------|
| Fabricated social leads on Reddit failure | **No** — 0 hits, error logged |
| Invented no_website from empty SERP | Unit forbids; A uses OSM structural method |
| Persist without claim evidence | Gate refuses |
| SERP snippet as “proof” of company need/funding | **Yes, allowed** — primary remaining hallucination-shaped risk |
| Wrong evidence_type for query | **Yes** (C) |

---

## 15. Deduplication audit

- Soft-duplicate path still present in Spec core (unchanged focus of this audit).
- Persist keys collapse to `live-web:<host>` for many rows — **host-level** identity (Facebook/LinkedIn hosts collide across queries B/F/G).
- E list pages each get distinct hosts but wrong entity grain.

**Status: PARTIAL** (host-key collapse + wrong entity grain).

---

## 16. Provenance / freshness

- Evidence carries `observed_at`, `source_url`, `extraction_method`.
- why_match cites excerpt + host when evidence present.
- No independent freshness validator beyond observation timestamps.
- UI does **not** show provenance objects — only prose why_match.

**Status: PARTIAL**.

---

## 17. Failure / fallback testing

| Failure | Behavior observed |
|---------|-------------------|
| Reddit HTTP 404 | Log warn; continue Spec without social rows |
| S3 tier timeout (E) | Continue; live-web still returns rows |
| Paid SERP unused | Free path sufficient |
| OSM businesses without website | Qualify with structural evidence; persist skip without URL |

---

## 18. User-visible testing (API → SpecRow → UI)

**Contract proven without browser login:**

| SpecRow field | Present on API rows (A–G) | Mapped in `specRowToLead` (`discover.tsx`) | Shown in result-tabs |
|---------------|---------------------------|--------------------------------------------|----------------------|
| `why_match` | yes | **yes** | **yes** |
| `evidence[]` | yes | **no** | **no** (detail panel’s “Intent evidence” is **legacy** `@/lib/intent/evidence`, not SpecRow) |
| `relevance_score` | yes | **no** | **no** |
| `intent_score` | yes | **no** | **no** |
| `disposition` | yes | **no** | **no** |
| `verification_status` | yes | **no** | **no** |

```541:561:src/routes/_authenticated/discover.tsx
  const specRowToLead = (r: SpecRow, idx: number): Lead => ({
    ...
    why_match: r.why_match ? fixMojibake(r.why_match) : undefined,
    inline_contacts: ...
  });
```

**User-visible evidence: PARTIAL** — user sees evidence only insofar as it was folded into `why_match` text.

---

## 19. Free-first verification

See §9. Trace: `kind=free_first_probe` — SearXNG self_hosted success; `paid_provider_called:false`.

---

## 20. Database / persistence verification

| Path | Status |
|------|--------|
| `DATABASE_URL` + `pg` | **BLOCKED BY ENVIRONMENT** (unset) — optional fallback only |
| Supabase `idx_*` upsert | **VERIFIED** runtime (B–G) |
| Re-read by `registry_key` | **VERIFIED** for sampled keys |
| A OSM without URL | correctly not persisted |

Implementation vs runtime: **do not collapse** — direct Postgres path unproven here; product persist **is** runtime-proven via Supabase.

---

## 21. Full capability maturity matrix

| Capability | Code | Unit | Runtime | User-visible | Persist | Repeat | Overall |
|------------|------|------|---------|--------------|---------|--------|---------|
| 1A Semantics | ✓ | ✓ | ✓ | indirect | n/a | ✓ | **VERIFIED** |
| 1B Evidence schema | ✓ | ✓ | ✓ | why text only | ✓ fields | ✓ | **PARTIAL** |
| 1B Claim-correct evidence | ✓ weak | ✗ | ✗ C | ✗ | stamps wrong | ✓ | **FAILED** |
| 1C Directory gate | ✓ | ✓ | ✓ | ✓ (fewer junk dirs) | n/a | ✓ | **VERIFIED** |
| 1C Query-aligned qualify | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | **FAILED** |
| 1D Persist lifecycle | ✓ | ✓ | ✓ Supabase | hidden | ✓ | ✓ | **PARTIAL** |
| 1E Social provider | ✓ | mock | 404 | none | n/a | ✓ exec | **PARTIAL** |
| 1E Funding identity | ✓ path | extract | aggregators | aggregators | yes | ✓ | **FAILED** |
| 1F Free-first | ✓ | weak | ✓ | n/a | n/a | ✓ | **VERIFIED** |
| 1G Acceptance suite | ✓ | ✓ | soft | n/a | n/a | ✓ | **PARTIAL** |

---

## 22. Remaining gaps → Phase 1.1 candidates (document only)

1. **Claim-type gate:** evidence must match requested claim (role/service/opportunity/funding); reject funding evidence for developer queries.
2. **`evidenceFromWebHit`:** remove `|| funding` short-circuit; require funding language *and* funding query, or dedicated funding extractor.
3. **Funding identity:** distinguish startup entities from aggregator/list SERP pages; do not VERIFIED-persist lists.
4. **UI:** map `evidence`, scores, `disposition`, `verification_status` into Discover (or stop claiming user-visible evidence).
5. **VERIFIED bar:** tighten beyond SERP snippet (second source / page fetch) per L1.5 prose.
6. **Social:** fix Reddit endpoint/auth so live hits are possible; keep fail-closed.
7. **Host-key collapse:** Facebook/LinkedIn hosts overwrite distinct leads.
8. **Tests:** add adversarial fixtures for C/E/D; optional live SearXNG smoke behind env flag — **do not weaken** existing tests.

---

## 23. Manual testing readiness

### `YES — READY WITH KNOWN LIMITATIONS`

You can exercise Discover on the SPEC path safely if you treat results as **hypotheses**, especially for C/D/E.

### HOW TO TEST

1. Ensure local SearXNG is up (`http://127.0.0.1:8888`) and `.env` has `SPEC_SEARCH_ENABLED=true`, `SEARXNG_URL`, Supabase credentials.
2. Start the Vite app (`pnpm`/`npm run dev`) and sign in as usual.
3. Run these queries (answer mode prompts: **selling + websites** for A; **looking** for others):

| Try | Expect (honest) |
|-----|-----------------|
| `Toronto restaurants needing websites` | Few local businesses; why_match mentions **No website** / OSM — good demo |
| `companies hiring copywriters in New York` | Job-like cards with hiring why_match — best live-web demo |
| `founders needing developers in San Francisco` | May show **funding**-flavored why_match — **known bug** |
| `recently funded startups in Berlin` | List/aggregator pages — **known quality fail** |
| `companies needing marketing help in Austin` | May show jobs boards / agencies — **known quality fail** |
| `people looking for copywriters` | Sparse; Facebook groups possible; Reddit may add nothing |

4. Confirm UI: you should see **why_match** under results; you will **not** see evidence arrays or verification badges from SpecRow.
5. Optional: re-run audit battery  
   `npx tsx --env-file=.env scripts/phase1-verification-battery.mts`  
   and inspect `tmp/phase1-verification-traces.jsonl`.

---

## 24. Final verdict

### Manual testing readiness

**YES — READY WITH KNOWN LIMITATIONS**

### Final Phase 1 verdict

**PHASE 1 NOT VERIFIED — CRITICAL GAPS REMAIN**

Rationale: path-level Phase 1 goals (parse, gate, free-first, persist wire, social capability, funding planner) are largely **implemented and runtime-exercised**, but **critical claim-correctness and funding-identity failures** still produce “qualified / verified” leads that violate the product meaning of Phase 1. Unit green and empty-host templates being gone are **insufficient** for VERIFIED Phase 1.

### Trust question

**YES, WITH LIMITATIONS**

Trust the **pipeline plumbing** and A/G-shaped demos. Do **not** trust C/D/E cards (or VERIFIED persist of aggregators / wrong claim types) as ground truth for outreach.

### Recommended next choice (for you — not started by this audit)

- **A** — Manual UI test using HOW TO TEST above  
- **B** — Phase 1.1 against §22 gaps (claim-type gate, funding identity, UI mapping)  
- **C** — Reassess scope if “Phase 1 DONE” was meant only as plumbing  

---

## Appendix — Proof artifacts

| Artifact | Path |
|----------|------|
| Traces | `tmp/phase1-verification-traces.jsonl` (30 lines: meta, 20 extract, 7 runtime A–G, free_first_probe, social_probe) |
| Battery | `scripts/phase1-verification-battery.mts` |
| Unit | `src/lib/search/__tests__/phase1-acceptance.test.ts` — 19 passed |
| Prior hypotheses | `reports/universal-audit/09-post-implementation-reality-check.md` |

*End of independent Phase 1 verification.*
