# Gate 2C Agent Browser MVP

Date: 2026-09-20  
Backend: `vercel-labs/agent-browser` 0.38.1

## Decision

Agent Browser passed the narrow Windows spike and is the first browser backend. Scrapivo depends on the local CLI only through `AgentBrowser`; orchestration has no direct CLI coupling.

Environment:

- Windows x86_64
- Node 24.19.0
- Chrome 153.0.8010.52
- Agent Browser doctor: 9 pass, 0 warning, 0 failure

No Agent Browser chat/model command is used. All certified actions are deterministic and consume zero browser-reasoning calls.

## Contract

Implemented operations:

- createSession
- navigate
- search
- observe
- click
- type/fill
- select
- scroll / scroll-into-view
- condition-based wait
- structured extraction
- screenshot
- close

Every modifying action performs a fresh semantic observation before returning. Sessions track page, action, scroll, screenshot, and reasoning-call budgets.

## Snapshot

`PageSnapshot` contains:

- URL and title
- deterministic page type
- headings
- bounded semantic text
- interactive refs with roles, names, and state
- relevant links
- selected filters
- loading state
- login, CAPTCHA, modal, cookie, rate-limit, and access-block friction
- optional screenshot reference

Full HTML is not sent to a model.

## Browser loop

1. Observe.
2. Classify page state.
3. Choose one deterministic action.
4. Record expected state.
5. Act once.
6. Re-observe.
7. Verify or return an explicit mismatch.

Stale refs are not reused after navigation. Semantic refs remain the primary locator. Screenshot capture is reserved for meaningful states.

## Windows spike

Public test page: Selenium Web Form.

Passed:

- open/navigate
- semantic snapshot
- fill text input
- verify input value
- select option
- re-observe selected state
- scroll
- screenshot
- click submit
- verify URL transition
- close session

Screenshot: `reports/gate2/agent-browser-spike.png` (31,520 bytes).

Warm CLI operations completed in approximately 1.2–1.7 seconds. A successful visible open completed in approximately 5.5 seconds. Fresh headed sessions showed intermittent command-response delays near 30 seconds during the spike; the adapter now kills a single command at 30 seconds and the orchestrator can switch sources.

## Research behavior

The deterministic browser verifier:

- extracts only publicly displayed email or phone data
- detects current signal phrases and event dates
- separates event time from observation time
- detects operational status
- rejects temporary, permanent, and inactive businesses
- leaves UNKNOWN status unresolved
- detects CAPTCHA and access walls
- emits safe handoff/fallback events
- performs two exact-name variants before a current no-owned-website claim
- refuses a no-website claim when search results are blocked or contain no inspectable links

## Screenshots and events

Screenshots are files referenced by actual browser events. SSE transports the current domain, action, screenshot reference, and candidate count. No 60 FPS video stream was added.

## Tests

Automated coverage includes:

- full adapter method contract
- action followed by re-observation
- active hiring signal
- public-contact extraction
- temporary closure
- permanent closure
- CAPTCHA handoff
- no-website two-query protocol
- browser-reasoning calls equal zero

## Deferred mechanical work

- larger local fixture site covering nested scroll, infinite lists, new tabs, overlays, and dynamic loading
- workflow cache persistence and replay
- Camofox second adapter
- load/stress certification
- minimal internal screenshot/event viewer

These items do not change the chosen abstraction or core orchestrator.
