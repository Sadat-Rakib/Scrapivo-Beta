import type { JobPosting, JobRegion, JobSearchFilters } from "./types";
import { hasWord, normalizeEmploymentType, parseQuery } from "./relevance";

const QUERY_SYNONYMS: Record<string, string[]> = {
  developer: [
    "developer",
    "engineer",
    "software engineer",
    "programmer",
    "swe",
    "software developer",
  ],
  engineer: ["engineer", "developer"],
  designer: ["designer", "product designer", "ux designer", "ui designer", "ux/ui designer"],
  design: ["designer", "product designer", "ux designer", "ui designer"],
  marketing: ["marketing", "marketer", "growth"],
  sales: ["sales", "account executive", "business development"],
  analyst: ["analyst", "analytics"],
  nurse: ["nurse", "nursing", "rn"],
  accountant: ["accountant", "accounting", "bookkeeper"],
  welder: ["welder", "welding"],
  teacher: ["teacher", "tutor", "instructor"],
};

const LOCATION_ALIASES: Record<string, string[]> = {
  nyc: ["new york", "nyc", "manhattan", "brooklyn"],
  "new york": ["new york", "nyc", "ny"],
  "new york city": ["new york", "nyc"],
  sf: ["san francisco", "sf", "bay area"],
  "san francisco": ["san francisco", "sf", "bay area"],
  usa: ["united states", "usa", "us", "america"],
  us: ["united states", "usa", "us"],
  uk: ["united kingdom", "uk", "britain", "england", "london"],
};

const REGION_TOKENS: Record<Exclude<JobRegion, "any" | "remote">, string[]> = {
  north_america: [
    "united states",
    "usa",
    "us",
    "canada",
    "mexico",
    "north america",
    "new york",
    "san francisco",
    "austin",
    "seattle",
    "toronto",
    "remote-us",
    "us-remote",
  ],
  europe: [
    "europe",
    "eu",
    "uk",
    "united kingdom",
    "germany",
    "france",
    "netherlands",
    "spain",
    "italy",
    "ireland",
    "sweden",
    "poland",
    "portugal",
    "berlin",
    "london",
    "amsterdam",
    "paris",
    "dublin",
    "remote-eu",
    "emea",
  ],
  asia: [
    "asia",
    "apac",
    "singapore",
    "india",
    "bangladesh",
    "japan",
    "indonesia",
    "philippines",
    "vietnam",
    "thailand",
    "malaysia",
    "pakistan",
    "nepal",
    "dhaka",
    "bangalore",
    "bengaluru",
    "tokyo",
    "remote-apac",
  ],
  middle_east: [
    "middle east",
    "mena",
    "uae",
    "dubai",
    "abu dhabi",
    "saudi",
    "qatar",
    "bahrain",
    "kuwait",
    "israel",
    "tel aviv",
    "remote-mena",
  ],
};

const REMOTE_BOARDS = new Set([
  "source-remoteok",
  "source-remotive",
  "source-jobicy",
  "source-weworkremotely",
  "source-workingnomads",
  "source-himalayas",
  "source-4dayweek",
  "source-nodesk",
]);

export function looksRemote(loc: string, title: string, description?: string | null): boolean {
  return /remote|anywhere|distributed|work from home|wfh|worldwide/i.test(
    `${loc} ${title} ${description || ""}`,
  );
}

export function guessSeniority(title: string): string | null {
  const t = title.toLowerCase();
  if (/\bintern\b/.test(t)) return "intern";
  if (/\bjunior\b|\bjr\b|entry/.test(t)) return "junior";
  if (/\bsenior\b|\bsr\b|\bstaff\b|\bprincipal\b/.test(t)) return "senior";
  if (/\blead\b|\bmanager\b|\bdirector\b|\bhead\b|\bvp\b/.test(t)) return "lead";
  return "mid";
}

function queryNeedles(q: string): string[] {
  // Word-level expansion only: a token must EQUAL a synonym key to expand.
  // The old substring trigger turned "designer" into the bare needle "design",
  // which substring-matched "Design Systems Intern" style titles.
  const pq = parseQuery(q);
  const out = new Set<string>();
  for (const t of pq.tokens) {
    out.add(t);
    for (const s of QUERY_SYNONYMS[t] ?? []) {
      // Multi-word synonyms are matched via their own word-boundary regexes.
      out.add(s);
    }
  }
  if (out.size === 0 && q.trim()) out.add(q.trim().toLowerCase());
  return [...out];
}

/** Word-boundary needle test; multi-word needles match as a phrase. */
function needleHit(haystack: string, needle: string): boolean {
  if (needle.includes(" ")) {
    return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
  }
  return hasWord(haystack, needle);
}

function locationNeedles(loc: string): string[] {
  const extra = LOCATION_ALIASES[loc] || [];
  return [loc, ...extra];
}

function matchesRegion(job: JobPosting, region: JobRegion): boolean {
  if (region === "any") return true;
  if (region === "remote")
    return job.remote || looksRemote(job.location || "", job.title, job.description);
  const tokens = REGION_TOKENS[region];
  const blob = `${job.location || ""} ${job.title} ${job.description || ""}`.toLowerCase();
  if (tokens.some((t) => blob.includes(t))) return true;
  if (job.remote && region === "north_america")
    return /us|usa|canada|america/i.test(blob) || !job.location;
  return false;
}

export function matchesJobFilters(job: JobPosting, filters: JobSearchFilters): boolean {
  // ── Query gate: title or department must contain a role token/needle ──
  // Word-boundary matching only; the description never passes the gate on its
  // own (it contributes to the relevance score instead).
  const q = filters.query?.trim().toLowerCase();
  if (q) {
    const needles = queryNeedles(q);
    const titleBlob = `${job.title} ${job.department || ""}`;
    const titleMatch = needles.some((n) => needleHit(titleBlob, n));
    if (!titleMatch) return false;
  }

  // ── Compute job-level "is remote" flag once ──
  const jobIsRemote =
    job.remote ||
    looksRemote(job.location || "", job.title, job.description) ||
    REMOTE_BOARDS.has(job.source);

  // ── Location + Remote combined logic (PRD §9) ──
  // Location alone → jobs based in/around that location (any work-mode).
  // Remote alone  → fully remote jobs, any region.
  // Location + Remote together → remote jobs scoped to that region
  //   (e.g. "Remote" + "Asia" = remote roles open to candidates in Asia).
  // "Worldwide" + Remote → remote jobs with no regional restriction.
  const loc = filters.location?.trim().toLowerCase();
  const wantRemote = Boolean(filters.remoteOnly);
  const hasRegion = filters.region && filters.region !== "any";
  const regionIsRemote = filters.region === "remote";

  if (wantRemote && loc) {
    // Combined: must be remote AND match the location
    if (!jobIsRemote) return false;
    // If location is "worldwide" / "anywhere", skip location matching
    if (!/worldwide|anywhere|global/i.test(loc)) {
      const jloc = (job.location || "").toLowerCase();
      const needles = locationNeedles(loc);
      const locHit = needles.some(
        (n) => jloc.includes(n) || (loc.includes(n) && jloc.includes(n.split(" ")[0])),
      );
      // For remote jobs, also accept if location field is empty (global remote)
      if (!locHit && !jloc.includes(loc) && jloc.length > 0) return false;
    }
  } else if (wantRemote) {
    // Remote only, no location constraint
    if (!jobIsRemote) return false;
  } else if (loc) {
    // Location only (any work-mode)
    const jloc = (job.location || "").toLowerCase();
    const needles = locationNeedles(loc);
    const locHit = needles.some(
      (n) => jloc.includes(n) || (loc.includes(n) && jloc.includes(n.split(" ")[0])),
    );
    const remoteLoc = jobIsRemote && /remote|anywhere|worldwide/i.test(loc);
    if (!locHit && !remoteLoc && !jloc.includes(loc)) return false;
  }

  // ── Region filter ──
  // When remoteOnly + region (not "remote"), treat as: remote jobs scoped to region
  if (hasRegion && !regionIsRemote) {
    if (wantRemote) {
      // Must be remote AND match the region
      if (!jobIsRemote) return false;
      if (!matchesRegion(job, filters.region!)) return false;
    } else {
      if (!matchesRegion(job, filters.region!)) return false;
    }
  } else if (regionIsRemote) {
    if (!jobIsRemote) return false;
  }

  // ── Seniority filter ──
  const sen = filters.seniority?.trim().toLowerCase();
  if (sen && sen !== "any") {
    const jobSen = (job.seniority || guessSeniority(job.title) || "mid").toLowerCase();
    if (sen === "mid") {
      if (jobSen === "intern" || jobSen === "junior") return false;
    } else if (sen === "junior") {
      if (jobSen !== "junior" && jobSen !== "intern") return false;
    } else if (jobSen !== sen) {
      return false;
    }
  }

  // ── Employment-type filter (full-time / contract / part-time / internship) ──
  const wantType = normalizeEmploymentType(filters.employmentType);
  if (wantType) {
    const titleLower = job.title.toLowerCase();
    const jobType =
      normalizeEmploymentType(job.employment_type) ??
      (/\bintern(ship)?\b/.test(titleLower)
        ? "internship"
        : /\bcontract(or)?\b|\bfreelance\b|\bc2c\b|\b1099\b/.test(titleLower)
          ? "contract"
          : /\bpart[- ]time\b/.test(titleLower)
            ? "part-time"
            : /\bfull[- ]time\b|\bpermanent\b/.test(titleLower)
              ? "full-time"
              : null);
    // Only enforce when the job states a type somewhere; silent jobs stay in
    // (ATS boards rarely label commitment consistently).
    if (jobType && jobType !== wantType) {
      // "internship" also accepts jobs the seniority guess calls intern.
      if (!(wantType === "internship" && jobSen === "intern" && !job.employment_type)) {
        return false;
      }
    }
  }
  return true;
}
