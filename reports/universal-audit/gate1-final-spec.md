# Gate 1 final specification

This is the canonical continuation contract for Gate 1. Future sessions should read this
file, inspect the current repository and reports, preserve completed work, and continue
only from the first unfinished checkpoint. Do not redesign Gate 1 from scratch.

## Mission and theorem

Gate 1 is multi-provider LLM understanding, semantic cleanup, and manual verification.
Given a new, unseen prospecting request, Scrapivo must either produce an
`UnderstandingFrame` that accurately represents the user's meaning or explicitly identify
genuine ambiguity. It must never silently guess, reverse direction, lose constraints,
invent intent, or discard part of the request.

Semantic quality matters more than provider count. Do not start Gate 2 and do not touch
retrieval.

## Scope

Allowed:

- `src/lib/understanding/**`
- `src/lib/ai/router.server.ts` and the shared provider registry
- understanding tests and grader
- Understanding Inspector
- provider-probe scripts
- Gate 1 reports
- `.env.example` variable names only

Forbidden:

- retrieval or SearchSpec integration
- DB search, SearXNG, OSM, scrapers, browser automation
- enrichment, qualification, persistence, result UI, or Gate 2
- a frame-to-legacy-SearchSpec adapter

Preserve existing working Gate 1 code. Make minimal scoped changes. Freeze the
deterministic extractor except for a confirmed semantic error, invariant violation, or the
two required cleanups below. Do not tune against individual holdout prompts.

## Secret handling

Provider keys live in `.env`; discover variable names without printing values. Never log,
report, test, commit, or expose keys or authorization headers. `.env` must remain ignored.
`.env.example` may contain names and empty values only.

Safe provider diagnostics are limited to configured true/false, provider, model, base
host, HTTP status/class, latency, and quota/rate-limit classification.

## Provider architecture

Use one provider registry/adapter feeding the existing `aiComplete(...)` contract. The
understanding engine must not know which gateway answered. A registry entry records its
id, protocol (`openai_chat` or `anthropic_messages`), key env name, base URL, model,
capabilities, and health state.

Supported candidate gateways are NaraRouter, APInex, KiosAPI, TokenForge, Groq, and
OpenRouter. Use account-configured endpoints. In particular, do not copy an unrelated
Kios URL or guess TokenForge's surface. TokenForge should use the compatible surface with
the least translation, and the certified protocol must be recorded.

A tiny provider probe (not the full understanding prompt) must report authentication,
endpoint/model reachability, structured JSON, latency, usage support, throttling/quota,
and whether the exact provider/model is certified for understanding. HTTP 200 alone is
not certification.

Certification belongs to an explicit provider/model pair. It must demonstrate instruction
following, reliable JSON/schema adherence, correct semantic direction, open vocabulary,
no invented fields, low unnecessary clarification, and acceptable latency. Never select a
random free model or auto-router for grading.

Production order must be data/configuration driven. Grading pins provider and model.
Production uses sequential failover and must never fan one request out to every provider.

Fail over on timeout, connection failure, 429, quota/cooldown, 5xx, unavailable model,
empty output, or unparseable output after one repair attempt. Do not repeatedly retry 401,
403 account restriction, permanently unsupported model, or an invalid base URL; mark that
provider unavailable/misconfigured for the run. Honor `Retry-After` and distinguish daily
quota exhaustion from minute throttling.

Production may eventually fall back to deterministic understanding. LLM certification
may not: `--require-llm` means any non-LLM answer invalidates the run. Every frame must
record extractor, provider, model, prompt version, latency, fallback use, and cache use.
For certification, `fallback_used` must be false.

The grader supports provider/model pinning, seed, smoke, holdout, chaos, require-LLM, and
no-cache controls. Provider observability records safe call metadata, token usage when
available, failure/rate-limit classification, parse and Zod success, and repair attempt.

## Semantic invariants

Generic head nouns must not restate the entity type in `target.category`. Businesses,
companies, people, persons, investors, jobs, and organizations produce a null category
unless actually narrowed. Preserve their wording in raw/provenance, relation subject,
input, and trace. Real categories such as marketing agency, restaurant, dentist, coffee
roaster, law firm, SaaS, HVAC contractor, and veterinary clinic remain.

Investment semantics are structural:

- `investors in Berlin` -> `fit_based`
- `investors funding climate startups` -> `investment_based`
- `startups seeking investors` -> `funding_based`
- `startups that raised Series A recently` -> `event_based`

This must not be an aquaculture-specific patch.

Parse model output as JSON, then Zod, then deterministic validation, then an
`UnderstandingFrame`. Syntactically valid JSON is not semantically valid. Permit one
malformed-output repair, never a loop. Confidence is diagnostic, not truth. Preserve raw,
value, normalized, and confidence provenance where relevant.

The Inspector at `/discover?inspect=1` stays understanding-only: zero DB, search engines,
maps, scrapers, browser, enrichment, qualification, or persistence. It displays all frame
fields, provenance, model metadata, fallback/cache state, and raw-to-normalized trace.

Understand tiny, medium, and long inputs without turning Gate 1 into a sales questionnaire.
Clarify only blocking ambiguity.

## Validation sequence and hard stops

Always inspect current state first and skip completed steps. The authoritative order is:

1. inspect `.env`/provider setup without printing secrets
2. build/reuse provider registry and adapters
3. probe NaraRouter, APInex, KiosAPI, and TokenForge
4. certify candidate models
5. generic-category cleanup
6. investment-mode cleanup
7. existing focused tests and typecheck
8. 4-6 varied provider canaries
9. choose an explicit primary model on semantic quality first
10. run a fresh unseen 10-case LLM smoke
11. **STOP and present all ten full frames for manual review**
12. only after explicit approval, run 24 fresh HOLDOUT and stop for manual review
13. only after explicit approval, run 16 fresh CHAOS and stop for manual review
14. certify production fallback models with adversarial direction pairs
15. optimize the prompt only after a quality baseline
16. compare compressed and baseline prompts with the same provider/model/seed
17. finish the separate LLM validation report
18. stop for final sign-off; never proceed to Gate 2 automatically

The smoke must cover: pure fit-based entity discovery; needs-service versus
offers-service; hiring; seeking-job; opportunity/lacks-asset; quantity plus required and
preferred fields; temporal; negation/constraint; compound; and messy/long/slang. Use
obscure/random places, roles, industries, services, business types, and technologies. Print
the complete frames.

Manually grade every frame on task, mode, target, role/category/industry, subject,
relation, object, direction, location, temporal, quantity, constraints, user context,
required/preferred fields, verification, output, compound goals, clarification, invented
information, and missing information. The question is whether the frame faithfully
describes what the human meant; automated expectations are secondary.

If smoke reveals a systemic issue, stop and classify it as schema, prompt, normalizer,
model capability, provider compatibility, or grader. Fix only the systemic cause, choose a
new seed, and repeat the smoke. Do not spend larger-run quota first.

Fallback certification must include dangerous opposite-direction pairs such as `web
designers looking for clients` versus `businesses looking for web designers`. A model that
fails remains outside the production ladder even if it is free.

## Prompt optimization

Establish a baseline with the existing prompt before compressing it. Reduce duplicate
examples/prose while retaining load-bearing semantic and dangerous-direction rules.
The aspirational 1,000-1,500-token range never overrides quality.

Compare prompt versions with the same provider, explicit model, and seed. Accept
compression only with no semantic or direction regression, constraint loss, increased
clarification, or hallucinated fields. Report token and latency changes.

## Final report and closure

Do not overwrite the deterministic report. The separate LLM report must include provider
certification, tested/selected/rejected models and reasons, full frames and manual grades
for 10 smoke / 24 holdout / 16 chaos, semantic failure tallies, latency percentiles, token
usage, provider/fallback events, and prompt comparison if compression occurred.

Gate 1 is built, tested, and manually verified only when:

- the deterministic engine remains healthy
- fresh real-LLM smoke, holdout, and chaos sets pass manual review
- there is no silently wrong direction or discarded compound goal
- no critical user requirement disappears
- every production fallback model is independently certified
- no LLM grade was produced by deterministic fallback

Only then output `GATE 1 READY FOR FINAL MANUAL SIGN-OFF` and stop. Do not start Gate 2,
retrieval, live search, database work, browser work, enrichment, qualification, or result
UI redesign without explicit approval.

## Current repository checkpoint (2026-09-17)

The repository already contains the provider registry/router, safe probes, grader controls,
semantic cleanups, Inspector, adversarial model certification, and prompt comparison.
`nararouter:laguna-s-2.1` is the documented primary and
`nararouter:agnes-2.5-flash` the documented certified fallback. Other configured gateways
are excluded or unmeasured for recorded transport, account, quota, latency, or semantic
reasons; do not force them into the ladder.

The separate report `21-gate1-llm-validation.md` records that reviewed runs used an older
prompt/validator combination. The next unfinished checkpoint is a fresh, pinned,
uncached, require-LLM 10-case smoke against the current shipping configuration, followed
by the mandatory manual-review stop. Do not infer approval for HOLDOUT or CHAOS from this
file.
