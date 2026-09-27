/**
 * Canonical investor reader — S3 Parquet (canonical, both raws merged).
 * Replaces the JSONL file-source path for spec-first search.
 */
import { readFiltered, type DbHitMeta } from "./read-parquet.server";
import { investorSectorMatches } from "@/lib/search/search-spec";

export interface CanonicalInvestor {
  id: string | null;
  name: string | null;
  kind: string | null;
  firm: string | null;
  role: string | null;
  location_raw: string | null;
  location_city: string | null;
  location_country: string | null;
  email: string | null;
  linkedin: string | null;
  website: string | null;
  quality_score: number | null;
  sectors: string[] | null;
  stages: string[] | null;
  check_min_usd: number | null;
  check_max_usd: number | null;
}

const KEY = "processed/investors/investor.parquet";
const COLS = ["id", "name", "kind", "firm", "role", "location_raw",
  "location_city", "location_country", "email", "linkedin", "website",
  "quality_score", "sectors", "stages", "check_min_usd", "check_max_usd"];

const textOf = (v: unknown): string =>
  Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "";
const like = (v: unknown, needle: string) =>
  textOf(v).toLowerCase().includes(needle.toLowerCase());

function moneyValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.toLowerCase().replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*([kmb])?/);
  if (!m) return null;
  const scale = m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  return Number(m[1]) * scale;
}

export async function searchInvestorsDB(q: {
  query?: string;
  name?: string;
  sector?: string;
  stage?: string;
  check?: string;
  location?: string;
  kind?: string;
  limit?: number;
}): Promise<{ rows: CanonicalInvestor[]; meta: DbHitMeta }> {
  const limit = Math.min(q.limit ?? 50, 200);
  const needle = (q.query ?? q.name ?? "").trim();
  // Stage/check match against the row's own stages list (check bands like
  // "angel"/"growth" appear there); sector against sectors. All optional.
  const checkValue = moneyValue(q.check);
  const stageNeedle = (q.stage ?? (checkValue == null ? q.check : "") ?? "").trim().toLowerCase();
  return readFiltered<CanonicalInvestor>({
    keys: [KEY],
    columns: COLS,
    limit,
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: [KEY] },
    where: (r) =>
      (!needle || like(r.name, needle) || like(r.firm, needle)) &&
      (!q.sector || investorSectorMatches(textOf((r as unknown as Record<string, unknown>).sectors), q.sector)) &&
      (!stageNeedle || like((r as unknown as Record<string, unknown>).stages, stageNeedle)) &&
      (!q.check || checkValue == null ||
        ((typeof r.check_min_usd !== "number" || r.check_min_usd <= checkValue) &&
         (typeof r.check_max_usd !== "number" || r.check_max_usd >= checkValue))) &&
      (!q.location || like(r.location_raw, q.location) || like(r.location_country, q.location)) &&
      (!q.kind || r.kind === q.kind),
  });
}
