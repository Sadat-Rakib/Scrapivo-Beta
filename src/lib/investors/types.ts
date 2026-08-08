/**
 * Investor directory types — AI-friendly structured records for seed DB search.
 */
export type InvestorFocus = {
  sector: string;
  stage: string;
};

export type InvestorRecord = {
  id: string;
  name: string;
  firm: string;
  title: string;
  investor_type: "vc" | "angel" | "scout" | "unknown";
  check_sweet_spot_usd: number;
  check_min_usd: number;
  check_max_usd: number;
  locations: string[];
  focus_areas: InvestorFocus[];
  stages: string[];
  status: "active" | "needs_review" | "inactive";
  verification: {
    state: "unverified" | "verified" | "stale";
    last_checked_at: string | null;
    notes: string;
  };
  links: {
    linkedin: string | null;
    firm: string | null;
    profile: string | null;
  };
  source_batch: string;
};

export type InvestorsFile = {
  schema_version: number;
  generated_at: string;
  investors: InvestorRecord[];
};

export function slugifyInvestor(name: string, firm: string): string {
  return `${name}-${firm}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function parseMoney(raw: string): number {
  const s = (raw || "").trim().replace(/[$,\s]/g, "");
  if (!s || s === "—" || s === "-") return 0;
  const m = s.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(m[1]);
  const u = (m[2] || "").toLowerCase();
  if (u === "k") return Math.round(n * 1_000);
  if (u === "m") return Math.round(n * 1_000_000);
  if (u === "b") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

export function parseRange(raw: string): { min: number; max: number } {
  const parts = (raw || "").split(/[–—-]/).map((p) => p.trim());
  if (parts.length >= 2) {
    return { min: parseMoney(parts[0]), max: parseMoney(parts[1]) };
  }
  const n = parseMoney(raw);
  return { min: n, max: n };
}

export function parseFocus(items: string[]): InvestorFocus[] {
  const out: InvestorFocus[] = [];
  for (const item of items) {
    const m = item.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) out.push({ sector: m[1].trim(), stage: m[2].trim() });
    else if (item.trim()) out.push({ sector: item.trim(), stage: "Unknown" });
  }
  return out;
}

export function inferType(title: string, firm: string): InvestorRecord["investor_type"] {
  const t = `${title} ${firm}`.toLowerCase();
  if (/\bangel\b/.test(t) || /independent/i.test(firm)) return "angel";
  if (/\bscout\b/.test(t)) return "scout";
  if (/\b(partner|principal|associate|investor|gp|managing)\b/.test(t)) return "vc";
  return "unknown";
}

export function deriveStatus(rec: Pick<
  InvestorRecord,
  "check_sweet_spot_usd" | "check_min_usd" | "check_max_usd" | "title" | "locations" | "focus_areas"
>): InvestorRecord["status"] {
  if (
    (rec.check_sweet_spot_usd === 0 && rec.check_min_usd === 0 && rec.check_max_usd === 0) ||
    /^unknown$/i.test(rec.title) ||
    !rec.locations.length ||
    !rec.focus_areas.length
  ) {
    return "needs_review";
  }
  return "active";
}
