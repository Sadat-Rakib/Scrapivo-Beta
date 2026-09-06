/**
 * Companies DB-first source — reads data/companies_complete.jsonl produced by
 * scripts/pipeline (Companies House 300k UK + SEC EDGAR + YC directory + GLEIF;
 * grows over time). Streams the file line by line (the export will reach
 * multi-GB with the full registries — readFileSync would blow the V8 cap).
 *
 * Deterministic scoring only: query tokens vs name/industries/one-liner,
 * location tokens vs locality/country, hiring evidence from YC (`yc_hiring`).
 * Never fabricated — every row is a real registry/directory record.
 */
import { createReadStream } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { CompanyRow } from "../search/lead-segments";

export type CompanyFileRecord = {
  source: string; // "companies_house" | "sec_edgar" | "yc" | "gleif"
  registry_id: string;
  name: string;
  name_normalized?: string;
  jurisdiction?: string | null;
  status?: string | null;
  incorporated_date?: string | null;
  address_raw?: string | null;
  locality?: string | null;
  region?: string | null;
  country?: string | null;
  sic_codes?: string[];
  tickers?: string[];
  domain?: string | null;
  website?: string | null;
  industries?: string[];
  one_liner?: string | null;
  confidence?: number;
  evidence?: string[];
  last_seen?: string;
};

const DATA_DIRS = [resolve(process.cwd(), "data"), resolve(process.cwd(), "../data")];

function findFile(): string | null {
  for (const dir of DATA_DIRS) {
    const p = join(dir, "companies_complete.jsonl");
    if (existsSync(p)) return p;
  }
  return null;
}

const PLATFORM_LABEL: Record<string, string> = {
  companies_house: "Companies House",
  sec_edgar: "EDGAR",
  yc: "YC",
  gleif: "GLEIF",
};

function rowToCompany(rec: CompanyFileRecord, score: number): CompanyRow {
  const hiring = (rec.evidence ?? []).some((e) => e === "yc_hiring");
  const domain = rec.domain ?? undefined;
  const website = rec.website ?? (domain ? `https://${domain}` : undefined);
  const description =
    rec.one_liner ||
    [
      rec.industries?.length ? rec.industries.slice(0, 3).join(", ") : "",
      rec.locality || rec.country,
      rec.status ? rec.status.toLowerCase() : "",
    ]
      .filter(Boolean)
      .join(" · ") ||
    `${rec.name} — verified company record`;
  return {
    key: `${rec.source}:${rec.registry_id}`,
    name: rec.name,
    domain,
    website,
    linkedin_url: undefined,
    twitter_url: undefined,
    facebook_url: undefined,
    description,
    why_now: hiring
      ? `Actively hiring — ${rec.evidence?.filter((e) => e.startsWith("yc_batch")).join(" ") || "YC directory"}`
      : description,
    signal_count: Math.max(1, (rec.evidence ?? []).length),
    platforms: [PLATFORM_LABEL[rec.source] ?? rec.source],
    sample_url: website || `https://www.google.com/search?q=${encodeURIComponent(rec.name)}`,
    latest_signal: rec.incorporated_date
      ? `Incorporated ${rec.incorporated_date.slice(0, 10)}`
      : undefined,
    inline_contacts: undefined,
    leads: [],
    score,
  };
}

function tokenMatches(rec: CompanyFileRecord, tokens: string[]): boolean {
  const hay = `${rec.name ?? ""} ${rec.name_normalized ?? ""} ${(rec.industries ?? []).join(" ")} ${
    rec.one_liner ?? ""
  } ${rec.sic_codes ?? [].join(" ")}`.toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

function locationMatches(rec: CompanyFileRecord, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = `${rec.locality ?? ""} ${rec.region ?? ""} ${rec.country ?? ""} ${
    rec.address_raw ?? ""
  } ${rec.jurisdiction ?? ""}`.toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

export type CompanyQuery = {
  query: string;
  hiringOnly?: boolean;
  location?: string | null;
  limit?: number;
};

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !/^(the|and|for|with|that|have|has|from|find|me|my|are|was|were|who|which|companies|company|businesses|business|firms?|actively|hiring|remotely|remote|looking|need|need|want|soon|asap|now)$/.test(
          w,
        ),
    );
}

/**
 * Stream-scan the companies DB. Score: name/industry/one-liner token overlap
 * (+ hiring evidence when requested). Location tokens narrow when present.
 */
export async function searchCompleteCompanies(q: CompanyQuery): Promise<CompanyRow[]> {
  const path = findFile();
  if (!path) return [];
  const limit = q.limit ?? 40;
  const qTokens = tokenize(q.query);
  const locTokens = tokenize(q.location ?? "");
  const hiringOnly = !!q.hiringOnly;
  const out: CompanyRow[] = [];

  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    let rec: CompanyFileRecord;
    try {
      rec = JSON.parse(s) as CompanyFileRecord;
    } catch {
      continue;
    }
    if (!rec?.registry_id || !rec?.name) continue;
    if (hiringOnly && !(rec.evidence ?? []).some((e) => e === "yc_hiring")) continue;
    if (!locationMatches(rec, locTokens)) continue;

    let score = rec.confidence ?? 50;
    if (hiringOnly) score += 10;
    if (qTokens.length) {
      if (!tokenMatches(rec, qTokens)) continue;
      score += Math.min(20, qTokens.length * 8);
    }
    out.push(rowToCompany(rec, Math.min(98, score)));
    if (out.length >= limit * 4) break; // rank and slice
  }
  rl.close();
  stream.close();

  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.signal_count - a.signal_count ||
      a.name.localeCompare(b.name),
  );
  return out.slice(0, limit);
}
