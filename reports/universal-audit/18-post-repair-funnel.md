# Post-repair coverage funnel

**Date:** 2026-09-16T00:13:18.633Z
**SearXNG reachable:** true
**QL store:** supabase
**Looking-in-location bugs:** none

## Aggregate funnel (sum across cases)

| Stage | Count |
|-------|------:|
| planned | 110 |
| attempted | 18 |
| artifacts | 27 |
| classified | 27 |
| entities_resolved | 27 |
| query_matched | 27 |
| claims_extracted | 27 |
| subject_bound | 27 |
| temporally_valid | 27 |
| qualified | 27 |
| persisted | 27 |
| delivered | 27 |

## Per-case funnel

| ID | Bucket | Art | Class | Ent | Claim | Bound | Temporal | Qual | Persist | Loc |
|----|--------|----:|------:|----:|------:|------:|---------:|-----:|--------:|-----|
| A | QUALIFIED_OK | 25 | 25 | 25 | 25 | 25 | 25 | 25 | 25 | Toronto |
| B | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| C | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | San Francisco |
| D | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Austin |
| E | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Berlin |
| F | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| G | QUALIFIED_OK | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | New York |
| ADV2 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Montreal |
| ADV3 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Toronto |
| ADV5 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Austin |
| ADV7 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | San Francisco Bay Area |
| ADV8 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Germany |
| ADV9 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | New York |
| ADV10 | HONEST_ZERO | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Greater London |

## First-drop bottleneck (zeros / coverage gaps)

| ID | Bucket | First drop | Snapshot |
|----|--------|------------|----------|
| B | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| C | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| D | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| E | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| F | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV2 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV3 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV5 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV7 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV8 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV9 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |
| ADV10 | HONEST_ZERO | **artifacts** | art=0 ent=0 claim=0 bound=0 qual=0 |

## Cases with zero artifacts

B, C, D, E, F, ADV2, ADV3, ADV5, ADV7, ADV8, ADV9, ADV10

## Interpretation guide (do not code yet)

- **artifacts = 0** → source/transport coverage (platform surface / archive / API / feed)
- **artifacts > 0, entities_resolved = 0** → identity / author resolution
- **resolved > 0, claims_extracted = 0** → signal / need extraction
- **claims > 0, subject_bound = 0** → binding
- **bound > 0, qualified = 0** → theorem / verification (honest refuse)
- **qualified > 0, persisted = 0** → persistence adapter / gate

Next coding work must follow the dominant first-drop column above — not generic scraper accumulation.
