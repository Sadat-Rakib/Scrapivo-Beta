# LOCAL_BUSINESS_SEARCH_ROOT_CAUSE

Callers: `local-businesses.functions.ts:164-172` (DB-first, skip OSM if ≥12 file
leads) + `sources.server.ts:3246-3265` (early-return if ≥25). Loader:
`businesses-file-source.ts:100-114,161,240,263,446` (manifest+city-map routing,
≤80MB LRU, >80MB stream-filter, score `search.ts`-style craft/keyword/phone/site).

## Root cause

1. 91 files / 12.6GB gitignored → Vercel always OSM/Foursquare/Geoapify;
   `sources:412-414` omits `overture/file`, hiding absence.
2. All major markets >80MB → 300MB–1.7GB stream-scan/query vs 55s `Promise.race`
   + V8 512MB cap → timeout-prone.
3. Overture noise (landmarks/parks: `Farallon Lighthouse`) needs
   `CRAFT_CATEGORIES` + `isJunkLocalListing`; synonym table ~30 crafts.
4. Dev-vs-prod illusion: small `austin` (77MB) caches; prod reads nothing.

## Fix (needs approval)

`raw/local-businesses/` → per-country Parquet + per-city index API; Vercel ships
manifests only. License: CDLA-Permissive-2.0 (+ODbL subset); keep
`source/evidence`, show attribution.
