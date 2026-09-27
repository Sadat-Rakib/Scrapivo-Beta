import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AtsProvider } from "@/lib/search/ats-sources.server";

export type AtsTenant = { company: string; provider: string; board: string };

let cached: AtsTenant[] | null = null;

/** Curated board catalog generated from the freehire board lists
 *  (scripts/build-job-board-catalog.mts → data/job_boards_catalog.json). */
let catalogCache: Record<string, string[]> | null = null;

function loadBoardCatalog(): Record<string, string[]> {
  if (catalogCache) return catalogCache;
  catalogCache = {};
  const candidates = [
    resolve(process.cwd(), "data/job_boards_catalog.json"),
    resolve(process.cwd(), "../data/job_boards_catalog.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      catalogCache = JSON.parse(readFileSync(p, "utf8")) as Record<string, string[]>;
      break;
    } catch {
      /* try next */
    }
  }
  return catalogCache;
}

export function catalogBoardsFor(provider: AtsProvider | string): string[] {
  return loadBoardCatalog()[provider] ?? [];
}

export function loadCompanyAtsTenants(): AtsTenant[] {
  if (cached) return cached;
  const candidates = [
    resolve(process.cwd(), "data/company_ats_tenants.json"),
    resolve(process.cwd(), "../data/company_ats_tenants.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      cached = JSON.parse(readFileSync(p, "utf8")) as AtsTenant[];
      return cached;
    } catch {
      /* try next */
    }
  }
  cached = [];
  return cached;
}

export function tenantBoardsFor(provider: AtsProvider | string): string[] {
  return loadCompanyAtsTenants()
    .filter((t) => t.provider === provider && t.board)
    .map((t) => t.board);
}

// ---------------------------------------------------------------------------
// Board-directory seed import (seeds/board-directory-2026-09-25.json)
//
// DISCOVERY INTELLIGENCE, NOT TRUTH. Each row names one employer's public job
// board, but only `status: "live"` rows were actually probed and answered with
// a populated payload. `unverified` rows have never been checked — they are
// low-priority backfill only and must NEVER be recorded or advertised as
// live/verified (any ats_companies upsert or log must carry this state).
// `suspect` rows answered "not found" once and are never used.
//
// LICENSE ATTRIBUTION (from the seed file's `sources` block): board rows are
// sourced from the JobSync bundled company board lists
// (src/lib/scraper/greenhouse, lever and ashby companies.json) — MIT licensed,
// Copyright (c) 2024 gsync — https://github.com/Gsync/jobsync
// (licence: https://github.com/Gsync/jobsync/blob/527333e60d4913f3af217c2153a8ee7bc68cf857/LICENSE).
// The upstream repository does not say how the lists were made; every source
// is named in the seed file with its licence and a public page, and no row
// comes from a source whose licence forbids commercial use. The job boards and
// their postings belong to the providers and the employers.
// ---------------------------------------------------------------------------

export type SeedBoardStatus = "live" | "suspect" | "unverified";

/** Code-level licence attribution for the seed rows (mirrors the file's
 *  `sources` block; the file itself remains the canonical record). */
export const BOARD_SEED_ATTRIBUTION =
  "Board directory rows sourced from the JobSync bundled company board lists (MIT licence) — Copyright (c) 2024 gsync — https://github.com/Gsync/jobsync. Job boards and their postings belong to the providers and the employers.";

export type SeedBoardRow = {
  ats: string;
  slug: string;
  name: string;
  region: string | null;
  source: string;
  lastVerified: string | null;
  status: SeedBoardStatus;
};

const BOARD_SEED_FILE = "seeds/board-directory-2026-09-25.json";

let seedRowsCache: SeedBoardRow[] | null = null;

export function loadBoardSeedRows(): SeedBoardRow[] {
  if (seedRowsCache) return seedRowsCache;
  seedRowsCache = [];
  const candidates = [
    resolve(process.cwd(), BOARD_SEED_FILE),
    resolve(process.cwd(), "..", BOARD_SEED_FILE),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as { rows?: SeedBoardRow[] };
      seedRowsCache = (parsed.rows ?? []).filter(
        (r) => r && typeof r.slug === "string" && r.slug && typeof r.ats === "string",
      );
      break;
    } catch {
      /* try next */
    }
  }
  return seedRowsCache;
}

/** The seed file's own source/licence records (JobSync et al.), for callers
 *  that surface provenance. */
export function loadBoardSeedSources(): Array<{
  id: string;
  name: string;
  url: string;
  licence: string;
  licenceUrl?: string;
  copyright?: string;
}> {
  const candidates = [
    resolve(process.cwd(), BOARD_SEED_FILE),
    resolve(process.cwd(), "..", BOARD_SEED_FILE),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as {
        sources?: Array<{ id: string; name: string; url: string; licence: string }>;
      };
      return parsed.sources ?? [];
    } catch {
      /* try next */
    }
  }
  return [];
}

/** Verification state per seed slug ("live" wins over "unverified" for the
 *  same slug). Callers recording boards anywhere (DB upsert, logs) must read
 *  this instead of assuming — unverified stays unverified. */
export function seedBoardStatus(
  provider: AtsProvider | string,
): Map<string, Exclude<SeedBoardStatus, "suspect">> {
  const m = new Map<string, Exclude<SeedBoardStatus, "suspect">>();
  for (const r of loadBoardSeedRows()) {
    if (r.ats !== provider) continue;
    if (r.status !== "live" && r.status !== "unverified") continue;
    if (m.get(r.slug) === "live") continue;
    m.set(r.slug, r.status);
  }
  return m;
}

/** Seed boards for one ATS provider, merge-ready: live-verified rows first,
 *  then unverified rows as backfill. Deduped (live wins for a duplicated slug);
 *  "suspect" rows excluded. */
export function seedBoardsFor(provider: AtsProvider | string): string[] {
  const status = seedBoardStatus(provider);
  const live: string[] = [];
  const backfill: string[] = [];
  for (const [slug, s] of status) {
    if (s === "live") live.push(slug);
    else backfill.push(slug);
  }
  return [...live, ...backfill];
}
