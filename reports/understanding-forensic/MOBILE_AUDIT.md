# Mobile Clarification UI Audit

## Scope

Read-only mobile clarification audit for the current forensic pass.

No product code was edited. No production search was run. No production data was touched.

## Runtime Reproduction

Attempted local mobile reproduction only.

Viewports attempted:

- 390 x 844
- 360 x 740

Local dev server:

- Started `npm run dev -- --host 127.0.0.1 --port 8080`.
- Target page was local `/discover`.
- Stopped after parent instruction because Discover reproduction requires authenticated access.

Artifacts:

- Screenshot: none produced.
- Runtime DOM metrics: none captured.

Verdict:

- No completed runtime reproduction.
- Mobile failure remains source-backed only in this pass.

## Auth Blocker

The focused Playwright reproduction path requires reaching authenticated Discover, submitting a query, and waiting for the clarification UI. The run was stopped before completing that flow.

## Relevant Files And Lines

- `src/components/app-shell.tsx:324` wraps the app in `h-[100dvh] md:h-screen flex overflow-hidden`.
- `src/components/app-shell.tsx:335` makes the main column `flex flex-col overflow-hidden relative`.
- `src/components/app-shell.tsx:414` renders route content inside `main` with `overflow-hidden relative`.
- `src/routes/_authenticated/discover.tsx:1891` makes the conversation/results area the only scroll container with `flex-1 min-h-0 overflow-y-auto px-4 md:px-6`.
- `src/routes/_authenticated/discover.tsx:2195` renders the composer area outside that scroll container with `px-4 md:px-6 pb-4 md:pb-6 pt-2`.
- `src/routes/_authenticated/discover.tsx:2288` renders the clarification dropdown directly above the composer as a normal card.
- `src/routes/_authenticated/discover.tsx:2309` mounts `ClarifyPanel` inside that composer-attached card.
- `src/components/discover/clarify-panel.tsx:59` renders the panel as `space-y-3 rounded-2xl border border-primary/25 bg-primary/5 p-4`.
- `src/components/discover/unified-composer.tsx:352` composer textarea can grow to `max-h-40`.
- `src/components/discover/unified-composer.tsx:379` composer controls use horizontal overflow via `data-tour="composer-controls"`.

## Source-Backed Likely Mechanism

The app shell fixes the full viewport and hides overflow. Inside Discover, the transcript/results area scrolls, but the composer and attached clarification card sit outside that scroll container.

On small mobile viewports, the clarification card can grow as normal content above the composer. The card has no mobile max height, no internal vertical scroll, no sticky action footer, and no explicit safe-area handling. The composer also has its own vertical growth allowance.

Likely user-visible effect:

- clarification consumes most of the available vertical space;
- composer can be pushed down or become hard to reach;
- conversation scroll area cannot naturally absorb the clarifier height because the clarifier is outside it;
- viewport-level overflow is clipped by the app shell.

## Not Verified In Runtime

- Exact overflow amount at 390 x 844.
- Exact overflow amount at 360 x 740.
- Whether composer fully disappears or remains partially reachable.
- Whether mobile Safari safe-area changes worsen the layout.

## Status

MOBILE CLARIFICATION UX: FAIL, source-backed; runtime reproduction blocked before completion.
