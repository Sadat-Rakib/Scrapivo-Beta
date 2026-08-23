# M0 — Baseline & Hygiene Report

Date: 2026-08-22 · Milestone: M0 of Scrapivo Unified Pages plan

## Baseline results (recorded before any changes)

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS — 0 errors |
| `vitest --run` | 135/135 tests passed in 10 files, BUT 131 foreign suites from `freehire/` failed to load (missing `@testing-library/svelte`, missing `.wxt/` & `.svelte-kit/` generated tsconfigs). Root runner was crawling the embedded freehire project. |
| `eslint .` (full repo) | TIMED OUT (>10 min) — crawled `freehire/` and `.vercel/output` build artifacts |
| `eslint src` | 3922 problems (3912 errors / 10 warnings; prettier formatting + `no-explicit-any` dominant, ~3740 auto-fixable) — cleanup deferred to M5 |
| `npm run build` | PASS — built in ~54 s |

## Security remediation (leaked RSA private key)

`ssh-key-2026-08-09.key` → actually `ssh-key-2026-08-08.key` was a real RSA private key,
tracked since commit `ece83a1 "Add all"` and pushed to
`github.com/Sadat-Rakib/Scrapivo-Beta`.

Actions taken:

1. Key moved out of the repo **and** out of OneDrive sync → `C:\Users\mirsa\.ssh\scrapivo-github-2026-08-08.key` (SHA-256 hash verified identical).
2. Removed from index (`git rm --cached`) BEFORE the restore-point commit, so no new commit ever contained it.
3. `.gitignore`: added `*.key`, `*.pem`, `*.p12`; removed trailing duplicate `.env*` rule that had been silently re-ignoring `.env.example`.
4. History scrubbed with `git filter-repo --invert-paths --path ssh-key-2026-08-08.key` — 26 commits rewritten.
5. Rewritten `main` force-pushed to origin (`65bbc72...9051e7b`).
6. Local eradication: reflogs expired, `git gc --prune=now --aggressive`; old pack removed (single 7.1 MB pack remains).

### ⚠️ REQUIRED USER ACTION (cannot be automated here)

The key sat public on GitHub and must be treated as compromised:

- **Revoke it** at whatever it authorizes (GitHub Deploy Key page, server `~/.ssh/authorized_keys`, etc.) and generate a replacement.
- GitHub may retain unreachable objects server-side for a time even after force-push; rotation is the only zero-risk closure.
- Optional hardening: contact GitHub Support to purge cached objects / trigger a GC on the repo.

## Hygiene changes (commit `9051e7b`, then report in follow-up)

- `package.json`: added `"typecheck": "tsc --noEmit"` script.
- `vitest.config.ts`: excluded `freehire/**` → suite is now 7 files / 102 tests, all green, 0.8 s (was 10 s with 131 broken foreign suites).
- `eslint.config.js`: ignored `freehire/**`, `public/**`, `data/**`, `.vercel/**`, `.tanstack/**`, `.nitro`, `.wrangler/**`, `verification-shots/**`, `Investors_Profile_Pics/**` → full lint completes in ~11 s (was >10 min timeout). Full-repo baseline: 6200 problems.
- `.env.example`: documented `SCRAPIVO_DEBUG_STAGES`; added future/gated section (`DATABASE_URL`, `STRIPE_SECRET_KEY` commented; `WAAS_ALGOLIA_KEY=` placeholder gating the M3 Algolia adapter).
- Commits: `3b773fd` WIP restore point (pre-existing work preserved verbatim) → `9051e7b` hygiene.

## Post-hygiene verification

| Check | Result |
|---|---|
| `npm run test` | 7 files / 102 tests PASS |
| `npm run lint` | completes (~11 s), 6200 problems = recorded baseline for M5 |
| `git log --all -- ssh-key…` | empty — key absent from every reachable commit |
| Force-push | `origin/main = 9051e7b` |

Next: M1 — Clean presentation + investor correctness (pauses for browser review after).
