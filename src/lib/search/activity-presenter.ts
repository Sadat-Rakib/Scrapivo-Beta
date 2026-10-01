/** The public boundary for activity text and source labels. Keep raw telemetry internal. */
import type { StreamedLead } from "@/lib/search/search-browser-progress.server";

const SOURCE_LABELS: Record<string, string> = {
  database: "Available records",
  "s3-parquet": "Available records",
  "pg-index": "Available records",
  "hot-index": "Available records",
  "saved leads": "Available records",
  "live-web": "Public websites",
  "browser-live": "Public websites",
  "direct-http": "Public websites",
  "structured-live": "Public sources",
  "live-osm": "Public business sources",
  "live-jobs": "Public job listings",
  osm: "Public business sources",
  openstreetmap: "Public business sources",
  geoapify: "Public directories",
  foursquare: "Public directories",
  web: "The web",
  searxng: "The web",
  duckduckgo: "The web",
  jobs: "Public job listings",
  browser: "Public websites",
  enrich: "Public contact details",
  verification: "Public evidence",
  linkedin: "LinkedIn",
  github: "GitHub",
  techcrunch: "TechCrunch",
  reddit: "Reddit",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  twitter: "X",
  x: "X",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  hn: "Hacker News",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  freelancer: "Freelancer",
  fiverr: "Fiverr",
  redditrss: "Reddit",
  secedgar: "SEC filing",
  news: "News",
  serpapi: "The web",
  tavily: "The web",
  webboolean: "The web",
};

const ACTION_LABELS: Array<[RegExp, string]> = [
  [/^stored search complete$/i, "Checked available records"],
  [/^searching candidates$/i, "Searching the web"],
  [/^searching the web$/i, "Searching the web"],
  [/^found candidate sources$/i, "Found possible leads"],
  [/^found search results$/i, "Found possible leads"],
  [/^found web candidates$/i, "Found possible leads"],
  [/^live discovery complete$/i, "Checked public sources"],
  [/^read page$/i, "Reading page"],
  [/^clicking result$/i, "Opening result"],
  [/^navigating to result$/i, "Opening result"],
  [/^opened result$/i, "Reading page"],
  [/^extracted candidates$/i, "Found possible leads"],
  [/^checking possible official domain$/i, "Checking company website"],
  [/^resolving official website$/i, "Checking company website"],
  [/^official destination resolved$/i, "Found company website"],
  [/^checking contact page$/i, "Checking contact details"],
  [/^enrichment pass complete$/i, "Checked contact details"],
  [/^leads verified$/i, "Verified leads"],
  [/^candidate verified$/i, "Lead verified"],
  [/^leads qualified$/i, "Verified matches ready"],
  [/^found public contact$/i, "Found public contact"],
];

/**
 * Names of providers, storage systems, and implementation details, plus raw
 * transport errors. Underscores count as separators: an error code such as
 * "SEARXNG_UNREACHABLE" is a single \w word and slipped past \b boundaries.
 */
const INTERNAL_RE =
  /(?<![a-z0-9])(?:openstreetmap|osm|searxng|duckduckgo|geoapify|foursquare|s3|parquet|duckdb|supabase|postgres|pg-index|hot-index|saved leads|provider|adapter|overpass|resilientfetch|json-?ld|registry-identity|browser-live|direct-http|fetch failed|econnrefused|enotfound|etimedout|unreachable)(?![a-z0-9])/i;

function publicHostname(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname.replace(/^www\./i, "");
    return host.includes(".") && !INTERNAL_RE.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hosts that are infrastructure, never a lead's public page: loopback,
 * private ranges, internal suffixes, and the storage/database platforms the
 * app itself uses. A lead whose name merely contains a word like "provider"
 * is not infrastructure.
 */
const INFRA_HOST_RE =
  /^(?:localhost|0\.0\.0\.0|127\.\d|10\.\d|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)|\.(?:local|internal|localhost|lan)$|(?:^|\.)(?:supabase\.co|supabase\.in|amazonaws\.com)$/i;

function safePublicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !INFRA_HOST_RE.test(url.hostname) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Lead text is data, not telemetry: keep it, only strip control characters and cap it. */
function leadText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * System-generated evidence text that names our own pipeline ("Verified via
 * SearXNG") is dropped. Only unambiguous infrastructure tokens count here,
 * never ordinary words a lead's own text uses ("a home care provider").
 */
const PIPELINE_TEXT_RE =
  /(?<![a-z0-9])(?:searxng|openstreetmap|overpass|geoapify|duckdb|parquet|s3-parquet|pg-index|hot-index|saved leads|resilientfetch|registry-identity|browser-live|direct-http|json-?ld)(?![a-z0-9])/i;

function evidenceText(value: string | null | undefined, max: number): string | null {
  const text = leadText(value, max);
  return text && !PIPELINE_TEXT_RE.test(text) ? text : null;
}

/** Use this for every user-visible source or platform label. */
export function publicSourceLabel(source: string | null | undefined, url?: string | null): string {
  const key = source?.trim().toLowerCase() ?? "";
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return publicHostname(url) ?? publicHostname(source) ?? "Public source";
}

function safeNarrative(value: string | null | undefined): string | undefined {
  return value && !INTERNAL_RE.test(value) ? value : undefined;
}

export type PublicActivityEvent = {
  action: string;
  source?: string;
  detail?: string;
  count?: number | string;
  row?: StreamedLead;
};

/** Preserve the allowlisted progressive row without passing through raw event fields. */
export function presentActivityEvent(event: {
  action: string;
  source?: string;
  detail?: string;
  count?: number | string;
  row?: StreamedLead;
}): PublicActivityEvent {
  const mapped = ACTION_LABELS.find(([re]) => re.test(event.action ?? ""));
  const action = mapped?.[1] ?? safeNarrative(event.action) ?? "Working";
  const row = event.row && {
    key: event.row.key,
    entity_id: event.row.entity_id,
    kind: event.row.kind,
    // Lead names and evidence text are shown as observed ("Care Provider Ltd"
    // is a lead, not infrastructure); only system text below is scrubbed.
    title: leadText(event.row.title, 200) ?? "Verified result",
    url: safePublicUrl(event.row.url),
    website_url: safePublicUrl(event.row.website_url),
    profile_url: safePublicUrl(event.row.profile_url),
    email: event.row.email,
    phone: event.row.phone,
    location: leadText(event.row.location, 200),
    why_match: evidenceText(event.row.why_match, 600),
  };
  return {
    action,
    source: event.source ? publicSourceLabel(event.source) : undefined,
    detail: safeNarrative(event.detail),
    count: event.count,
    row,
  };
}
