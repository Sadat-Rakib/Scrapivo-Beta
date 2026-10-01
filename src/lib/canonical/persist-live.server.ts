/**
 * Upsert VERIFIED live discoveries into Postgres idx_* tables (Phase 1D).
 * Schema: supabase/migrations/20260910000000_search_index.sql
 *
 * Default path: My Supabase service-role client (same store as indexed reads).
 * Optional: DATABASE_URL + `pg` for direct SQL when both are available.
 */
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "@/lib/search/evidence";
import { createHash } from "node:crypto";
import {
  canonicalFactProjection,
  rejectJudgmentFields,
} from "@/lib/canonical/fact-projection";

/**
 * Canonical-facts-only gate (Workstream 4): rows reach idx_* storage through
 * canonicalFactProjection, so thesis-specific judgment fields (why_match,
 * fit/intent scores, disposition, outreach angles, ...) can never leak into
 * canonical storage even if a future payload builder spreads row fields.
 * Dev-warns once per run when judgments were detected and stripped.
 */
let judgmentWarnedOnce = false;

export function prepareVerifiedRowForPersist(row: SpecRow): {
  row: SpecRow;
  rejected: string[];
} {
  const rejected = rejectJudgmentFields(row);
  if (rejected.length && !judgmentWarnedOnce && process.env.NODE_ENV !== "production") {
    judgmentWarnedOnce = true;
    console.warn(
      "[persist-live] judgment fields blocked from canonical storage:",
      rejected.join(", "),
    );
  }
  return { row: canonicalFactProjection(row), rejected };
}

function registryKey(row: SpecRow): string | null {
  if (row.key && !row.key.startsWith("live-web:") && !row.key.startsWith("live-social:")) {
    return row.key;
  }
  if (!row.url) return null;
  try {
    const host = new URL(row.url.startsWith("http") ? row.url : `https://${row.url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
    if (!host || host.length < 3) return null;
    return `live-web:${host}`;
  } catch {
    return null;
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 200);
}

/** L1.5 / M1 VERIFIED: must already be theorem-qualified. */
export function isVerifiedForPersist(row: SpecRow): boolean {
  if (row.verification_status === "rejected") return false;
  // Hard gate: only QualifiedLead disposition may persist as verified.
  if (row.disposition !== "qualified") return false;
  if (row.entity_resolved !== true) return false;
  if (row.entity_id?.startsWith("provisional:")) return false;
  const key = registryKey(row);
  if (!key) return false;
  // Signal leads need subject-bound claim evidence on the row.
  const ev = row.evidence ?? [];
  if (ev.length) {
    const hasBoundClaim = ev.some(
      (e) =>
        e.subject &&
        e.subject === (row.entity_id ?? row.key) &&
        ["hiring", "service_request", "no_website", "funding", "social_ask"].includes(
          e.evidence_type,
        ),
    );
    if (!hasBoundClaim) return false;
  }
  if (row.url) {
    try {
      const u = new URL(row.url.startsWith("http") ? row.url : `https://${row.url}`);
      if (!u.hostname || u.hostname.length < 3) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function contentHash(row: SpecRow, evidence: Evidence[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: row.title,
        url: row.url,
        evidence: evidence.map((e) => ({
          t: e.evidence_type,
          u: e.source_url,
          x: e.excerpt,
        })),
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

export interface PersistResult {
  attempted: number;
  persisted: number;
  skipped: number;
  keys: string[];
  error?: string;
  via?: "supabase" | "pg";
}

type UpsertPayload = Record<string, unknown>;

function rowPayload(row: SpecRow): {
  key: string;
  table: "idx_people" | "idx_businesses" | "idx_companies";
  payload: UpsertPayload;
} | null {
  const key = registryKey(row);
  if (!key) return null;
  const evidence = row.evidence ?? [];
  const hash = contentHash(row, evidence);
  const name = (row.title ?? "Unknown").slice(0, 200);
  const nameNorm = normalizeName(name) || "unknown";
  const website = row.url;
  const city = row.location ?? null;
  const cityNorm = city ? city.toLowerCase().trim() : null;
  const countryRaw = (row.country ?? "").trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;
  const category = row.category ?? row.industry ?? null;
  const source = "live-web";

  let domain: string | null = null;
  if (website) {
    try {
      domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(
        /^www\./,
        "",
      );
    } catch {
      domain = null;
    }
  }

  if (row.kind === "person") {
    return {
      key,
      table: "idx_people",
      payload: {
        registry_key: key,
        source,
        name,
        name_normalized: nameNorm,
        role: row.detail?.slice(0, 120) ?? null,
        city,
        city_norm: cityNorm,
        country,
        industry: category,
        content_hash: hash,
        last_seen: new Date().toISOString(),
        quality_score: 50,
      },
    };
  }

  if (row.kind === "business") {
    // country is NOT NULL on idx_businesses — skip if unknown.
    if (!country) return null;
    return {
      key,
      table: "idx_businesses",
      payload: {
        registry_key: key,
        source,
        name,
        name_normalized: nameNorm,
        category,
        city,
        city_norm: cityNorm,
        country,
        website,
        domain,
        content_hash: hash,
        last_seen: new Date().toISOString(),
        quality_score: 50,
        junk_flag: 0,
      },
    };
  }

  return {
    key,
    table: "idx_companies",
    payload: {
      registry_key: key,
      source,
      name,
      name_normalized: nameNorm,
      category,
      city,
      city_norm: cityNorm,
      country,
      website,
      domain,
      content_hash: hash,
      last_seen: new Date().toISOString(),
      quality_score: 50,
    },
  };
}

async function persistViaSupabase(candidates: SpecRow[]): Promise<PersistResult> {
  const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
  const admin = getAdmin();
  const result: PersistResult = {
    attempted: candidates.length,
    persisted: 0,
    skipped: 0,
    keys: [],
    via: "supabase",
  };

  for (const row of candidates) {
    const built = rowPayload(row);
    if (!built) {
      result.skipped += 1;
      continue;
    }
    const { error } = await admin.from(built.table).upsert(built.payload, {
      onConflict: "registry_key",
    });
    if (error) {
      console.warn("[persist-live] upsert failed", built.key, error.message);
      result.skipped += 1;
      continue;
    }
    result.persisted += 1;
    result.keys.push(built.key);
  }
  return result;
}

async function persistViaPg(candidates: SpecRow[], url: string): Promise<PersistResult> {
  const result: PersistResult = {
    attempted: candidates.length,
    persisted: 0,
    skipped: 0,
    keys: [],
    via: "pg",
  };
  // `pg` is an optional direct-SQL optimization. Keep Vite from resolving it
  // into every production bundle; the primary Supabase path needs no pg
  // package. When DATABASE_URL is explicitly configured but pg is absent, the
  // caller records the failure and uses the existing Supabase fallback.
  const pgModuleName = "pg";
  const { default: pg } = await import(/* @vite-ignore */ pgModuleName) as {
    default: { Pool: new (options: { connectionString: string; max: number }) => {
      query: (sql: string, values: unknown[]) => Promise<unknown>;
      end: () => Promise<void>;
    } };
  };
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    for (const row of candidates) {
      const built = rowPayload(row);
      if (!built) {
        result.skipped += 1;
        continue;
      }
      try {
        if (built.table === "idx_people") {
          await pool.query(
            `INSERT INTO idx_people (
               registry_key, source, name, name_normalized, role, city, city_norm,
               country, industry, content_hash, last_seen, quality_score
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),50)
             ON CONFLICT (registry_key) DO UPDATE SET
               name = EXCLUDED.name,
               name_normalized = EXCLUDED.name_normalized,
               content_hash = EXCLUDED.content_hash,
               last_seen = NOW()`,
            [
              built.payload.registry_key,
              built.payload.source,
              built.payload.name,
              built.payload.name_normalized,
              built.payload.role,
              built.payload.city,
              built.payload.city_norm,
              built.payload.country,
              built.payload.industry,
              built.payload.content_hash,
            ],
          );
        } else if (built.table === "idx_businesses") {
          await pool.query(
            `INSERT INTO idx_businesses (
               registry_key, source, name, name_normalized, category, city, city_norm,
               country, website, domain, content_hash, last_seen, quality_score, junk_flag
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),50,0)
             ON CONFLICT (registry_key) DO UPDATE SET
               name = EXCLUDED.name,
               website = COALESCE(EXCLUDED.website, idx_businesses.website),
               content_hash = EXCLUDED.content_hash,
               last_seen = NOW()`,
            [
              built.payload.registry_key,
              built.payload.source,
              built.payload.name,
              built.payload.name_normalized,
              built.payload.category,
              built.payload.city,
              built.payload.city_norm,
              built.payload.country,
              built.payload.website,
              built.payload.domain,
              built.payload.content_hash,
            ],
          );
        } else {
          await pool.query(
            `INSERT INTO idx_companies (
               registry_key, source, name, name_normalized, category, city, city_norm,
               country, website, domain, content_hash, last_seen, quality_score
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),50)
             ON CONFLICT (registry_key) DO UPDATE SET
               name = EXCLUDED.name,
               website = COALESCE(EXCLUDED.website, idx_companies.website),
               content_hash = EXCLUDED.content_hash,
               last_seen = NOW()`,
            [
              built.payload.registry_key,
              built.payload.source,
              built.payload.name,
              built.payload.name_normalized,
              built.payload.category,
              built.payload.city,
              built.payload.city_norm,
              built.payload.country,
              built.payload.website,
              built.payload.domain,
              built.payload.content_hash,
            ],
          );
        }
        result.persisted += 1;
        result.keys.push(built.key);
      } catch (rowErr) {
        console.warn(
          "[persist-live] row upsert failed",
          built.key,
          rowErr instanceof Error ? rowErr.message : rowErr,
        );
        result.skipped += 1;
      }
    }
  } finally {
    await pool.end();
  }
  return result;
}

export async function persistVerifiedLiveRows(rows: SpecRow[]): Promise<PersistResult> {
  // Verification gate runs on the RAW row (it needs disposition/evidence);
  // only the storage payload is projected down to canonical facts.
  const candidates = rows
    .filter(isVerifiedForPersist)
    .map((r) => prepareVerifiedRowForPersist(r).row);
  const result: PersistResult = {
    attempted: candidates.length,
    persisted: 0,
    skipped: rows.length - candidates.length,
    keys: [],
  };
  if (!candidates.length) return result;
  const { skipPersistence } = await import("@/lib/persistence-policy.server");
  if (skipPersistence("canonical_live_rows")) {
    return { ...result, attempted: 0, skipped: rows.length };
  }

  const url = process.env.DATABASE_URL?.trim();
  try {
    if (url) {
      try {
        const pgResult = await persistViaPg(candidates, url);
        return {
          ...pgResult,
          skipped: result.skipped + pgResult.skipped,
        };
      } catch (pgErr) {
        console.warn(
          "[persist-live] DATABASE_URL path failed, falling back to Supabase:",
          pgErr instanceof Error ? pgErr.message : pgErr,
        );
      }
    }
    const sb = await persistViaSupabase(candidates);
    return {
      ...sb,
      skipped: result.skipped + sb.skipped,
    };
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.skipped += candidates.length;
    console.warn("[persist-live]", result.error);
    return result;
  }
}

export function stampVerified(rows: SpecRow[]): SpecRow[] {
  return rows.map((r) =>
    isVerifiedForPersist(r)
      ? { ...r, verification_status: "verified" as const }
      : {
          ...r,
          verification_status: (r.verification_status ?? "discovered") as SpecRow["verification_status"],
        },
  );
}
