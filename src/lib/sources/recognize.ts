/**
 * URL/source recognition (beta pass §7). Given any discovered URL, classify it
 * so the planner can route to a structured adapter instead of browsing the
 * human website. Pure functions — no network.
 */
import { SOURCE_REGISTRY } from "./registry";

export type RecognizedKind =
  | "ats" // known ATS board/job link → use the structured adapter
  | "feed" // known public feed/API
  | "needs_review" // recognized family but owner decision pending (Workday)
  | "blocked" // known never-contact host
  | "career_page" // plausible employer careers page
  | "official_site"
  | "directory"
  | "profile"
  | "community"
  | "news"
  | "search"
  | "unknown";

export interface RecognizedUrl {
  kind: RecognizedKind;
  host: string;
  /** ATS family adapter id, e.g. "greenhouse". */
  ats?: string;
  board?: string;
  jobId?: string;
  region?: string;
  /** Registry definition backing this recognition, when known. */
  sourceId?: string;
}

interface AtsPattern {
  ats: string;
  sourceId: string;
  review?: boolean;
  pattern: RegExp;
  groups: { board: number; jobId?: number; region?: number };
}

// Ordered: most specific host shapes first. All patterns are case-insensitive.
const ATS_PATTERNS: AtsPattern[] = [
  { ats: "greenhouse", sourceId: "ats-greenhouse", pattern: /job-boards\.greenhouse\.io\/([A-Za-z0-9_-]+)(?:\/jobs\/([A-Za-z0-9]+))?/i, groups: { board: 1, jobId: 2 } },
  { ats: "greenhouse", sourceId: "ats-greenhouse", pattern: /job-boards\.eu\.greenhouse\.io\/([A-Za-z0-9_-]+)(?:\/jobs\/([A-Za-z0-9]+))?/i, groups: { board: 1, jobId: 2, region: 3 } },
  { ats: "greenhouse", sourceId: "ats-greenhouse", pattern: /boards\.greenhouse\.io\/([A-Za-z0-9_-]+)/i, groups: { board: 1 } },
  { ats: "lever", sourceId: "ats-lever", pattern: /jobs\.eu\.lever\.co\/([A-Za-z0-9_-]+)/i, groups: { board: 1, region: 2 } },
  { ats: "lever", sourceId: "ats-lever", pattern: /jobs\.lever\.co\/([A-Za-z0-9_-]+)/i, groups: { board: 1 } },
  { ats: "ashby", sourceId: "ats-ashby", pattern: /jobs\.ashbyhq\.com\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9-]+))?/i, groups: { board: 1, jobId: 2 } },
  { ats: "workable", sourceId: "ats-workable", pattern: /apply\.workable\.com\/([A-Za-z0-9_-]+)/i, groups: { board: 1 } },
  { ats: "recruitee", sourceId: "ats-recruitee", pattern: /([A-Za-z0-9-]+)\.recruitee\.com/i, groups: { board: 1 } },
  { ats: "personio", sourceId: "ats-personio", pattern: /([A-Za-z0-9-]+)\.jobs\.personio\.(de|com)/i, groups: { board: 1, region: 2 } },
  { ats: "teamtailor", sourceId: "ats-teamtailor", pattern: /([A-Za-z0-9-]+)\.na\.teamtailor\.com/i, groups: { board: 1, region: 2 } },
  { ats: "teamtailor", sourceId: "ats-teamtailor", pattern: /([A-Za-z0-9-]+)\.teamtailor\.com/i, groups: { board: 1 } },
  { ats: "gem", sourceId: "ats-gem", pattern: /api\.gem\.com\/job_board\/v0\/([A-Za-z0-9_-]+)/i, groups: { board: 1 } },
  { ats: "smartrecruiters", sourceId: "ats-smartrecruiters", pattern: /([A-Za-z0-9-]+)\.smartrecruiters\.com/i, groups: { board: 1 } },
  { ats: "workday", sourceId: "ats-workday", review: true, pattern: /([A-Za-z0-9-]+)\.(wd\d+)\.(?:myworkdayjobs|workdayjobs)\.com(?:\/([A-Za-z0-9_-]+))?/i, groups: { board: 1, region: 2, jobId: 3 } },
];

const BLOCKED_HOSTS = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)indeed\.com$/i,
  /(^|\.)glassdoor\.(com|ca|co\.uk)$/i,
  /(^|\.)bamboohr\.com$/i,
  /(^|\.)breezy\.hr$/i,
  /(^|\.)jazzhr\.com$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)taleo\.net$/i,
  /(^|\.)ukg\.(com|net)$/i,
  /(^|\.)jobvite\.com$/i,
  /(^|\.)rippling\.com$/i,
];

const COMMUNITY_HOSTS = [
  /(^|\.)reddit\.com$/i,
  /news\.ycombinator\.com$/i,
  /(^|\.)stackexchange\.com$/i,
  /(^|\.)stackoverflow\.com$/i,
  /(^|\.)dev\.to$/i,
  /(^|\.)mastodon\./i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)producthunt\.com$/i,
  /(^|\.)g2\.com$/i,
];

const NEWS_HINTS = /\/(news|press|blog|announcements?)(\/|$)/i;
const CAREER_HINTS = /\/(careers?|jobs?|join(-?us)?|work-with-us|hiring)(\/|$)/i;
const TEAM_HINTS = /\/(about|team|people|leadership|company|contact)(\/|$)/i;
const PROFILE_HINTS = /\/(in|company|@|profile|people|members?)(\/|$)/i;
const DIRECTORY_HINTS = /(director(y|ies)|list|index|category|browse|companies|startups|investors|portfolio)/i;

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Classify a URL. ATS recognition extracts provider + board (+ job id where
 * the link carries one) so callers can go straight to the structured feed.
 */
export function recognizeUrl(raw: string): RecognizedUrl {
  const u = safeUrl(raw);
  if (!u) return { kind: "unknown", host: "" };
  const host = u.host.toLowerCase();

  if (BLOCKED_HOSTS.some((re) => re.test(host))) {
    return { kind: "blocked", host };
  }

  for (const p of ATS_PATTERNS) {
    const m = u.href.match(p.pattern) ?? `${host}${u.pathname}`.match(p.pattern);
    if (!m) continue;
    return {
      kind: p.review ? "needs_review" : "ats",
      host,
      ats: p.ats,
      board: m[p.groups.board]?.toLowerCase(),
      jobId: p.groups.jobId ? m[p.groups.jobId] : undefined,
      region: p.groups.region ? m[p.groups.region] : undefined,
      sourceId: p.sourceId,
    };
  }

  const path = `${u.pathname}/`;
  if (COMMUNITY_HOSTS.some((re) => re.test(host))) return { kind: "community", host };
  if (/google\.[a-z.]+$/.test(host) || /bing\.com$/i.test(host) || /duckduckgo\.com$/i.test(host) || /searx/i.test(host)) {
    return { kind: "search", host };
  }
  if (NEWS_HINTS.test(path)) return { kind: "news", host };
  if (CAREER_HINTS.test(path)) return { kind: "career_page", host };
  if (PROFILE_HINTS.test(path)) return { kind: "profile", host };
  if (TEAM_HINTS.test(path)) return { kind: "official_site", host };
  if (DIRECTORY_HINTS.test(path)) return { kind: "directory", host };
  return { kind: "unknown", host };
}

/**
 * Known ATS board? Returns the registry definition so callers can attach the
 * structured adapter without browsing.
 */
export function atsDefinitionFor(ats: string) {
  return SOURCE_REGISTRY.find((s) => s.adapter === ats && s.id.startsWith("ats-"));
}

/**
 * Job URLs are identity keys even when tracking params differ. Canonicalize
 * for dedupe: strip known tracking params + fragments, lowercase host.
 */
const TRACKING_PARAMS = /^(utm_|gclid|fbclid|ref|source|gh_src|trk)/i;

export function canonicalJobUrl(raw: string): string {
  const u = safeUrl(raw);
  if (!u) return raw.trim();
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  return `${u.host.toLowerCase()}${u.pathname}${u.search}`;
}
