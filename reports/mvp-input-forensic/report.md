# Scrapivo MVP input understanding: forensic pass

Scope: HEAD `7805e75e452d925a6d88e3db880622fdb2f35207` plus current working tree, read-only product diagnosis. No search engine, product code, database, S3, deployment, commit, or push changes. Existing unrelated worktree changes were left intact. Local diagnostic files are listed below.

## Result

The deterministic understanding path does not reliably carry arbitrary requests into execution. The failures occur at several distinct boundaries: number extraction can throw; extraction misses or misreads requested constraints; clarification does not catch unresolved placeholders; and the `UnderstandingFrame` to `SearchSpec` bridge drops most frame constraints. The UI has a separate verified-row progress loss. Production mini-browser behavior could not be observed.

## Exact relevant code

| Stage | Current files and entrypoints |
| --- | --- |
| UI branch and answers | `src/routes/_authenticated/discover.tsx:1549` `beginSearch`; `:1577` flag selection; `:691` `runSpec` call; `:709` clarification response; `:946` panel-answer mapping; `:2331` panel apply |
| Spec server | `src/lib/spec-search.functions.ts:1011` `runSpecSearchCore`; `:1112` understanding; `:1117` answer merge; `:1174` missing/readiness; `:1203` mode gate; `:2570` flag; `:2613` server call |
| Understanding | `src/lib/understanding/frame.ts:232` quantity schema, `:319` frame schema; `src/lib/understanding/extract.server.ts:482` LLM extraction; `src/lib/understanding/fallback.ts:413` quantity regex, `:435` quantity extraction, `:2006` deterministic extraction; `src/lib/understanding/validate.ts:682` validation; `src/lib/understanding/clarify-state.ts:90` blockers, `:572` sync; `src/lib/understanding/to-search-spec.ts:42` bridge, `:187` actionable gate, `:194` bounded provider/fallback |
| Legacy spec and clarification | `src/lib/search/search-spec.ts:46` spec, `:167` missing fields; `src/lib/search/search-spec-extract.ts:402` legacy parse; `src/lib/search/clarifier.ts:581` questions, `:801` answers, `:1257` decision; `src/lib/search/query-readiness.ts` ready-query gate; `src/lib/search/flag.ts` path selection; `src/lib/search.functions.ts:53` legacy server flow |
| Jobs/other callers | `src/lib/search-jobs.functions.ts:46`; `src/lib/jobs/search-job.types.ts:135`; `src/lib/jobs/pass-runner.server.ts:22`; `src/lib/research-agent/orchestrator.server.ts:581` |
| UI/browser | `src/components/discover/clarify-panel.tsx:30`; `src/components/discover/thinking-steps.tsx:19`; `src/components/discover/scrapy-browser.tsx:14`; `src/components/discover/understanding-inspector.tsx:15`; `src/lib/search/live-gapfill.ts:699`; `src/lib/search/browser-live.server.ts:938`; `src/lib/search/search-browser-progress.server.ts:57`; `src/lib/search/activity-presenter.ts:68`; `src/lib/search/scrapy-browser.server.ts:41`; `src/lib/research-agent/playwright-browser.server.ts:128` |

Focused test/probe files: `src/lib/understanding/understanding.test.ts`, `src/lib/understanding/extract.server.test.ts`, `scripts/verify-understanding.mts`, `scripts/battery-spec-inputs.mts`, and the local diagnostic `reports/mvp-input-forensic/stress-probe.mts`.

## Current execution path

1. `discover.tsx:1549-1592` records a new turn, clears prior answers, reads `getSpecFlag`, and chooses spec path when enabled. Otherwise it uses the legacy classifier/clarifier (`:1594-1668`). Production flag value was not verified.
2. Spec path calls `runSpecSearch` (`discover.tsx:691-704`; `spec-search.functions.ts:2613`). `runSpecSearchCore` calls `understandSearchSpec` unless given an injected spec (`:1112-1114`).
3. `understandSearchSpec` uses bounded LLM extraction; provider failure, cancellation, or 12-second timeout returns deterministic fallback (`to-search-spec.ts:194-212`). Under Vitest it always uses deterministic fallback (`:195`). Validation and `frameToSearchSpec` follow.
4. Bridge starts with the legacy parser's criteria, overwrites selected target/location/relation fields, and copies only `content_topic` from `frame.constraints` (`to-search-spec.ts:45-60,90-181`). `SearchSpec` is then checked by `computeMissing`, query readiness, and mode questions (`spec-search.functions.ts:1174-1203`).
5. Panel answers are converted to a limited field map (`discover.tsx:946-998`), sent as `answers`, and merged into criteria (`spec-search.functions.ts:1117-1125`). A new free-text submission calls `beginSearch` and clears prior answers (`discover.tsx:1557-1573`).
6. When retrieval runs, verified browser rows can be emitted by `browser-live.server.ts:938-960`. Progress stores a presentation object (`search-browser-progress.server.ts:57-65`) that omits the row (`activity-presenter.ts:68-80`). The UI's in-progress verified cards need that row (`discover.tsx:2262-2276`).

## Stress evidence

Commands run:

- `rtk vitest run src/lib/understanding/understanding.test.ts src/lib/understanding/extract.server.test.ts`: **157 pass, 1 fail**. Failing architecture guard at `understanding.test.ts:77,114` flags the live bridge's import of legacy `extractSearchSpec` (`to-search-spec.ts:2,45`).
- `rtk npx tsx scripts/verify-understanding.mts --deterministic --seed 20260928 --holdout 24 --chaos 24 --set holdout`: **24/24 partial checks**, **3/3 adversarial pairs distinct**. This run graded deterministic HOLDOUT only. It did not execute CHAOS or LLM extraction. Report: `reports/understanding/gate1-2026-09-29T00-41-36-339Z-seed20260928.md`.
- `rtk npx tsx reports/mvp-input-forensic/stress-probe.mts`: 12 targeted prompts in fixed-seed shuffled order; **3 extraction crashes**, **9 returned frames**. Full inputs and frames: `reports/mvp-input-forensic/stress-results.jsonl`. Case order is randomized; prompt content was deliberately designed, not randomly generated.

| Input / observation | Failure stage and evidence |
| --- | --- |
| `Find remote startup jobs using React and TypeScript, hiring globally, paying at least $100,000 per year.` and `$100,000 per year` and the `$150,000` variant throw `quantity.requested` must be >0. | `fallback.ts:413-431,478-510` quantity matcher can read the `000` portion as a bare count; `frame.ts:233` rejects zero when final frame is parsed at `fallback.ts:2593`. Three of 12 probes crash before clarification. |
| `Find startup founders in Gdansk that recently raised, are hiring, and have at least this much revenue.` returns no revenue constraint and `clarification.needed=false`. | Placeholder is lost in deterministic extraction and not caught by `clarify-state.ts:90-269`; execution can proceed without the requested threshold. |
| `Find investors in Southeast Asia actively writing checks into pre-seed AI companies.` yields location `Southeast Asia actively writing`, relation `none`, then asks where/what. | Location segmentation and investor intent fail in fallback; validation preserves a contaminated location; clarification asks a question already partly answered. |
| Dhaka D2C long prompt retains contact fields but loses active marketing and last-post verification. Camrose no-website prompt recovers website absence yet loses active online presence and contact requirement. | Extraction/validation loss before spec conversion (`fallback.ts:2006`, `validate.ts:682`). No clarification is raised in these frames. |
| Voice-style `d two c` Dhaka prompt yields unknown entity and treats `need email` as `needs_service`. Research-only `I am not selling anything` yields negative service constraints. | Fallback entity/relation parser misreads dictated and goal language. Exact frames in JSONL. |
| A frame can retain a numeric revenue constraint but SearchSpec has no corresponding transfer. | `to-search-spec.ts:60` starts from legacy criteria; `:158-163` transfers only `content_topic`. `search-spec-extract.ts` has salary and investor slots, but no revenue criterion. This is bridge loss even when extraction succeeds. |

The 24/24 holdout result does not contradict these findings. Its expectations cover selected entity, relation, direction, location and evidence fields; the report itself says they are partial. The 12-case probe included salary formatting, requested deliverables, placeholders, and research/commercial intent. No live provider or full retrieval stress run was made.

## UI, provider, and browser findings

- `thinking-steps.tsx:19-38` uses user-facing stage names and hides internal retrieval tiers. `activity-presenter.ts:14-80` maps known sources and removes unknown source labels, but unknown action text can pass through unless its specific redaction regex matches. This is a potential provider-leak path, not an observed production leak.
- `discover.tsx:2202-2282` renders `ScrapyBrowser` only while spec search is pending with progress events. `scrapy-browser.tsx:58-59` additionally requires state and `pagesVisited > 0`. `live-gapfill.ts:699-733` starts browser work only when verified candidates are below target. Therefore absence of browser UI can be expected even when a search returns results.
- `scrapy-browser.tsx:109-119` displays screenshots; Take Control is disabled (`:140-149`). The widget is a view of a Chromium run, not an interactive browser.
- `scrapy-browser.server.ts:41-46,129-143` keeps run state in a process-local map; screenshots use local paths (`src/lib/research-agent/playwright-browser.server.ts:128-133,287-299`). Serverless cross-invocation continuity is a plausible risk. This is a code inference, not a confirmed production failure.
- `browser-live.server.ts:938-960` emits a verified row; `activity-presenter.ts:68-80` drops it; `discover.tsx:2262-2276` needs it for in-progress cards. This is a definite progress-data loss in code.
- The parse-only `?inspect=1` route is separate from search (`discover.tsx:109-118`); `understanding-inspector.tsx:266-281` exposes provider/prompt diagnostic details there. The main search UI does not use this inspector.
- `.env.example:160` names `https://scrapivo-beta.vercel.app`. No browser surface was available, and the URL did not open through the available web tool. Deployed UI, provider leakage, and production mini-browser behavior remain **unverified**. Local browser end-to-end behavior was not run.

## Minimal implementation pass recommendation

1. Keep the engine and `SearchSpec` stable. First add focused regression cases for the three salary crashes, placeholder clarification, investor geography, D2C/Camrose activity and deliverables, voice-style input, and research-only intent. Assert both frame and final spec/execution criteria.
2. Correct the smallest responsible extractor/validation rules evidenced by those cases. Make unresolved numeric placeholders block execution. Preserve recognized requested fields and activity/recency requirements.
3. Add explicit, tested transfer for supported frame constraints at the `frameToSearchSpec` boundary, or an explicit unsupported-constraint signal. Check that retrieval and qualification actually consume each transferred field before claiming enforcement.
4. Make single-phrase follow-ups use the pending clarification context or ask when no context exists. Verify panel answers and new-turn behavior separately.
5. Preserve verified row data in progress presentation. Make mini-browser display lifetime and state storage match the intended deployed behavior. Then perform authenticated production browser checks and inspect provider text before release.

Stop here for user review. No implementation was made.

## Checkpoint

Finished: current code map, focused deterministic stress probes, test baseline, UI/browser code diagnosis, stage-level hypotheses, minimal plan. Saved: this report, `stress-probe.mts`, `stress-results.jsonl`, generated holdout report and case JSON. Failed/blocked: one architecture test; three targeted extractor crashes; production browser verification unavailable. Next: review findings, then authorize a separate surgical implementation pass.
