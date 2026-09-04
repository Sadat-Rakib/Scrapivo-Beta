import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
  const q = (filters.query ?? "").toLowerCase();
  const sector = (filters.sector ?? "").toLowerCase();
  const stage = (filters.stage ?? "").toLowerCase();
  const loc = (filters.location ?? "").toLowerCase();
  const out = all.filter((r) => {
    if (sector && sector !== "any" && !r.sectors.some((s) => s.toLowerCase().includes(sector)))
      return false;
    if (
      stage &&
      stage !== "any" &&
      !r.stages.some((s) => s.toLowerCase().replace(/-/g, "") === stage.replace(/-/g, ""))
    )
      return false;
    if (loc && loc !== "global" && !r.location.toLowerCase().includes(loc)) return false;
    if (filters.checkBand && filters.checkBand !== "any") {
      const sweet = r.check_max_usd || r.check_min_usd;
      if (filters.checkBand === "angel" && !(sweet > 0 && sweet < 100_000)) return false;
      if (filters.checkBand === "seed" && !(sweet >= 100_000 && sweet <= 5_000_000)) return false;
      if (filters.checkBand === "growth" && !(sweet > 5_000_000)) return false;
    }
    if (q && !`${r.name} ${r.firm} ${r.sectors.join(" ")}`.toLowerCase().includes(q)) return false;
    return true;
  });
  // Image + completeness first (same ordering principle as search.ts ranking)
  out.sort(
    (a, b) => Number(!!b.image_url) - Number(!!a.image_url) || b.completeness - a.completeness,
  );
  return out.slice(0, filters.limit ?? 50);
}
