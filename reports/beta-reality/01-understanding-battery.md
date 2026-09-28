# Beta Reality — 01 Understanding Battery (real UI, real composer, desktop 1366×768)

All 22 prompts from PRD §7 typed into the real /discover composer as a fresh beta user.
Clarification UI itself works well (question cards, options, "Search with defaults", answer
mapping chains correctly: "founders" → SaaS → Selling → auto-launch = 2 questions then ready).

| # | prompt | actual | expected | verdict |
|---|---|---|---|---|
| P1 | founders | clarify type → purpose → launch | clarify | PASS |
| P2 | find me founders | clarify type | clarify | PASS |
| P3 | find SaaS founders | clarify purpose only | optional geo, no over-question | PASS |
| P4 | Find 20 SaaS founders in Canada. | ready, launched | ready | PASS |
| P5 | companies | clarify industry (2q) | clarify | PASS |
| P6 | D2C brands in India | ready, launched | ready | PASS |
| P7 | local dentists | asks location | ask location | PASS |
| P8 | find plumbers in Austin | ready, launched | ready | PASS |
| P9 | jobs | **launched, no clarification** | clarify | **FAIL F1** |
| P10 | remote frontend jobs | launched (job+remote parsed) | understood | PASS (parse unverified) |
| P11 | Find remote React developer jobs in Canada | launched | ready | PASS |
| P12 | investors | **launched, no clarification** | stage/focus clarify | **FAIL F2** |
| P13 | pre-seed AI investors in North America | launched | ready | PASS |
| P14 | accelerators | **launched, no clarification** | clarify | **FAIL F3** |
| P15 | accelerators for an early-stage Canadian AI startup | asks purpose (1q) then ready | ready | MINOR (borderline over-question) |
| P16 | need buyers | **asks location first** | clarify target/product/purpose | **FAIL F5** |
| P17 | decision makers at AI startups | launched (entity routing unverified) | people/executive search | PASS* |
| P18 | people who run SaaS companies | launched (entity routing unverified) | founder/CEO people search | PASS* |
| P19 | businesses that might need websites | asks location; website research intended | fit+website research, no auto-intent | PASS |
| P20 | companies with bad onboarding | asks location; custom signal not engaged | custom-signal/clarify | MINOR |
| P21 | asdfgh | friendly entity-type clarification | friendly clarify | PASS |
| P22 | weather in Paris | **launched a search** | off-topic response, NO search | **FAIL F4** |

## Failure pattern (one subsystem)
F1/F2/F3: bare/underspecified **jobs, investors, accelerators** bypass the readiness/clarification
gate and auto-launch. people/companies/businesses clarify correctly. Same subsystem as the ~30
legacy red unit tests (mode-gate, jobs-spec-questions, thin-ask, entity-taxonomy, offer-taxonomy,
understanding) → those are CLASSIFIED A (real product bugs), not stale expectations.
F4: no off-topic gate (weather in Paris runs a live search).
F5: "need buyers" gets a location question instead of offer/target clarification (mode-gate).
