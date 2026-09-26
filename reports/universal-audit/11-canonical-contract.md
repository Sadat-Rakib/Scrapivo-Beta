# 11 — Canonical contract (LOCKED)

**Status:** LOCKED for implementation — amend only by explicit product decision  
**Date:** 2026-09-15 (amendment pass)  
**Scope:** `QualifiedLead` + `SearchSpec` field tiers + `ClaimEvidence` + lifecycle gates + typed outcomes + run identity  
**Mode:** Contract specification only — no product code in this document

This document is the **constitution**. SpecRow / UI Lead / persist schemas today are fragmented; implementation must converge on this contract rather than inventing a fifth partial shape.

---

## QualifiedLead theorem

> A candidate is **not** a lead because it was discovered.  
> A candidate becomes a **QualifiedLead** only when:
>
> 1. the **entity is identified**;
> 2. the **entity type is correct** (not inferred solely from query kind);
> 3. the entity **satisfies the SearchSpec**;
> 4. all **query-required** fields are present;
> 5. required claims have **claim-aligned** evidence;
> 6. evidence is **bound to that exact entity** (subject binding);
> 7. **temporal / location** constraints are satisfied when present on the Spec;
> 8. **required enrichment** for qualification has completed (not post-display);
> 9. **provenance** is retained;
> 10. the candidate passes the **qualification gate**.
>
> Only then may it be **delivered** or **counted**.

**Hard product law:** Prefer `0` correct qualified leads over `N` false or incomplete leads. Search success ≠ lead success.

---

## Absolute invariants

### Never

| Anti-pattern | Forbidden mapping |
|--------------|-------------------|
| URL → lead | A URL is a **source**, not a QualifiedLead |
| page → entity | A page is a **source**; entity must be extracted/resolved |
| query kind → entity kind | Do not inherit `Spec.entity` onto SERP titles |
| any evidence → qualifying evidence | Type alone is insufficient |
| funding → hiring/need | Distinct claims |
| job board → employer | Page-type must classify first |
| list/directory/article → company/startup | Grain must be entity, not page |
| organization → person | Institutes/groups are not people |
| search success → lead success | Provider hits ≠ qualified count |
| partial enrichment → qualified | Missing query-required fields fail closed |
| post-display enrichment → complete lead | Enrich before qualify/deliver |
| stale result → current claim | Temporal claims need event dates |
| old request → new conversation | Run identity reject |
| UI count → retrieval count | Count only `qualified` deliveries |

### Always

- Entity identity — **stable canonical `entity_id` on QualifiedLead** (provisional IDs only on intermediate candidates)
- Claim alignment **and** subject binding
- Query-aware completeness (not universal mandatory bags)
- Provenance / source object retained separately from lead
- Freshness when Spec is temporal
- Enrichment before qualification per `required_when_available` rules below
- Zero false-positive qualified gate
- Honest **typed** failure / empty state
- Stale-request rejection (`run_id` / generation)

---

## Source object ≠ lead object

```
Source (URL | page | SERP hit | post | directory row | DB row)
   ↓
Extracted candidate
   ↓
Page classified (page-type)
   ↓
Entity identified + resolved
   ↓
Query matched (SearchSpec)
   ↓
Claim verified (subject-bound)
   ↓
Enriched (query-aware)
   ↓
QualifiedLead
   ↓
Delivered (UI / persist)
```

A search result, website URL, Facebook group, Seedtable list, Monster board, or “Founder Institute” homepage is a **source** until entity resolution and claim verification succeed.

---

## Field tiers (query-aware completeness)

Every field on a candidate is tagged with exactly one semantic:

| Tier | Meaning | Fail-closed? |
|------|---------|--------------|
| `required_for_qualification` | Must be present and valid to become QualifiedLead | **Yes** — fail closed |
| `required_when_available` | Enrich when a path exists; see rule below | **Only when Spec makes the field necessary** |
| `optional` | Nice-to-have; never blocks qualify | No |

### `required_when_available` (explicit rule)

1. **Enrich** when a configured, in-scope path exists for this entity type (site contact harvest, structured job JSON, DB column, OSM attribute, etc.) within the run’s budget/timeout — do not invent.
2. **Missing value alone does not fail qualification.**
3. It becomes **qualification-blocking only when the SearchSpec explicitly makes that field necessary** for satisfying a requested constraint (i.e. the field is also effectively query-required).

Examples:

| Ask | Missing salary / phone / website | Result |
|-----|----------------------------------|--------|
| React jobs in Toronto | salary missing | **OK** (not query-required) |
| React jobs in Toronto paying $150k+ | salary missing | **Fail** (salary is query-required) |
| Restaurants in Toronto without websites | website missing | **Supports** the opportunity (`no_website`) |
| Businesses in Toronto with phone numbers | phone missing | **Fail** (phone is query-required) |
| Any otherwise-valid lead | public email absent after harvest | **OK** — leave null; do not reject solely for missing email |

---

## A. Identity-required fields (almost always `required_for_qualification`)

| Field | Notes |
|-------|-------|
| `entity_id` | **Stable canonical ID for QualifiedLead.** Provisional IDs may exist on intermediate candidates only. A provisional/unresolved `entity_id` **cannot qualify or be delivered.** |
| `entity_type` | person \| company \| business \| job \| investor — from **resolution**, not query inheritance |
| `name` | Display name of the **entity**, not page title of a list |
| `source` | Provenance channel (db \| osm \| live-web \| jobs \| social \| …) |
| `source_url` | Source object URL when applicable |
| `identity_confidence` | Explicit score/band; low confidence cannot quietly qualify as high |
| `provenance` | Enough to re-find the source (url, observed_at, extraction_method) |

---

## B. Query-required fields (from SearchSpec)

Derived from Spec criteria — examples, not exhaustive:

| Spec shape | Query-required (illustrative) |
|------------|-------------------------------|
| Founders in San Francisco | person; name; founder role; associated company; SF relevance; identity evidence |
| Restaurants in Toronto without websites | business; name; Toronto relevance; `no_website` evidence; business identity |
| Companies hiring senior React developers in Austin | employer; Austin relevance; React/developer role; seniority if requested; **active hiring** claim evidence; job info when the ask is hiring |
| Jobs paying $150k+ | salary present and satisfying threshold |
| React jobs in Toronto | title; employer; apply/source URL; Toronto/remote relevance; job existence evidence — **salary not required** |

Implementation must compute `queryRequiredFields(spec)` — not a single static bag per entity kind.

---

## C. Enrichment-required fields

| Pattern | Tier |
|---------|------|
| Contact email/phone when free harvest succeeds | `required_when_available` |
| Website when opportunity is not `no_website` | often query- or identity-related |
| Job salary / employment type / requirements / benefits | `required_when_available` unless Spec makes them query-required |
| Person current role validity | see People currentness |

Enrichment runs **before** qualification whenever a field needed for Spec satisfaction is still missing and an enrichment path exists. Enrichment is **not** a post-display enhancement for QualifiedLead delivery.

---

## Job minimum qualification (not universal mandatory)

### Minimum (`required_for_qualification` unless Spec says otherwise)

- job title  
- employer  
- job identity / source  
- apply or source URL  
- location/remote when available **or** when Spec requests location  
- evidence the job posting **exists** (subject-bound)  
- posting freshness when Spec is temporal  

### Enrichment target (`required_when_available` / `optional`)

salary, employment type, summary, responsibilities, requirements, seniority, posting date, benefits, department, experience, technologies, …

---

## ClaimEvidence model (subject-bound + claim-aligned)

`evidence.type === requested claim` is **necessary but not sufficient**.

Conceptual shape:

```
subject          # entity_id the claim is ABOUT
claim            # human-readable claim
claim_type       # hiring | service_request | no_website | funding | social_ask | identity | …
claim_parameters  # role, service, location, seniority, amount, …
evidence_source  # source object id/type
evidence_url
evidence_text    # excerpt that supports THIS subject+claim
observed_at
event_at         # when the claimed event occurred (if known)
freshness
confidence
```

### Claim subject binding (hard rule)

> Evidence cannot qualify an entity unless it establishes that the requested claim applies to **that exact entity**, not merely that the claim text appears somewhere on the source page.

Examples that must fail:

- List page “50 startups funded…” → does **not** fund the list host as a startup  
- Funding article about Institute programs → does **not** prove “needs developers”  
- Monster “Marketing Jobs” → does **not** prove a company needs marketing help  

---

## Temporal / freshness semantics

When SearchSpec has temporal constraints (`recent`, `currently`, `this quarter`, …):

| Field | Role |
|-------|------|
| `requested_time_window` | From Spec |
| `evidence_event_date` | When the **claim event** happened |
| `evidence_observed_at` | When we observed the source |
| `freshness_status` | fresh \| stale \| unknown |

**Temporal claim rule:** The **claim** must satisfy the time window — discovery timestamp alone is not enough. A 2022 article cannot satisfy a 2026 “recently funded” Spec without an in-window event date.

---

## People currentness

Person leads distinguish:

| Status | Meaning |
|--------|---------|
| `current_role` | Evidence supports present role |
| `former_role` | Historical |
| `historical_role` | Older / archival |
| `unknown` | Cannot establish currentness |

Carry `role_observed_at`, employment evidence, employment confidence when possible. Stale “Founder @ X (2021)” must not silently qualify as current founder without disclosure or Spec allowing historical.

---

## Social as first-class source model

Do not treat social as “just another SERP provider.” Social leads carry:

author identity, post URL, platform, post timestamp, post text, detected need, author→company relationship (if any), location evidence, identity confidence.

`social_ask` is a claim_type; the **source model** remains social-specific.

---

## Internal lifecycle (hard gates)

User-visible success remains: only **`qualified` → `delivered`**.

Internal pipeline (gates are real; some need not be UI states):

```
discovered
  → page_classified          # page-type / aggregator / job-board / list / org / person-page
  → entity_identified
  → entity_resolved          # HARD GATE — correct type + identity
  → query_matched            # SearchSpec satisfaction
  → claim_verified           # subject-bound + claim-aligned + temporal
  → enriched                 # query-aware; before qualify
  → qualified
  → delivered
```

### Correct SERP order

```
SERP/source
  → page-type classification
  → entity extraction
  → entity resolution
  → claim extraction
  → claim alignment + subject binding
```

**Forbidden:** assume query entity kind → extract claim → qualify → later notice it was a list page.

---

## Typed outcomes (never collapse to bare “0 results” internally)

| Code | Meaning |
|------|---------|
| `NO_QUALIFIED_RESULTS` | Search ran; nothing met QualifiedLead theorem |
| `SOURCE_UNAVAILABLE` | Route exists; provider down / timeout / 404 |
| `SOURCE_ERROR` | Route exists; unexpected error |
| `UNSUPPORTED_CAPABILITY` | No route for this Spec class |
| `SEARCH_CANCELLED` | User/system cancelled |
| `SEARCH_FAILED` | Pipeline failure before qualification |

UI may simplify copy; backend and traces must preserve the code.

### Final outcome precedence

When multiple routes run (e.g. SearXNG down, OSM works, OSM finds candidates, none qualify):

```
SEARCH_CANCELLED
  > SEARCH_FAILED
  > UNSUPPORTED_CAPABILITY
  > NO_QUALIFIED_RESULTS
```

Provider/source failures (`SOURCE_UNAVAILABLE` / `SOURCE_ERROR`) remain in **diagnostics** even when another route completes the search. They must **not** automatically become the overall result when a supported path finished sufficiently to establish that no candidate met the QualifiedLead theorem.

`NO_QUALIFIED_RESULTS` means the supported search completed enough to establish that no candidate met the theorem — not that every provider was healthy.

---

## Run identity (cancellation = two layers)

| Layer | Mechanism |
|-------|-----------|
| 1. Abort work | `AbortSignal` UI → server → providers → scraper |
| 2. Reject stale | Every response carries `search_run_id` (+ `conversation_id`, `turn_id`, `request_id`); if `response.run_id !== activeRunId` → **discard** |

Both required. Abort alone does not stop late fallbacks / remount races.

---

## Coverage denominator (stage metrics)

Do not claim “people discovery supported.” Measure stages, e.g.:

role extraction → role resolution → person source availability → identity resolution → company association → location resolution → claim evidence → enrichment → qualified delivery  

Each stage: **Supported / Attempted / Successfully covered / Unknown**.

---

## UI delivery (downstream of contract)

Tables are derived from `QualifiedLead + SearchSpec + entity_type` — never from lossy `specRowToLead`.

| People | Name \| Role \| Company \| Location \| Need \| Signal \| Contact \| Why match |
| Companies | Company \| Industry \| Location \| Need \| Signal \| Evidence \| Contact \| Why match |
| Jobs | Job \| Company \| Location \| Salary* \| Type* \| Seniority* \| Posted* \| Apply |
| Businesses | Business \| Category \| Location \| Opportunity \| Contact \| Website \| Evidence \| Why match |

\*Shown when present or query-required; absence does not invent values.

---

## Final acceptance criteria

> For any **supported** SearchSpec, can the system transform arbitrary natural-language input into a resolved specification, search the appropriate sources, identify **actual entities rather than pages**, verify query-specific claims against **entity-bound** evidence, perform **required** enrichment **before** qualification, preserve provenance/freshness, and deliver **only** QualifiedLead objects — while returning an honest **typed** empty/error/unsupported/cancelled state when it cannot establish those facts?

---

## Gap IDs introduced / elevated by this lock

| ID | Note |
|----|------|
| `GAP-FIELD-TIERS` | No required_for_qualification / required_when_available / optional |
| `GAP-SUBJECT-BINDING` | Evidence not bound to entity |
| `GAP-SOURCE-NE-LEAD` | Source conflated with lead |
| `GAP-ENTITY-RESOLVE-GATE` | identified/resolved not hard gates |
| `GAP-TEMPORAL-CLAIM` | observed_at ≠ event freshness |
| `GAP-TYPED-OUTCOME` | Bare zero collapses unavailable/unsupported/empty |
| `GAP-RUN-IDENTITY` | Abort without stale-result reject |
| `GAP-COVERAGE-DENOM` | No stage Supported/Attempted/Covered/Unknown |
| `GAP-ROLE-CURRENTNESS` | People current vs former vs unknown |
| `GAP-SOCIAL-MODEL` | Social not first-class beyond social_ask type |

---

## Implementation note

**LOCKED — implementation proceeds against this constitution.** First phases encode: QualifiedLead field tiers, SearchSpec→`queryRequiredFields`, ClaimEvidence subject binding, lifecycle gates + typed outcomes + run identity — see [11-implementation-roadmap.md](11-implementation-roadmap.md).

**Milestone 1:** No object reaches `qualified`, `delivered`, persisted-as-verified, or counted-as-a-result unless it satisfies this theorem. Prefer stricter (fewer) leads over false ones.
