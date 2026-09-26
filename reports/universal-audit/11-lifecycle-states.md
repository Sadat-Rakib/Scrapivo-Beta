# 11 — Lifecycle / state map

**Date:** 2026-09-15 (amended)  
**Mode:** Audit-only  
**Locked target:** [11-canonical-contract.md](11-canonical-contract.md)

---

## Target internal lifecycle (hard gates)

```
discovered
  → page_classified
  → entity_identified
  → entity_resolved          # HARD — correct type + identity; not query-kind inheritance
  → query_matched
  → claim_verified           # subject-bound + claim-aligned + temporal
  → enriched                 # before qualify; query-aware
  → qualified
  → delivered
```

Only **`qualified` → `delivered`** populate Discover results / counts. Intermediate states may log/trace; they must not inflate “N results.”

**Enrichment is not post-display.** For QualifiedLead delivery, enrichment of fields needed for Spec satisfaction runs before qualification.

### Correct order for live/SERP

```
source → page-type → entity extract → entity resolve → claim extract → claim align/bind
```

Not: inherit query kind → claim → qualify → notice list page.

---

## Typed outcomes (backend)

| Code | Meaning |
|------|---------|
| `NO_QUALIFIED_RESULTS` | Ran; none met theorem |
| `SOURCE_UNAVAILABLE` | Route exists; provider down/timeout/404 |
| `SOURCE_ERROR` | Route error |
| `UNSUPPORTED_CAPABILITY` | No route for Spec class |
| `SEARCH_CANCELLED` | Cancelled |
| `SEARCH_FAILED` | Pipeline failed |

Do not collapse these to a single UI “0 results” in traces/API meta.

### Final outcome precedence

```
SEARCH_CANCELLED > SEARCH_FAILED > UNSUPPORTED_CAPABILITY > NO_QUALIFIED_RESULTS
```

`SOURCE_UNAVAILABLE` / `SOURCE_ERROR` stay in diagnostics; they do not override `NO_QUALIFIED_RESULTS` when another supported route completed the search enough to apply the theorem.

---

## Run identity

Cancellation = (1) AbortSignal abort work + (2) discard responses whose `search_run_id` ≠ active run. See contract § Run identity.

---

## Actual SpecRow / persist vocabulary (today)

| Code status | Maps to target? |
|-------------|-----------------|
| `verification_status: discovered` | ≈ discovered only |
| `verification_status: verified` | ≠ claim_verified (claim-blind SERP soft bar) |
| `disposition: qualified` | too weak vs theorem |
| `complete` | ≠ enriched / identity-complete |

**Missing gates today:** `page_classified`, `entity_resolved`, subject-bound `claim_verified`, typed outcomes, run identity.

---

## Search success ≠ lead success

| Observation | Implication |
|-------------|-------------|
| SearXNG hits → aggregators/institute (UI + report 10) | Search success → false leads |
| SearXNG empty (2026-09-15 battery) | Should be `SOURCE_UNAVAILABLE` or empty after search — not silently same as unsupported |
| Directory without evidence under signal_required | Correct non-qualify |

**Rule:** UI counts = count(`delivered` QualifiedLeads) only.
