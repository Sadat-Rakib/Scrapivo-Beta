import {
  expandAbbreviations,
  detectUrgency,
  FILLER_TOKENS,
  URGENCY_TOKENS,
  NEVER_GEO_TOKENS,
} from "./abbreviations";
import { LOCATION_ALIASES } from "@/lib/local/city-gazetteer";

export type InputTokens = {
  raw: string;
  expanded: string;
  category: "investor" | "job" | "business" | "company" | "people" | "unknown";
  stage: string | null;
  sector: string | null;
  geo: string | null;
  scale: number | null;
  urgency: boolean;
  /** Meaningful match tokens (slot words + leftovers, filler stripped). */
  keywords: string[];
};

const STAGES = ["pre-seed", "seed", "series a", "series b", "series c", "angel"] as const;

const SECTORS = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "fintech",
  "saas",
  "health",
  "healthcare",
  "biotech",
  "climate",
  "climatetech",
  "devtools",
  "developer tools",
  "crypto",
  "web3",
  "edtech",
  "ecommerce",
  "e-commerce",
  "cybersecurity",
  "security",
  "robotics",
  "iot",
  "gaming",
  "proptech",
  "legaltech",
  "hr tech",
  "logistics",
  "food",
  "agtech",
] as const;

const CATEGORY_SIGNALS: Array<{ cat: InputTokens["category"]; words: string[] }> = [
  {
    cat: "investor",
    words: [
      "investor",
      "investors",
      "venture capital",
      "vc",
      "angel",
      "fund",
      "funds",
      "funding",
      "raise",
      "raising",
      "pre-seed",
      "seed round",
    ],
  },
  {
    cat: "job",
    words: [
      "job",
      "jobs",
      "hiring",
      "hire",
      "role",
      "roles",
      "opening",
      "openings",
      "career",
      "apply",
    ],
  },
  {
    cat: "business",
    words: [
      "local business",
      "local businesses",
      "plumber",
      "dentist",
      "restaurant",
      "salon",
      "hvac",
      "roofer",
      "shop",
      "store",
    ],
  },
  // people before company: "startup founders" / "company executives" are people hunts
  {
    cat: "people",
    words: [
      "founder",
      "founders",
      "ceo",
      "executive",
      "executives",
      "owner",
      "owners",
      "people",
      "person",
    ],
  },
  {
    cat: "company",
    words: ["company", "companies", "startup", "startups", "firm", "firms", "enterprise"],
  },
];

function includesWord(hay: string, needle: string): boolean {
  return needle.includes(" ")
    ? hay.includes(needle)
    : new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay);
}

function detectGeo(expanded: string): string | null {
  const hay = ` ${expanded} `;
  const keys = Object.keys(LOCATION_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const key = k.toLowerCase();
    if (NEVER_GEO_TOKENS.has(key)) continue;
    if (key.length < 3) continue;
    if (includesWord(hay, key)) return LOCATION_ALIASES[k] ?? k;
  }
  return null;
}

/** Deterministic pre-pass over raw input. Explicit typed words always win. */
export function tokenizeInput(raw: string): InputTokens {
  const expanded = expandAbbreviations(raw);
  const hay = ` ${expanded} `;
  const urgency = detectUrgency(raw);

  const scaleMatch = raw.match(/(\d+)\s*\+/) ?? expanded.match(/(\d+)\s*\+/);
  const scale = scaleMatch ? Number(scaleMatch[1]) : null;

  let stage: string | null = null;
  for (const s of STAGES) {
    if (includesWord(hay, s)) {
      stage = s;
      break;
    }
  }

  let sector: string | null = null;
  for (const s of SECTORS) {
    if (includesWord(hay, s)) {
      sector = s;
      break;
    }
  }

  const geo = detectGeo(expanded);

  let category: InputTokens["category"] = "unknown";
  for (const { cat, words } of CATEGORY_SIGNALS) {
    if (words.some((w) => includesWord(hay, w))) {
      category = cat;
      break;
    }
  }

  const stop = new Set<string>();
  for (const w of FILLER_TOKENS) stop.add(w);
  for (const w of URGENCY_TOKENS) stop.add(w);
  const words = expanded.match(/[a-z0-9][a-z0-9+\-.]*/g) ?? [];
  const keywords = [...new Set(words.filter((w) => !stop.has(w) && w.length > 1))];

  return { raw, expanded, category, stage, sector, geo, scale, urgency, keywords };
}
