# Private browser worker, human takeover, understanding repairs and delivery-honesty pass

This change moves research browsing into a private Chromium worker that requires a token. Sessions persist per run, and all traffic goes through an egress proxy that pins DNS answers. The visible browser gains human takeover. The understanding layer gains LLM-frame repairs and a world gazetteer. Delivery gains a candidate ledger and one strict judge for both streamed and delivered leads. Scope: areas A–E only, reviewed by reading the code; no tests, builds or scripts were run.

Watch for: a same-run re-create silently takes control back from a person (confirmed). Sessions a person controls are never reaped (confirmed). "contact info" ends up requiring email AND phone on the LLM path (confirmed). The streamed-lead scrub hides real lead names and URLs (confirmed).

**Verdict**: NEEDS_CHANGES (ship-with-fixes: no blockers, four should-fix, seven nits). All four should-fix items and five nits were fixed afterwards; see "Resolution" at the end.

## High-level view

A, worker boundary: no findings. Checked SSRF (redirects, subresources, WebSockets, IPv6, metadata hosts, loopback bypass), DNS rebinding, token handling, owner scoping of every session operation, no read after a cancelled navigation, and error sanitization.

A, session lifecycle: this is where the gaps are. Human control is not exclusive when the same run creates its lane again. Sessions a person controls are exempt from the idle sweeper, while the adapter's failed-close path assumes the sweeper will reclaim them.

B, takeover path: no findings of its own. The exclusivity break above surfaces here.

C, understanding repairs: the generic-contact filter runs before the deterministic recovery loop. A new fallback rule emits email and phone for "contact info", so the loop restores what the filter removed. The contact regex also lacks a negation guard. Typo repair through the gazetteer is always silent.

D, delivery honesty: the gates hold. The regression is presentational: the widened `INTERNAL_RE` now scrubs lead titles, why-match text and URLs, not only telemetry. No findings in `source-health`, `outcome-ui`, `website-status`, `trimEvents` or `json_validate_failed`.

E, persistence guard: no findings. The flag is ignored under `NODE_ENV=production`, `VERCEL` or `VERCEL_ENV`. By design, a local production-mode preview therefore writes to the prod-backed project even with the flag set.

<details>
<summary>Issues (11)</summary>

1. **Takeover revoked by same-run re-create** (should-fix, `src/browser-worker/session-manager.ts:369`, confirmed). In an OR-location query, the next branch creates its lane again, finds the retained one, and flips `controller` to agent. The registry reset does the same, so the person is kicked out mid-takeover. Fix: keep human control on re-create, and preserve controller/retained in `scrapySessionStarted`.
2. **Human-controlled sessions never reaped** (should-fix, `session-manager.ts:385`, `src/lib/research-agent/worker-browser.server.ts:199`, confirmed). After an app restart or a failed close, an active human lane holds one of the two global slots forever. Two leaks force every run onto the in-process fallback. Fix: reap on idle `touched`, or demote to retained.
3. **"contact info" requires email + phone on the LLM path** (should-fix, `src/lib/understanding/to-search-spec.ts:59-73` vs `:168-173`, `src/lib/understanding/fallback.ts:1775`, confirmed). The recovery loop re-adds the channels the generic-contact filter dropped, so phone-only businesses fail with `MISSING_QUERY_REQUIRED`. Fix: filter after recovery, and limit the fallback rule to "all contact details".
4. **INTERNAL_RE scrubs lead data** (should-fix, `src/lib/search/activity-presenter.ts:82,140,147`, confirmed). A streamed "Care Provider Ltd" becomes "Verified result", and its why-match and `home-care-provider.co.uk` link are dropped. Fix: scrub system text only; in rows, drop only exact infrastructure hosts.
5. **Contact ask has no negation or compound guard** (nit, `to-search-spec.ts:28` + `fallback.ts:1775`, confirmed). "Restaurants without contact info" becomes a contact requirement, which inverts the ask, and "BPOs with a contact center" invents one. Fix: skip matches preceded by without/no/lacking or followed by center/centre.
6. **"founders of agencies/brands" drops the org noun** (nit, `fallback.ts:2346-2353`, likely). Only startups is kept, as `company_stage`. "Founders of agencies in Leeds" loses "agencies", unless a later pass re-harvests it (not traced). Fix: map agencies/brands to `business_type`.
7. **Typo repair is always silent** (nit, `src/lib/understanding/validate.ts:1571`, confirmed). Fuzzy (provisional) matches are promoted into canonical + country_code, so the `locationSuggestion` branch at `to-search-spec.ts:250` never fires for them. A real place missing from GeoNames that is one edit from a listed city gets swapped. The tests assert this behavior, so either require `resolution === "resolved"` in validate or delete the dead branch.
8. **Cross-owner eviction not serialized** (nit, `session-manager.ts:268`, confirmed). `launch()` closes another owner's retained lane outside that lane's queue, so an in-flight takeover input fails with `WORKER_FAILURE`. Fix: `serial(oldest.id, () => closeInternal(oldest))`.
9. **Chromium env denylist misses URL credentials** (nit, `session-manager.ts:100`, confirmed). `POSTGRES_URL`, `REDIS_URL`, `*_DSN` and `*_URI` reach the browser process. Web content can't read them, but crash dumps and child processes can. Fix: switch to an allowlist.
10. **Ledger merges namesakes** (nit, `src/lib/search/candidate-ledger.ts:57`, `src/lib/spec-search.functions.ts:2531`, confirmed). Identity falls back to title|company, and the lead-view refusal map is keyed by title. A dropped streamed chain branch hides behind a delivered one, or a delivered row is reported as rejected. Fix: key by `entity_id`/`key`.
11. **Fallback report lost when the fallback also fails** (nit, `src/lib/search/browser-live.server.ts:1255`, confirmed). `runtimeInfos` are logged only after `createSession` succeeds, so "worker → playwright (WORKER_UNAVAILABLE)" disappears when Playwright then fails to start. Fix: emit them in catch/finally.

</details>

<details><summary>Details</summary>

### A person's control is revoked by the next branch of the same run

The worker keys a lane by (owner, runKey), and runKey is the search run id. Multi-location queries run `runSpecSearchCore` once per place, one after another, with the same `deps` (`spec-search.functions.ts:1441-1450`). So branch 2's `createSession` lands on branch 1's lane.

```
branch 1 ends   → close(retain) → status=retained, controller=human (person driving)
branch 2 starts → create(same owner+runKey) → session-manager.ts:369 → controller=agent
                → scrapySessionStarted resets registry: controller=agent, retained=false
person's next click → NOT_IN_CONTROL; the agent navigates the page they were using
```

The adapter already waits out `HUMAN_CONTROL`, so keeping `controller: "human"` on re-create is enough for the agent to pause correctly.

### Sessions a person controls never expire

The sweeper's idle branch requires `controller === "agent"`, and only retained lanes have a separate expiry. Suppose a person takes control during a live run and then the app process restarts (dev HMR) or the 15 s close POST fails. The adapter swallows the failure on the stated assumption that the sweeper reclaims the lane. It never does. After a restart the in-memory registry is gone too, so the person can't give control back either. `launch()` can evict only retained lanes, so the leaked lane keeps its `maxActive` slot until the worker restarts. With the default of two, two leaks mean every run falls back to in-process Playwright. The fallback is reported, but the worker is effectively disabled.

### The generic-contact repair undoes itself on the LLM path

For "plumbers in Leeds with contact info", `normalizeSearchFrame` drops email and phone because the user named neither, and adds `contact`. The LLM-only block then recovers every deterministic required field. The new `fallback.ts:1775` rule emits email and phone for any "contact info", so both come back. The LLM path ends up requiring contact + email + phone, while the deterministic path for the same words requires any one channel. The strict judge then rejects phone-only local businesses on the main path. The same rule also turns "without contact info" into a requirement (issue 5).

### INTERNAL_RE now scrubs lead data

`publishSearchBrowserProgress` stores `presentActivityEvent(rawEvent)`. The regex now includes everyday words (provider, adapter, unreachable, osm, s3) and real company names (foursquare, supabase, duckduckgo), and it is applied to `row.title`, `why_match` and URL hostnames. For "home care providers in Leeds", streamed cards read "Verified result", lose their why-match line, and lose links on hosts like `home-care-provider.co.uk`. The ledger records raw titles, so the reconciliation note and the cards name the same leads differently. Final delivered rows are not affected.

</details>

<details><summary>File map</summary>

- `src/browser-worker/network-guard.ts`, `egress-proxy.ts`: public-IP allowlist, pinned DNS, proxy that dials the validated address
- `src/browser-worker/session-manager.ts`: persistent profiles, serial queues, takeover, retention and sweeper
- `src/browser-worker/routes.ts`, `errors.ts`; `src/research-worker/server.ts`: token-gated `/browser/*` routes, mount, shutdown
- `src/lib/research-agent/browser-worker-{config,client}.server.ts`, `worker-browser.server.ts`, `browser-runtime.server.ts`: config, client, adapter, reported fallback
- `src/lib/search/scrapy-browser-control{,.server,.functions}.ts`, `src/components/discover/scrapy-browser.tsx`: takeover contract, server function, UI
- `src/lib/understanding/{to-search-spec,fallback,validate}.ts`: frame repairs, contact-info rule, gazetteer canonicalization
- `src/lib/search/location-resolver.ts`, `gazetteer.server.ts`: qualified and typo gazetteer modes
- `src/lib/search/candidate-ledger.ts` + hooks in `spec-search.functions.ts`: fate bookkeeping, post-research judge
- `src/lib/search/{live-gapfill,source-health,outcome-ui,website-status,activity-presenter}.ts`: seed gate, health sentence, chips, public text
- `src/lib/search/{search-browser-progress.server,browser-live.server}.ts`, `src/lib/ai/providers.ts`: row retention, provenance, close outcome, JSON-mode failover
- `src/lib/persistence-policy.server.ts`: local no-persist flag with a production fail-safe

Full diff: `git diff 7805e75` plus the untracked files in `git status`.

</details>

## Resolution (applied after the review, all with regression tests)

| # | Item | Resolution | Test |
|---|---|---|---|
| 1 | Takeover revoked by same-run re-create | `create()` keeps `controller` when a run re-uses its retained lane; `scrapySessionStarted` keeps a person's control for the same lane and owner | `session-manager.test.ts` (real Chromium), `scrapy-browser-control.test.ts` |
| 2 | Person-controlled lanes never reaped | Idle sweeper reclaims any untouched lane; a watching mini-browser polls frames, which counts as a touch | `session-manager.test.ts` idle test |
| 3 | "contact info" = email AND phone on the provider path | Generic-contact normalization moved after the provider recovery loop, so both paths agree (any channel); "all contact details" keeps both | `founder-path.test.ts` |
| 4 | `INTERNAL_RE` scrubbed lead data | Lead titles and locations are shown as observed; links dropped only for infrastructure hosts (loopback, private ranges, internal suffixes, our database/storage platforms, embedded credentials); why-match dropped only when it names our pipeline | `activity-presenter.test.ts` (contract updated), `privacy-and-guided-pills.test.ts` |
| 5 | Contact ask without negation guard | "without/no … contact/email/phone" and "contact center" are not requirements | `founder-path.test.ts` |
| 6 | "founders of agencies" lost the noun | Only generic organization nouns are stripped from the role | `founder-path.test.ts` |
| 7 | Typo repair is silent | Kept by design (matches the existing overlay behavior and the stress corpus); recorded as a known limitation | — |
| 8 | Cross-owner eviction not queued | Eviction runs behind the evicted lane's queue | covered by the worker suites |
| 9 | Chromium env denylist | Also drops `*URL*`, `*URI*`, `*DSN*`, `*PROXY*`, cookie/webhook names and any value with embedded `user:pass@` credentials | — |
| 10 | Ledger namesakes | UI-projection refusals are matched per row, not by title; the title+company fallback identity stays (key changes across merges) | — |
| 11 | Fallback report lost when the fallback fails | Runtime events are flushed in a `finally` around session creation | `runtime-fallback-trace.test.ts` |
