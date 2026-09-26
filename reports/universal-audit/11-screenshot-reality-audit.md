# 11 — Screenshot / UI Reality Audit

**Date:** 2026-09-15  
**Mode:** Audit-only — screenshots are **evidence**, not fixed.  
**Sources:** Cursor workspace assets under `…/assets/c__Users_mirsa_…_images_image-*.png` (2026-09-14 Discover captures); prior claim matrix in [10-phase1-verification.md](10-phase1-verification.md).

**Rule:** Every defect tracked → reproduced where possible → systemic gap → roadmap. Acknowledge-without-trace = audit failure.

---

## Defect register

| ID | Visible symptom (screenshot) | Reproduce | API vs UI | Root-cause gap | Roadmap phase |
|----|------------------------------|-----------|-----------|----------------|---------------|
| SCR-01 | Query `recently funded startups in Berlin` → **15** list/aggregator cards (ProjectStartups, VCBacked, Seedtable, Failory unicorn list, Facebook funding group) tagged `canonical-db` / Company | Prior runtime E (report 10): 15 funding rows; **this audit battery:** SearXNG returned 0 → empty (env variance) | When live works: API qualifies list pages; UI Cards/Lists show titles only | `GAP-LIST-PAGE-AS-ENTITY`, `GAP-FUNDING-IDENTITY`, `GAP-VERIFIED-SERP-SOFT`, `GAP-CLAIM-TYPE-GATE` | 3,4,9,10 |
| SCR-02 | Lists view = title + `canonical-db` link only — no evidence/contact/why columns | Code: Posts Lists drop snippet/why/contacts | API has evidence/why; UI strips | `GAP-UI-FIELD-DROP`, `GAP-UI-NO-TABLE-CONTRACT` | 11 |
| SCR-03 | Cards view = page title + SERP snippet; tagged Company but content is listicles | Same E path | Snippet ≠ entity lead | `GAP-LIST-PAGE-AS-ENTITY`, `GAP-WHY-SERP-NOT-CLAIM` | 4,5 |
| SCR-04 | `founders needing developers in San Francisco` → **1** card: **Founder Institute** (org) as Person/lead | Report 10 C: funding evidence on developer need; kind inherited from query `person` | API disposition qualified; UI shows incomplete card | `GAP-INSTITUTE-AS-PERSON`, `GAP-ENTITY-INHERIT-KIND`, `GAP-FUNDING-SNIPPET-OR`, `GAP-CLAIM-TYPE-GATE` | 3,4,5 |
| SCR-05 | History: `people looking for copywriters` **0 results**; `Toronto restaurants needing` **0** | This battery: B returned 0 (SearXNG empty + gate); A returned 3 OSM (UI history showed 0 on 09-14 — **divergence**) | UI 0 can mean: true empty, gate drop, or failed map | `GAP-UI-API-DIVERGENCE`, `GAP-LIVE-PROVIDER-FLAKE` | 7,11,12 |
| SCR-06 | Status text **“Understanding: people…”** with spinner during search / after New chat | `thinking-steps.tsx` last pulse line while `specPending`; no hang detector | Narration ≠ pipeline stage; can persist until in-flight finally | `GAP-UI-UNDERSTANDING-STALL`, `GAP-CANCEL-NO-ABORT` | 12 |
| SCR-07 | New chat / Clear does not stop server search; results can repaint into “empty” chat | Code: no AbortController on `runSpecSearch`; toast turn-id gated but `setLeads` not | Client soft-reset only | `GAP-CANCEL-NO-ABORT`, `GAP-CANCEL-REPAINT` | 12 |
| SCR-08 | Spec people/companies rendered as **Post** cards (`canonical-*` blobs); Company/Person tables empty on Spec path | `discover.tsx` routes non-business → `leads`; companies/people arrays empty | Structural UI routing | `GAP-UI-SPEC-ROUTING` | 11 |
| SCR-09 | Job cards: HTML entities in titles (`&#x28;Senior&#x29;`); Why match = generic **“Open role”**; enrich deferred to buttons | Job SpecRow maps thin fields; detail panel uses legacy intent chrome | Upstream JobPosting richer; Spec drops description/salary/reqs | `GAP-JOB-CONTRACT`, `GAP-UI-MOJIBAKE`, `GAP-ENRICH-POST-DISPLAY` | 5,8,11 |
| SCR-10 | Missing evidence / relevance / contact fields on qualified-looking cards | `specRowToLead` drop list | Contract fields never delivered | `GAP-UI-FIELD-DROP` | 11 |
| SCR-11 | “canonical-db” label on live SERP-derived rows | platform hardcoded `canonical-db` in mapper | Mislabel provenance | `GAP-UI-PROVENANCE-LIE` | 11 |
| SCR-12 | Incomplete lead presented as success count (“15 results”, “1 result”) | Count = mapped Lead length, not complete+claim-aligned | Product failure under E2E law | `GAP-QUAL-INCOMPLETE-SHOWN` | 1,11 |

---

## Reproduction notes (this audit)

| Case | 2026-09-14 UI | Report 10 API | 2026-09-15 battery |
|------|---------------|---------------|--------------------|
| E Berlin funding | 15 aggregators | 15 funding qualified + persist | **0** (SearXNG empty) |
| C Founders/devs SF | 1 Founder Institute | 1 funding FP | **0** (SearXNG empty) |
| A Toronto restaurants | History showed 0 | 3 OSM no_website | **3** OSM |
| B copywriters | 0 | 1 Facebook group | **0** |

**Interpretation:** Screenshots document the **false-positive regime** when live-web returns hits. This battery documents the **honest-empty regime** when live-web fails. Both violate ultimate E2E acceptance: users do not consistently receive complete, claim-aligned, enriched leads.

---

## Do not fix screenshots

No UI patches in this audit. Defects carry into [11-gap-register.md](11-gap-register.md) and [11-implementation-roadmap.md](11-implementation-roadmap.md).
