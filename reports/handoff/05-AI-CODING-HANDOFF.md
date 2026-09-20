# AI coding handoff

## Paste this first

Read `reports/handoff/00-SCRAPIVO-SYSTEM-MAP.md`, `01-FILE-RESPONSIBILITY-MAP.md`, `02-WHERE-TO-CHANGE-THINGS.md`, `03-TESTING-GUIDE.md`, and `04-CURRENT-STATUS.md` before editing. Trace the owning module. Make smallest safe change. Run targeted tests. Preserve evidence, qualification, and zero-AI stored retrieval boundaries. Never add CAPTCHA bypass, paid SERP, fake lead data, or guessed contact data. Do not modify Gate 1 for browser/UI bugs or retrieval for visual changes. Preserve dirty worktree changes not owned by your task.

Start with P0: connect Discover to authenticated ResearchSession/SSE lifecycle or explicitly retain legacy flow behind a tested feature flag. Then test normal user query, cancel, Need More, and browser event display. Do not begin provider expansion first.

