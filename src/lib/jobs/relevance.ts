/**
 * Job relevance scoring — token-based, word-boundary matching.
 *
 * The old pipeline ranked by recency only and gated with a substring
 * `title.includes(needle)`, so "senior designer" surfaced a "Software
 * Engineering Intern — Design Systems" posting. Here the query is split into
 * a role phrase + role tokens (seniority words stripped), every match is a
 * word-boundary match (never a substring), and results are ranked
 * relevance-first with recency as the tiebreaker.
 */
import type { JobPosting, JobSearchFilters } from "./types";
import { recencyRank } from "./hygiene";
import { guessSeniority } from "./filters";

/** Words that describe level, not the role itself. */
const SENIORITY_WORDS = new Set([
  "senior",
  "junior",
  "jr",
  "sr",
  "mid",
  "lead",
  "principal",
  "staff",
  "entry",
  "entry-level",
  "graduate",
  "intern",
  "internship",
  "head",
  "chief",
  "vp",
  "director",
  "manager",
  "experienced",
]);

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "at",
  "for",
  "to",
  "jobs",
  "job",
  "role",
  "roles",
  "position",
  "positions",
  "opening",
  "openings",
  "vacancies",
  "remote",
]);

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match with a simple plural allowance ("designer" → "designers"). */
export function hasWord(haystack: string | null | undefined, word: string): boolean {
  if (!haystack) return false;
  return new RegExp(`\\b${escapeRe(word.toLowerCase())}(?:s|es)?\\b`, "i").test(haystack);
}

export type ParsedQuery = {
  /** Original trimmed query. */
  raw: string;
  /** Query with seniority/stop words removed — "senior product designer". */
  phrase: string;
  /** Role tokens ("product", "designer") — seniority + stop words removed. */
  tokens: string[];
  /** Seniority token if the query stated one ("senior"). */
  seniority?: string;
};

export function parseQuery(q: string | null | undefined): ParsedQuery {
  const raw = (q || "").trim();
  const words = raw.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
  const seniority = words.find((w) => SENIORITY_WORDS.has(w));
  const tokens = words.filter((w) => !SENIORITY_WORDS.has(w) && !STOPWORDS.has(w) && w.length > 1);
  return {
    raw,
    phrase: tokens.join(" ").trim(),
    tokens,
    ...(seniority ? { seniority } : {}),
  };
}

const EMP_TYPE_NORM: Record<string, string> = {
  "full-time": "full-time",
  fulltime: "full-time",
  "full time": "full-time",
  ft: "full-time",
  permanent: "full-time",
  "part-time": "part-time",
  parttime: "part-time",
  "part time": "part-time",
  pt: "part-time",
  contract: "contract",
  contractor: "contract",
  freelance: "contract",
  "temporary": "contract",
  internship: "internship",
  intern: "internship",
  "working student": "internship",
};

export function normalizeEmploymentType(v: string | null | undefined): string | null {
  if (!v) return null;
  const key = v.toLowerCase().trim();
  return EMP_TYPE_NORM[key] ?? null;
}

function employmentTypeFromTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "internship";
  if (/\bcontract(or)?\b|\bfreelance\b|\bc2c\b|\b1099\b/.test(t)) return "contract";
  if (/\bpart[- ]time\b/.test(t)) return "part-time";
  if (/\bfull[- ]time\b|\bpermanent\b/.test(t)) return "full-time";
  return null;
}

/** Relevance score for one job against the parsed query + filters. Higher = better. */
export function jobRelevanceScore(job: JobPosting, pq: ParsedQuery, filters: JobSearchFilters): number {
  let score = 0;
  const title = job.title || "";
  const dept = job.department || "";
  const desc = job.description || "";

  if (pq.tokens.length) {
    const titleHits = pq.tokens.filter((t) => hasWord(title, t));
    const deptHits = pq.tokens.filter((t) => hasWord(dept, t));
    const descHits = pq.tokens.filter((t) => hasWord(desc, t));

    // Exact phrase in the title is the strongest signal.
    if (pq.phrase && new RegExp(`\\b${escapeRe(pq.phrase)}\\b`, "i").test(title)) score += 8;
    if (titleHits.length === pq.tokens.length) score += 6;
    else score += Math.min(5, titleHits.length * 2);
    score += Math.min(2, deptHits.length);
    score += Math.min(3, descHits.length);
  }

  // Employment-type alignment.
  const wantType = normalizeEmploymentType(filters.employmentType);
  const jobType = normalizeEmploymentType(job.employment_type) ?? employmentTypeFromTitle(title);
  if (wantType) {
    if (jobType === wantType) score += 3;
    else if (wantType === "internship" && (job.seniority === "intern" || guessSeniority(title) === "intern")) {
      score += 2;
    }
  }

  // Seniority alignment (already hard-filtered; a match ranks higher).
  if (pq.seniority && pq.seniority !== "any") {
    const jobSen = job.seniority || guessSeniority(title);
    if (jobSen === pq.seniority) score += 2;
  } else if (!filters.seniority || filters.seniority === "any") {
    // No level requested: mildly prefer non-intern roles for craft queries.
    const jobSen = job.seniority || guessSeniority(title);
    if (jobSen !== "intern") score += 1;
  }

  // Location alignment: a matching city/region ranks above a mere pass.
  const loc = filters.location?.trim().toLowerCase();
  if (loc && !/worldwide|anywhere|global/.test(loc)) {
    const jloc = (job.location || "").toLowerCase();
    if (jloc && (jloc.includes(loc) || loc.split(/,\s*/).some((part) => jloc.includes(part)))) {
      score += 3;
    } else if (job.remote) {
      score += 1;
    }
  } else if (filters.remoteOnly && job.remote) {
    score += 2;
  }

  // Freshness tiebreaker inside relevance.
  score += recencyRank(job.posted_at) * 0.5;
  return score;
}

/**
 * Rank filtered jobs: relevance DESC → recency DESC → title ASC.
 * Returns the input array sorted in place (new array, stable input).
 */
export function rankJobs(jobs: JobPosting[], filters: JobSearchFilters): JobPosting[] {
  const pq = parseQuery(filters.query);
  return [...jobs].sort((a, b) => {
    const d = jobRelevanceScore(b, pq, filters) - jobRelevanceScore(a, pq, filters);
    if (d !== 0) return d;
    const r = recencyRank(b.posted_at) - recencyRank(a.posted_at);
    if (r !== 0) return r;
    return a.title.localeCompare(b.title);
  });
}
