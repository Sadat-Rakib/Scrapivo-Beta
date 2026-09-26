# Gate 1 — LLM understanding validation

Companion to the deterministic completion report, which it does not replace. That one
answers "does keyword extraction hold up when no model is reachable". This one answers
the question the gate actually turns on: **when a real model reads a real sentence, is
the frame a faithful reading of what the person meant?**

Scope was `src/lib/understanding/**`, `src/lib/ai/**`, the grader, the corpus and the
Inspector. Nothing in retrieval, SearchSpec, the database, SearXNG, OSM, scrapers,
enrichment or qualification was touched, and no frame→legacy-SearchSpec adapter was
written.

No API key value appears in this file, in any test, in any report artifact, or in any
log line. Provider diagnostics carry the gateway id, the model id, an HTTP status, a
latency and a failure class — nothing else. `.env` is gitignored and was read only to
discover variable NAMES.

---

## 1. Provider certification

Six gateways are configured. `npm run ai:probe` sends each a ~40-token structured
extraction task — never the understanding prompt — and reports auth, model
reachability, JSON validity, schema adherence and latency. Last full probe:
2026-09-17 07:14 UTC.

| gateway | configured | auth | models probed | verdict |
| --- | --- | --- | --- | --- |
| **NaraRouter** | yes | PASS | 4 | **CERTIFIED** — 3 of 4 models answer, JSON + schema clean |
| **Groq** | yes | PASS | 2 | **CERTIFIED for reachability, UNMEASURED semantically** — daily request budget spent before the battery completed |
| **OpenRouter** | yes | PASS | 4 | **EXCLUDED** — every `:free` model is at `free-models-per-day`; unlocking needs account credit |
| **APInex** | yes | PASS | 2 | **EXCLUDED — account_action_required.** Both free models answer `Daily check-in required to use free models`. A human must visit the dashboard each day; a production ladder cannot depend on that |
| **KiosAPI** | yes | **FAIL 401** | 2 | **EXCLUDED — auth.** The account's own base host answers `Otorisasi ditolak: kredensial tidak valid` to the configured key. Not an understanding failure; the credential is not valid at the endpoint this account was given |
| **TokenForge** | yes | PASS | 0 | **EXCLUDED — model_missing.** The gateway authenticates and exposes no usable model id for this account; nothing to probe |
| DeepSeek / Moonshot / GLM | no | — | — | unconfigured, not part of this work |

Four new keys were supplied. Two gateways earned a place. That is the intended outcome —
per the brief, semantic quality outranks provider count, and a large unreliable ladder is
worse than a small certified one.

**Nothing enters the ladder on an HTTP 200.** KiosAPI and TokenForge are out on transport
grounds; APInex is out on an operational ground (a daily human action); OpenRouter is out
on budget. Only NaraRouter produced parseable, schema-valid structured output repeatedly
enough to grade.

---

## 2. Model certification

A gateway exposing a model is not a certified model. Each candidate had to answer the
real 14-case adversarial battery (`scripts/understanding-fallback-cert.mts`) — six pairs
of prompts that mean *opposite* things, plus two singletons. A pair that collapses into
one semantic core is disqualifying regardless of everything else.

| model | pairs distinct | probes read correctly | unanswered | p50 | verdict |
| --- | --- | --- | --- | --- | --- |
| `nararouter:laguna-s-2.1` | 6/6 | 12/12, then 11/12 on a repeat | 0 | 12.0 s | **PRIMARY** |
| `nararouter:agnes-2.5-flash` | 6/6 | 11/12 | 0 | 8.0 s | **CERTIFIED FALLBACK #1** |
| `nararouter:stepfun-3.7-flash` | 6/6 | 10/10 | 2 | **146 s** | **REJECTED — latency + schema** |
| `groq:openai/gpt-oss-20b` | 6/6 | 1/1 | 11 | 0.9 s | **UNMEASURED — budget** |
| `nararouter:agnes-3-flash` | — | 0/0 | 12 | — | **REJECTED — account_action** |

Why each verdict:

- **`laguna-s-2.1` is primary on semantics, not on speed.** It is the only candidate that
  kept "kebab shop" as the category instead of widening it to "restaurant" — the
  open-vocabulary behaviour the whole frame is built around. Across two battery runs it
  answered every call and collapsed no pair. The one miss on the repeat run was
  *"colourists in Ostrava looking for studio work"*, which it read correctly in the other
  run — run-to-run variance on a borderline phrasing, not a systematic direction error.
- **`agnes-2.5-flash` is the fallback**: faster (8.0 s p50) and a shade less careful. Its
  miss is real and worth knowing — it read *"investors funding kelp farming startups"* as
  a search for PEOPLE rather than investors. Direction and mode were right, so it is a
  sound second choice and not a primary.
- **`stepfun-3.7-flash` was semantically strong and is still rejected.** 6/6 pairs, but a
  146 s median and two responses that failed Zod outright (`task_type: Required;
  prospecting_mode: Required; …`). A model that takes two minutes and sometimes returns an
  unusable shape is not a fallback; it is an outage with extra steps.
- **`agnes-3-flash` is parked permanently.** It answers `403 {"type":"forbidden","message":
  "Your plan does not include the requested model."}`. This was initially misclassified as a
  transient rate limit, so the router kept retrying it — see §7.
- **`groq:openai/gpt-oss-20b` collapsed no pair in its single answered call.** One probe is
  not a certification. It stays out of the ladder until it can be measured.

Shipping ladder (`DEFAULT_UNDERSTANDING_LADDER`, `src/lib/ai/providers.ts`):

```
nararouter:laguna-s-2.1      (primary)
nararouter:agnes-2.5-flash   (fallback #1)
→ deterministic understanding → validator → UnderstandingFrame
```

Two certified models, not four. No uncertified model is reachable merely because its
gateway offers it free.

---

## 3. The three LLM runs

All three ran with `--require-llm --no-cache`, provider and model pinned, one call at a
time and paced. **`fallback_used = false` on every frame of every run** — no deterministic
frame was graded as if a model had produced it.

| run | seed | cases | automated | p50 | p90 | max | fell back | prompt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SMOKE | 47713 | 12 | **12/12** | 12.3 s | 16.8 s | 22.7 s | 0 | `u1-v6` |
| HOLDOUT | 90211 | 24 | **24/24** | 9.2 s | 13.5 s | 19.6 s | 0 | `u1-v6` |
| CHAOS | 41377 | 16 | **14/16** | 10.9 s | 22.2 s | 58.6 s | 0 | `u1-v6` |

Failure-mode tally across all 52 LLM frames:

| failure mode | count |
| --- | --- |
| collapsed adversarial pairs | 0 |
| wrong direction | 0 |
| wrong target | 0 |
| wrong relation | 0 |
| location contamination | 0 |
| temporal contamination | 0 |
| quantity loss | 0 |
| compound loss | 0 |
| unnecessary clarification | 0 |
| extraneous / invented capture | 0 |
| blocking validator violations | 2 (CHAOS, both the same cause) |

Every frame was read by hand against the 22 axes in the brief (task, mode, target,
role/category/industry, subject, relation, object, direction, location, temporal,
quantity, constraints, user context, required, preferred, verification, output, compound,
clarification, invented, missing). Manual reading found five things the automated
checks did not, and each was traced to a cause rather than patched at the case:

1. **`h002b` — `entity_type = business` where the corpus wanted `company`** ("haulage
   startups"). Not a model error: the vocabulary does not distinguish the two. Fixed in the
   corpus and documented in `vocab.ts`.
2. **`h007`, `h023` — deliverable field names not canonical** ("phone number" vs `phone`).
   A real systemic gap: nothing normalised the *names* of requested fields. Fixed with
   `DELIVERABLE_FIELD_PATTERNS` + `keyDeliverableField()` and a canonicalise-and-dedupe
   pass in the validator.
3. **`h012`, `h013` — "quantity lost" on "within 10 miles"**. Grader bug: the radius lives
   on `location.radius`, which `QUANTITY_NOT_LOST` never read. Fixed in the grader.
4. **`h016` — `category = "firm"`.** Cleanup A was implemented in the deterministic path
   only, so the LLM path could still restate the entity type as a category. Moved the
   generic-descriptor veto into the validator, where both paths meet.
5. **`c008`, `c015` — the two CHAOS failures.** Both are *"… funded this yr …"*:
   `temporal.relation` and the raw span were right, `temporal.year` was null. The validator
   had no way to derive a year from a relative phrase. Fixed with `yearFrom()` and a
   `TEMPORAL_YEAR_DERIVED` repair code. The prompt and the model were not at fault.

Two findings were *not* defects and are recorded so they are not re-investigated:
"founders names" was never lost in `c008`/`c015` — it was correctly filed under
`enrichment_requirements`, which the compact grading sheet does not print; and
`entity_subtype` on `h006` was likewise present but unprinted.

---

## 4. The two semantic cleanups

**Cleanup A — generic head nouns no longer become categories.** "companies in Napier
hiring quantity surveyors" yielded `entity_type = company, category = companies`. It now
yields `category = null`. The wording survives in `entity_type.raw`, `relation.subject`,
`input.raw` and the trace, so nothing is discarded — it simply stops pretending that
restating the entity type is a narrowing category. The veto list (`GENERIC_TARGET_WORDS`
in `lexicon.ts`) covers businesses / companies / people / persons / investors / jobs /
organizations. Real narrowing categories — marketing agency, kebab shop, coffee roaster,
HVAC contractor, veterinary clinic — are untouched. Enforced in the validator, so both the
LLM and deterministic paths obey it, with invariant tests.

**Cleanup B — investment prospecting has its own modes.** `fit_based` was too weak to
steer later source selection. Added systemically, not as a patch:

| request | mode |
| --- | --- |
| investors in Berlin | `fit_based` |
| investors funding climate startups | `investment_based` |
| startups seeking investors | `funding_based` |
| startups that raised Series A recently | `event_based` |

The adversarial battery confirms both directions hold on live models: `investor →
investment_based → investing_in → kelp farming startup` against `company →
funding_based → seeking_funding → investor`.

Beyond these two cleanups the deterministic engine was frozen. The only other
deterministic edits were confirmed defects: the `plausiblePlace` morphological veto (it
read "automation" in "warehouse automation" as a place) and the three validator repairs
listed above. No keyword expansion, no tuning against individual HOLDOUT prompts.

---

## 5. Deterministic engine health

Unchanged in character and still the floor under the ladder. Latest full regression
(seed 52779, 248 cases, no model calls, p50 1 ms):

| set | cases | passed |
| --- | --- | --- |
| TRAIN | 88 | 88/88 |
| HOLDOUT | 80 | 80/80 |
| CHAOS | 80 | 79/80 |

Eleven other seeds ran 248/248. The single failure is `c012a` — *"ivnestors funding
defence startups in split"* — where the typo'd head noun defeats keyword matching and
the target is read wrong. That is the honest shape of a keyword fallback: it degrades on
misspelled head nouns, which is precisely what the LLM layer above it is for. It is
recorded as a known limit, not fixed by adding "ivnestors" to a dictionary.

Unit tests: **89/89** (`src/lib/understanding`). Typecheck: **0 errors** in
`src/lib/understanding/**` and `src/lib/ai/**`; 75 pre-existing errors elsewhere in
`src/lib/search/**` and `src/lib/spec-search.functions.ts`, which are out of scope and
were deliberately left alone.

---

## 6. Prompt cost

The brief's "~4.1k tokens" was an estimate from character counts. Provider-reported
usage is the real figure, and it is higher. Measured mean input tokens per case over the
same 14-case battery, same model, same seed:

| prompt | mean input | mean output | p50 | p90 | verdict |
| --- | --- | --- | --- | --- | --- |
| `u1-v6` | **5,199** | 283 | 13.7 s | 24.9 s | baseline |
| `u1-v7` | **4,916** | 178 | 10.2 s | 11.9 s | **ACCEPTED** (−283 in, −105 out, −3.5 s p50) |
| `u1-v8` | 4,675 | 178 | 11.5 s | 17.0 s | REJECTED |
| `u1-v9` | 4,776 | 175 | 11.0 s | 15.5 s | REJECTED |
| `u1-v10` | 4,790 | 192 | 11.2 s | 18.0 s | REJECTED |

`u1-v7` is what ships: the few-shot block was compressed (confidence scores dropped from
examples except the five closed fields where `clarify-state.ts` genuinely reads them at
its 0.4 threshold, and `evidence.reasons` stripped), and the rules that survived were
kept verbatim. One genuine regression appeared in the comparison — a verification entry
for a *stated absence* stopped being emitted — and was fixed by restoring the rule's full
wording before acceptance.

**Three further compressions were attempted and all three were rejected.** v8, v9 and v10
each bought 3–5% and each reintroduced a specific known failure mode the deleted prose
existed to prevent:

- removing the "businesses looking for web designers" clarifier flipped direction on `p3`;
- compressing the narrowing-words rule contaminated the target on `p6`;
- shortening the verification rule brought back substitution of a neighbouring
  verification kind on `p12`.

A control run (v7 against its own baseline) separated real regressions from run-to-run
noise: the "review"-class differences appear in the control too, the **blocking** ones
only under compression. That is the evidence for the conclusion: **the remaining prose is
load-bearing, not padding.** `extract.server.ts` was reverted to `u1-v7` with the failed
attempts documented at the version constant so the next reader does not repeat them.

The desired 1,000–1,500 token range was **not reached**, and per the brief's own ordering
— quality over token count — it should not be reached this way. The honest next lever is
architectural (a smaller schema, or moving examples behind provider-side prompt caching),
not further deletion of rules.

Comparison tooling is `scripts/understanding-prompt-compare.mts`. It projects each frame
to a `Shape` that deliberately drops confidence, provenance and raw spans, classifies
each difference as **blocking** (direction flip, lost constraint, dropped subgoal,
invented field) or **review** (softer wording changes for a human), and carries a
`SHAPE_VERSION` so a baseline recorded under an older projection is never silently
compared against a newer one.

---

## 7. Provider plumbing

One abstraction, not four clients. Every gateway is a row in the registry in
`src/lib/ai/providers.ts` (`protocol`, `keyEnv`, `baseUrl`, `model`, `capabilities`,
`health`) and all of them feed the existing `aiCompleteDetailed()`. The understanding
engine cannot tell which gateway answered.

Failover fires on timeout, connection failure, 429, quota exhaustion, cooldown, 5xx,
model-unavailable, empty response, and an unparseable response after exactly one repair
attempt. It does **not** fire repeatedly on 401, 403-account-restriction, permanently
unsupported model, or a bad base URL — those mark the provider misconfigured for the run.
`Retry-After` is honoured, and daily quota exhaustion is held separately from
minute-level throttling because waiting helps for one and not the other.

**One classification bug is worth recording.** `nararouter:agnes-3-flash` answers 403
with `Your plan does not include the requested model`. The router first read that as
`quota_exhausted`, then — because the gateway's credential had already authenticated
elsewhere — as `rate_limited`, so it retried a model that can never answer, twelve times
in one battery run. `classifyFailure` now inspects the body of a 401/403 for a plan
restriction and classifies it `account_action`, which parks the model permanently instead
of treating a permanent denial as a transient one.

Per-call observability records gateway, model, prompt version, start, latency, HTTP
class, token usage where reported, fallback reason, rate-limit reason, quota state, parse
success, Zod success and whether a repair was attempted. It never records a key, an
Authorization header or any secret env value.

The Inspector (`/discover?inspect=1`) remains search-free: 0 DB, 0 SearXNG, 0 OSM, 0
scraper, 0 browser, 0 enrichment, 0 qualification, 0 persistence. It shows extractor,
provider, model, prompt version, latency, fallback and cache flags beside every field of
the frame and the raw→normalised trace ("tryna bring on" → hiring, "rn" → current, "round
brno" → Brno / near).

---

## 8. One blocking item before sign-off

**The three reviewed LLM runs were produced under prompt `u1-v6` and a validator that has
since gained three repairs. Shipping config is `u1-v7`.** The delta is evidenced but not
re-graded end to end:

- covered: the 14-case v6→v7 comparison battery (one regression found, fixed, re-run
  clean); unit tests for each of the three validator repairs; the 248-case deterministic
  regression re-run afterwards.
- not covered: the 12 / 24 / 16 sets themselves re-run on `u1-v7`.

Re-certification was attempted twice today and both attempts were stopped by the day's
model budget — the 12-case smoke got 11 cases through before every ladder entry was
parked, and a re-attempt at wider pacing stalled without writing a report. Tiny probes
still pass, so this is a per-day token budget, not an outage. Nothing was faked around
it: the grader refused to write a report rather than silently grade a deterministic
frame, which is the `--require-llm` contract working.

The run to make after the budget resets (00:00 UTC), exactly:

```
npm run verify:understanding -- --seed 47713 --smoke   --provider nararouter --model laguna-s-2.1 --require-llm
npm run verify:understanding -- --seed 90211 --set holdout --holdout 24 --chaos 0 --provider nararouter --model laguna-s-2.1 --require-llm
npm run verify:understanding -- --seed 41377 --set chaos   --chaos 16 --holdout 0 --provider nararouter --model laguna-s-2.1 --require-llm
```

Expected: SMOKE 12/12 and HOLDOUT 24/24 to reproduce, and CHAOS to move from 14/16 to
16/16 now that `yearFrom()` derives the year the two failures were missing.

---

## 9. Gate status

| requirement | state |
| --- | --- |
| deterministic engine healthy | **MET** — 247/248 on the adversarial seed, 248/248 on eleven others, 89/89 unit tests |
| 10-case LLM smoke manually passes | **MET** — 12/12, read by hand, `u1-v6` |
| fresh 24 HOLDOUT manually passes | **MET** — 24/24, read by hand, `u1-v6` |
| fresh 16 CHAOS manually passes | **MET with a caveat** — 14/16; both failures one validator gap, now fixed and unit-tested, not re-graded |
| no silently wrong semantic direction | **MET** — 0 across 52 LLM frames and 6/6 adversarial pairs on both ladder models |
| no silently discarded compound goal | **MET** — 0 compound loss |
| no critical requirement disappears | **MET** — 0 quantity loss, 0 constraint loss, 0 invented fields |
| production fallbacks individually certified | **MET** — `agnes-2.5-flash` certified on the battery; three candidates rejected with reasons |
| no LLM result produced by deterministic fallback | **MET** — `fallback_used = false` on all 52 frames |
| reviewed frames produced by shipping config | **NOT MET** — see §8 |

Nine of ten requirements are met on read frames rather than on automated totals. The
tenth is a re-run, not a repair.

**GATE 1 READY FOR FINAL MANUAL SIGN-OFF — pending the §8 re-certification run.**
