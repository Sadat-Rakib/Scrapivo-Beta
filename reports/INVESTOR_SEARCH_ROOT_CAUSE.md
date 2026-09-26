# INVESTOR_SEARCH_ROOT_CAUSE

Trace: `src/routes/_authenticated/investors.tsx:132,159-209` builds
`{query,stage,location,sector,checkBand,entityType}` → `runInvestorSearch`
(`src/lib/investors.functions.ts:10-40`) → `searchInvestorsWithMeta` →
`runInvestorPipeline` (`src/lib/investors/search.ts:418-579`).

## Root cause (compound, ordered)

1. **Wrong file live.** Page statically imports dirty `investors_merged.json`
   (`search.ts:6`, 8098 rows). Clean `investors_complete.jsonl` (1252 rows,
   `completeness>=8` + email + site/linkedin bar) reachable only via orphan
   `local-file-source.ts:33` used solely by unified discover
   (`search.functions.ts:364`). Locked decision: merged is NOT demoted by deletion —
   both preserved in `raw/investors/`; canonical schema proposed in
   SCHEMA_PROPOSALS.md, sufficient/incomplete split AFTER profiling.
2. **Schema drift → silent wipeout.** Merged rows lack `entity_type/investor_type`
   (any `investorType≠any` false for all), lack `sweet_spot/check_*` (band no-op),
   `type:"venture_capital_investor"` breaks `isFirmRecord/isIndividual`
   (`types.ts:101-113`); sector primary `investment_categories` absent.
3. **Vercel fs miss.** Single-dir `resolve(process.cwd(),"data/...")` + silent
   `return []`; Vercel cwd `/var/task/.output/server`; no `includeFiles`.
4. **Bundle + Groq.** 15.8MB static JSON in Nitro bundle; `expandSectorTerm`
   (`search.ts:472`) single-key Groq, no rotation/timeout → hobby-timeout zeros
   masked by `broadened`.
5. **Ranking inversion.** `profile_photo.local_path` ignored by `investorImageUrl`;
   merged `completeness:6` example fails the old `>=8` bar.

## Repro

`Aaref Hilaly` → expect `ent-5fc096e79efd` → page queries merged set (string
`cheque_size`, no email) → demoted/filtered; unified path `[]` on Vercel.
Same: `Aaron Samuels/Collide Capital`, `Rebecca Redfield/.406 Ventures`.

## Fix (needs approval, staged)

S3-backed single loader (both callers), canonical investor schema + adapters,
tolerant `investorType`, loud missing-source log, Groq key rotation
(`GROQ_API_KEY[_2..N]`, 2s timeout, deterministic fallback), sufficient set to
search/index. Tests: known-investor fixtures per entity.
