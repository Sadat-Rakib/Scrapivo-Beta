import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tokenizeInput } from "@/lib/search/tokenize-input";

export type CompleteInvestor = {
  id: string;
  name: string;
  firm: string;
  role: string;
  location: string;
  location_city: string;
  location_country: string;
  sectors: string[];
  stages: string[];
  check_min_usd: number;
  check_max_usd: number;
  email: string;
  linkedin: string | null;
  website: string | null;
  image_url: string | null;
  /** Extractive bio (merged/harvested) or null — display composes a fallback. */
  bio: string | null;
  bio_source: "merged" | "harvested" | null;
  bio_scope?: "person" | "firm" | null;
  completeness: number;
  provenance: string[];
};

let cache: CompleteInvestor[] | null = null;

export function loadCompleteInvestors(): CompleteInvestor[] {
  if (cache) return cache;
  const p = resolve(process.cwd(), "data/investors_complete.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  cache = lines.map((l) => JSON.parse(l) as CompleteInvestor);
  return cache;
}

export function searchCompleteInvestors(filters: {
  sector?: string;
  stage?: string;
  location?: string;
  checkBand?: "angel" | "seed" | "growth" | "any";
  query?: string;
  limit?: number;
}): CompleteInvestor[] {
  const all = loadCompleteInvestors();
  // Deterministic tokens win over the raw query: explicit typed words
  // (sector/stage/geo) become hard filters, leftovers score by overlap.
  const tokens = tokenizeInput(filters.query ?? "");
  const sector = (filters.sector || tokens.sector || "").toLowerCase();
  let stage = (filters.stage || tokens.stage || "").toLowerCase();
  // "angel" is a check-size band, not a stage tag in the data — route it there.
  let checkBand = filters.checkBand ?? "any";
  if (stage === "angel" && checkBand === "any") {
    checkBand = "angel";
    stage = "";
  }
  const loc = (filters.location || tokens.geo || "").toLowerCase();
  const keywords = tokens.keywords.filter(
    (k) =>
      k !== sector &&
      k !== stage.replace(/-/g, "") &&
      !(loc && loc.includes(k)) &&
      !["investor", "investors", "venture", "capital", "startup", "startups"].includes(k),
  );
  const scored = all.flatMap((r) => {
    if (sector && sector !== "any" && !r.sectors.some((s) => s.toLowerCase().includes(sector)))
      return [];
    if (
      stage &&
      stage !== "any" &&
      !r.stages.some((s) => s.toLowerCase().replace(/-/g, "") === stage.replace(/-/g, ""))
    )
      return [];
    if (loc && loc !== "global" && !r.location.toLowerCase().includes(loc)) return [];
    if (checkBand && checkBand !== "any") {
      const sweet = r.check_max_usd || r.check_min_usd;
      if (checkBand === "angel" && !(sweet > 0 && sweet < 100_000)) return [];
      if (checkBand === "seed" && !(sweet >= 100_000 && sweet <= 5_000_000)) return [];
      if (checkBand === "growth" && !(sweet > 5_000_000)) return [];
    }
    // Token overlap over name/firm/sectors/stages/location (no full-phrase match).
    const hay =
      `${r.name} ${r.firm} ${r.sectors.join(" ")} ${r.stages.join(" ")} ${r.location}`.toLowerCase();
    let overlap = 0;
    for (const k of keywords) {
      if (k.length > 2 && hay.includes(k)) overlap++;
    }
    return [{ r, overlap }];
  });
  // Relevance first (overlap), then image + completeness (existing ranking).
  scored.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      Number(!!b.r.image_url) - Number(!!a.r.image_url) ||
      b.r.completeness - a.r.completeness,
  );
  return scored.map((s) => s.r).slice(0, filters.limit ?? 50);
}
