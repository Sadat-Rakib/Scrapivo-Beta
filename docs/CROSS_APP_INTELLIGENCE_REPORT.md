# Cross-App Intelligence — Final Report

## Architecture

Scrapivo remains the source of truth. We extracted playbook orchestration, domain-pattern learning, and evidence-backed personalization ideas from [AI Outreach Engine](https://github.com/rohitmalhotra1420/ai-outreach-engine), plus profile normalization / bio-link enrichment patterns from [Scout](https://github.com/kiryano/Scout)—without cloning either repo.

```
User NL → classify + clarify → SearchPlan (playbook)
        → specialized path (Investors seed / Local places / Jobs ATS / Discover fan-out)
        → Shared intelligence (profiles, contacts, domain memory, evidence, personalize)
        → CASL-gated outreach (unchanged approval model)
```

### New modules

| Module              | Path                                                            |
| ------------------- | --------------------------------------------------------------- |
| Playbook planner    | `src/lib/search/playbook-planner.ts`                            |
| Domain memory       | `src/lib/contact/domain-memory.server.ts`                       |
| Profile discovery   | `src/lib/profile/*`                                             |
| Evidence            | `src/lib/intelligence/evidence.ts`                              |
| Personalization     | `src/lib/intelligence/personalize.server.ts`                    |
| Entity resolve      | `src/lib/intelligence/entity-resolve.server.ts`                 |
| Provider rate limit | `src/lib/intelligence/provider-rate-limit.server.ts`            |
| Migration           | `supabase/migrations/20260813020000_cross_app_intelligence.sql` |

## Capability matrix (what was taken)

| Capability                            | Source                        | Integrated into                                               |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| Explicit playbooks                    | Outreach Engine               | Discover `buildSearchPlan` + `runSearch.plan`                 |
| Domain pattern learning + top-2 probe | Outreach Engine               | `domain-memory` + `deriveEmailCandidates` + discover-contacts |
| Catch-all domain state                | Outreach Engine               | `domain_verify_state` (memory + migration)                    |
| Dual job title lists (contactRoles)   | Outreach Engine               | Jobs filters / optional employer enrich                       |
| Audience/ICP via project context      | Outreach Engine               | Planner `offer` / `industry` from project                     |
| Profile registry + normalize          | Scout                         | `UniversalProfile` + `discoverProfiles`                       |
| Bio-link / Linktree harvest           | Scout                         | Profile extract + Local enrich harvest                        |
| Email source ranking                  | Scout + Outreach              | Shared contact `_rank` / originScore                          |
| Evidence claims                       | Outreach evidence_url concept | Local + Investors evidence arrays                             |
| Unified personalization               | Outreach templates            | `personalizeOutreach` + `personalizeFromEvidence`             |
| Entity resolution                     | Gap fill                      | `canonicalEntityId` / `dedupeByEntity`                        |
| Shared provider rate limits           | Gap fill                      | Jobs ATS + shared bucket helper                               |

**Explicitly not taken:** LinkedIn cookie scrapers, Python Scout CLI, Firecrawl/Reoon/Brevo as required stack, replacing investor seed with Serper VC scrape, autosend, Lighthouse worker.

## Discover improvements

- Formal `SearchPlan` with playbook, sources waterfall, enrichment flags
- Investor early-exit keyed off `planUsesInvestorSeed`
- Response includes `plan` for UI/debug
- CUSTOM playbooks can optionally refine via LLM (`refineSearchPlanWithLlm`)

## Investor improvements

- Evidence claims from investment locations
- Optional `enrichContacts` → shared CI + profile discovery on firm websites
- Seed corpus unchanged (still primary)

## Jobs improvements

- `contactRoles[]` on filters (roles wanted vs people to contact)
- Optional `enrichEmployers` for domain contact slot
- Shared ATS rate-limit slots
- Live ATS search remains primary

## Local Business improvements

- Evidence claims on rows (no website, weak HTTPS, contacts)
- Entity ids + stronger dedupe
- Profile discovery + bio-link harvest when enriching websites

## Shared intelligence

- One contact path with learned domain patterns
- Profiles reusable across playbooks
- Personalization consumes evidence only
- Provider rate limiter shared

## Tests

| Script                          | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `verify-playbook-planner.mts`   | 5 NL → playbook                           |
| `verify-domain-memory.mts`      | learn → prefer pattern                    |
| `verify-profile-discovery.mts`  | profiles + evidence + entity + rate limit |
| Existing geo/jobs/contact/smoke | Regression                                |

## Remaining gaps

- Persist evidence/profiles to Supabase from live requests (tables ready; wiring optional)
- Broader Serper/SearXNG consume via shared limiter in every source module
- Jobs employer domain resolution (slug → real domain)
- Planner LLM assist only for CUSTOM today
- Lighthouse still deferred

## Success criterion

Universal Search selects a playbook, runs relevant paths, enriches via shared contact/profile/domain memory, attaches evidence, and can personalize—without regressing Investors/Local/Jobs cores.
