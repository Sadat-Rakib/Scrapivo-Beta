# WRITE_CLEANUP — production-backed QA writes inventory

Rule: every controlled write to the demo account's production backend gets a row here. Zero unexplained QA artifacts allowed at end.

| Test | Table/feature | Identifier | Created | Verified | Cleaned | Cleanup evidence |
|---|---|---|---|---|---|---|
| Profile field edit (qa-profile-edit.mts, Kiro) | profile "Job title / craft" | demo account profile field | yes | edited, "Settings saved" toast, NOT persisted across reload (defect E2E-C1) | YES — previous value restored, `restored: true` verified | evidence/profile-edit.json |
| Profile field edit (qa-profile-edit.mts, continuation) | profile "Job title / craft" | tag E2E_QA_1790866703196 | yes | NOT persisted across reload again (E2E-C1 REPRODUCED); toast claimed "Settings saved" | YES — original value restored, `restored: true` | logs/profile-edit-resume.txt, evidence/profile-edit.json |
| Saved lead (P04 save-lead click, Kiro) | saved_leads | 1 row (P04 first lead) | yes | CONTINUATION: listed on /saved ✓; notes edit persisted across reload ✓ | YES — deleted via product UI, gone after reload | logs/persist-resume.txt ("QA saved lead deleted (gone after reload)"), evidence/persistence.json |
| Projects / ICPs | projects | none created (Kiro + continuation) — New-project dialog opened but NOT submitted; no delete path exists in product | no | n/a | n/a | evidence/persistence.json, logs/persist-resume.txt |
| Watch Signal | campaign/watch | none created — /watches page exposes NO delete/disable control (probe: hasDeleteControl=false), so a QA watch would be an un-cleanable production artifact. Deliberately skipped; product gap documented (E2E-C16) | no | read-only probe only | n/a | evidence/watch-auth-probe.json, ui/watches-probe.jpg |
| Search runs (all 37 suite cases + probes) | search history rows (no-persist mode active for search-generated data) | demo account chat history | yes (history entries visible in UI) | n/a | NOT deletable via product UI (no clear-history control found); SCRAPIVO_LOCAL_NO_PERSIST=true was active, so search-generated persistence (history/quota/caches/canonical write-backs) was suppressed at the server level for the local run; remaining UI history entries are demo-account-local rows created by searches, contain no QA data beyond query strings | logs/dev.log (no-persist env), X03.json bodyAfter (history list) |

| Profile field edit (qa-profile-edit.mts, final stabilization) | profile "Job title / craft" | tag E2E_QA_1790890875672 | yes | EDIT PERSISTED across reload (E2E-C1 FIXED); restore also saved | YES — `restored: true` verified | logs/qa-profile-edit-final.txt, evidence/profile-edit.json |
| Saved lead (P04 save click, final matrix) | saved_leads | Alex Circei row (first delivered lead) | yes | listed on /saved ✓; notes edit persisted across reload ✓ | YES — deleted via product UI, 0 saved left | evidence/persistence.json (qa-persist 7/7) |
| Watch (qa-watch-auth-probe.mts lifecycle, final) | campaign/watch | "QA E2E watch probe — UX designers in Toronto" | yes | created ("Signal watch saved"), Pause toggled ("Watch paused — scheduled runs skip it"), delete control present | YES — deleted ("Watch removed"), gone after reload; zero residue | evidence/watch-auth-probe.json (watchLifecycle), logs/qa-watch-auth-probe-final2.txt |
| Watch (stray artifact from agent probe development) | campaign/watch | "Plumbers in Edmonton with public contact details" | yes (agent-created, not part of plan) | discovered in /watches dialog during qa-persist | YES — deleted via product UI trash, gone after reload | qa-persist evidence/watchesText + one-off cleanup run (rowVisible→goneAfterReload) |
| Projects / ICPs (final) | projects | none created — New-project dialog opened but NOT submitted | no | n/a | n/a | evidence/persistence.json |

## Outstanding cleanup obligations
NONE. Every intentional production-backed write (profile fields ×3, saved lead, QA watch ×1) was restored or deleted with UI-verified evidence, and the one stray agent-created watch was found and deleted. Projects/ICPs were deliberately not created (dialog opened and cancelled).
