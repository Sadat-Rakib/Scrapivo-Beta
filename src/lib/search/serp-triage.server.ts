/**
 * SERP candidate triage — Workstream G: score organic results BEFORE spending
 * a navigation on them.
 *
 * The old loop visited early results blindly and wandered. A result now has
 * to earn its page: query-term overlap, entity fit, first-party signal,
 * contamination filters and expected evidence value decide, and duplicates of
 * an already-open domain rank below fresh sources.
 *
 * Pure module: no I/O, no LLM — deterministic and testable.
 */

export type TriageCandidate = {
  url: string;
  title: string;
  snippet?: string | null;
};

export type TriageContext = {
  /** Query the results came from. */
  query: string;
  /** Entity title / company / person names the run is researching. */
  entityNames?: string[];
  /** Requested geography terms (city/region/country strings). */
  locationTerms?: string[];
  /** Requested signal/topic terms (service, complaint topic, role…). */
  signalTerms?: string[];
};

export type TriageVerdict = {
  score: number;
  /** true = worth a navigation; false = skip before opening. */
  accept: boolean;
  reason: string;
};

/** Domains that are navigation sinks: engine copies, aggregator shells. */
const CONTAMINATION_HOSTS = [
  "duckduckgo.com", "google.com", "bing.com", "search.marcia.com",
  "facebook.com", "x.com", "twitter.com", "instagram.com", "tiktok.com",
  "pinterest.com", "reddit.com", "quora.com", "youtube.com", "linkedin.com",
  "amazon.com", "wikipedia.org", "yelp.com", "tripadvisor.com",
];

const DIRECTORY_HINTS = /\b(directory|list of|top \d+|best \d+|ranked|reviews? of|yellow ?pages|find \w+ in)\b/i;

const words = (s: string): string[] =>
  (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/**
 * Rank results best-first. Higher score = more likely to carry independent
 * evidence for the request. Invalid/duplicate/contaminated entries sink.
 */
export function triageSerpResults(
  candidates: TriageCandidate[],
  context: TriageContext,
  opts?: { openedHosts?: ReadonlySet<string>; limit?: number },
): Array<TriageCandidate & TriageVerdict> {
  const queryTerms = new Set(words(context.query));
  for (const name of context.entityNames ?? []) for (const w of words(name)) queryTerms.add(w);
  const locationTerms = words((context.locationTerms ?? []).join(" "));
  const signalTerms = words((context.signalTerms ?? []).join(" "));
  const seenHosts = new Set<string>();
  const opened = opts?.openedHosts;

  const scored = candidates.map((candidate) => {
    const host = hostOf(candidate.url);
    if (!/^https?:\/\//.test(candidate.url) || candidate.url.length > 2_000) {
      return { candidate, host, score: -100, reason: "not a navigable http result" };
    }
    const haystack = `${candidate.title} ${candidate.snippet ?? ""}`.toLowerCase();
    const overlap = [...queryTerms].filter((t) => haystack.includes(t)).length;
    const locationHits = locationTerms.filter((t) => haystack.includes(t)).length;
    const signalHits = signalTerms.filter((t) => haystack.includes(t)).length;

    let score = 0;
    let reason = "relevant result";
    // Query/entity overlap is the spine.
    score += Math.min(6, overlap) * 2;
    // First-party domain matching an entity name strongly outranks directories.
    const entityCompact = (context.entityNames ?? []).map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "")).filter(Boolean);
    if (entityCompact.some((n) => host.replace(/[^a-z0-9]+/g, "").includes(n) && n.length >= 5)) {
      score += 6;
      reason = "likely first-party source";
    }
    // Evidence value: geography + requested signal in the snippet.
    score += locationHits * 2;
    score += signalHits * 3;
    if (DIRECTORY_HINTS.test(candidate.title) && signalTerms.length > 0) {
      // Directories rarely carry the SIGNAL itself; downrank for signal runs.
      score -= 4;
      reason = "directory result for a signal request";
    }
    if (CONTAMINATION_HOSTS.some((c) => host === c || host.endsWith(`.${c}`))) {
      score -= 50;
      reason = "search/social contamination";
    }
    if (opened?.has(host)) {
      score -= 8;
      reason = "domain already opened this run";
    }
    if (seenHosts.has(host)) {
      score -= 20;
      reason = "duplicate domain";
    }
    seenHosts.add(host);
    return { candidate, host, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);
  const limit = opts?.limit ?? candidates.length;
  return scored.slice(0, limit).map(({ candidate, score, reason }) => ({
    ...candidate,
    score,
    accept: score > 0,
    reason,
  }));
}
