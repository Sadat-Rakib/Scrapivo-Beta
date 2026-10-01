# Build memory and server/client boundary (Task 18)

## Finding
The production build (`npm run build`, Vite + Nitro/Vercel output) needs a large Node heap on this machine and fails with the default heap. The code is not the cause; the environment is:

- 15.6 GB RAM, commit limit 39.9 GB. During this pass the Kiro IDE held about 16.6 GB private across ~48 processes; free physical RAM was often 0.3–1.2 GB and free commit 2–4 GB.
- The earlier OOM (esbuild `errno=1455`, "the paging file is too small") is a Windows commit-limit failure, not a JavaScript heap bug.

## Evidence
| Run | Heap flag | Result | Wall time | Notes |
|---|---|---|---|---|
| FULL GATE #1 | `--max-old-space-size=4096` | success | 1m35s build step | peak Node private ~5.3 GB; free commit fell to 0.42 GB |
| FULL GATE #2 | `--max-old-space-size=4096` | success (exit 0) | 267 s total | free commit 10.9 GB at start |
| Final gate | `--max-old-space-size=4096` | success (exit 0) | 107 s total (vite 35.7 s) | free commit 6.1 GB, free RAM 1.7 GB at start |

## How to build locally
```powershell
$env:NODE_OPTIONS = '--max-old-space-size=4096'
npm run build
```
Close other heavy apps first (IDE windows, browsers). If the build still dies with `errno=1455`, raise the Windows paging file or free commit memory; a larger `--max-old-space-size` does not help a commit-limit failure.

## Server/client boundary scan
Scanned every file in `.vercel/output/static` (the only code a browser downloads: 69 files) after the FULL GATE #2 build and again after the final build. Same result both times. The final scan also checked the city-gazetteer loader (`city_country_map`, `loadCityCountryMap`: 0 hits) and four configured secret values (both worker tokens and two provider keys: 0 hits).

| Pattern | Hits |
|---|---|
| `playwright-core`, `launchPersistentContext`, `chromium.launch` | 0 |
| `/browser/sessions`, `startEgressProxy`, `createSessionManager` | 0 |
| `BROWSER_WORKER_TOKEN`, `SCRAPIVO_BROWSER_WORKER_URL` (names) | 0 |
| Worker token values (both configured tokens) | 0 |
| `SUPABASE_SERVICE_ROLE` | 0 |

The worker token is read only in `src/lib/research-agent/browser-worker-config.server.ts` and `src/research-worker/server.ts`; the takeover UI talks to an authenticated server function (`scrapy-browser-control.functions.ts`) that uses dynamic server-only imports.

## Final pass (after UI acceptance fixes)
| Run | Heap flag | Result | Wall time |
|---|---|---|---|
| Final tree | `--max-old-space-size=4096` | success (exit 0) | 163 s total (vite 63 s) |

Repeatable bundle scan: `node reports/mvp-release-candidate/tools/bundle-scan.mjs` (the patterns above plus every `.env` secret value; it prints key names only). Final tree: 69 files, 0 pattern hits, 29 secret values checked, 0 found.

## Dev server blank page (fixed)
`npm run dev` served the SSR shell, but the page never hydrated. Vite's dependency scanner follows the `import()`s inside serverFn handlers into `playwright-core`. Pre-bundling it for the browser then fails on its optional `chromium-bidi/lib/cjs/...` requires. After a failed optimizer run, every `/node_modules/.vite/deps/*` request hangs. HEAD has the same imports.

Fix: `vite.optimizeDeps.exclude` now includes `"playwright-core"`. It never runs client-side. After changing it, delete `node_modules/.vite` once. The production build is unaffected.
