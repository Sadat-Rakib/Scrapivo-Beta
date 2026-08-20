import { detectDemandBuckets, scoreUrgency, buildIntentWhy } from "./search/intent-lexicon";

export type Lead = {
  source: string;
  platform: string;
  platform_label?: string; // friendly badge label, e.g. "Reddit r/forhire [Hiring]"
  title: string;
  snippet: string;
  ai_summary?: string; // 1-sentence summary of what the buyer needs
  full_post_url: string;
  author?: string;
  author_url?: string;
  posted_at?: string; // ISO
  posted_at_relative?: string; // "2h ago"
  /**
   * Set when a lead has no exact timestamp but was retrieved under a search
   * engine time filter ("day" / "week"), so it is known-recent without a known
   * date. Undated is not the same as stale.
   */
  freshness_window?: string;
  /**
   * Set by sources whose query itself encodes the ask (a `"looking for a
   * <craft>"` site: dork) AND that additionally cleared the demand classifier.
   * Such a lead is a qualified buyer post even with no timestamp, so the
   * clients-path undated drop must not discard it. Search engines return
   * nothing for a site: dork combined with a time filter, so undated is the
   * only form these leads come in.
   */
  demand_verified?: boolean;
  /** Image attached to the post, when the post is a picture rather than text. */
  image_url?: string;
  /** Text transcribed out of image_url by the vision model, when it had any. */
  vision_text?: string;
  engagement?: number;
  is_decision_maker?: boolean;
  has_budget?: boolean;
  has_urgency?: boolean;
  source_confidence?: number; // 0–100 trust of the source platform
  // computed
  tier?: "hot" | "warm";
  intent_tier?: "hot" | "warm"; // alias for clarity
  score?: number;
  intent_score?: number; // alias for clarity
  match_reasons?: string[];
  why_match?: string;
  // ── AI-classifier output (optional) ────────────────────────────────
  ai_intent?: "hiring" | "buying" | "researching" | "seeker" | "profile" | "noise";
  ai_confidence?: number; // 0..1 from LLM classifier
  ai_evidence?: string; // short quoted phrase
  ai_role_in_post?: "buyer" | "seeker" | "observer" | "unknown";
  // ── Signal type (Tasks 2.3 / 2.4) ──────────────────────────────────
  // "direct_intent"     = someone is actively asking/hiring RIGHT NOW (eligible for hot).
  // "leading_indicator" = a company that will likely be in-market SOON (Form D
  //   filing, funding/expansion news) — structurally hard-capped to warm so the
  //   product never mislabels "about to need you" as "actively waiting for you".
  signal_type?: "direct_intent" | "leading_indicator";
  // ── Cross-source merge attribution (Task 1.1) ──────────────────────
  // When the same underlying job/post is found on multiple platforms, the
  // duplicates are collapsed into the highest-intent lead and their source
  // attribution is preserved here so the UI can surface "also seen on X".
  also_seen_on?: Array<{ platform: string; url: string }>;
  // ── Legitimacy (scam gate) ─────────────────────────────────────────
  verification_level?: "verified" | "checked" | "unverified" | "scam";
  legitimacy_flags?: string[];
  legitimacy_proofs?: string[];
  /**
   * Contact details published INSIDE the post body ("email me at x@y.com",
   * a Discord invite, a website). Highest-trust contact we can have: the
   * person deliberately published it in the very post asking for help, so no
   * inference or third-party provider is involved.
   */
  inline_contacts?: {
    emails: string[];
    phones: string[];
    links: string[];
  };
};

const HOT = [
  "hiring",
  "looking to hire",
  "looking for a freelancer",
  "looking for a developer",
  "looking for a contractor",
  "looking for someone to",
  "need a",
  "need an",
  "need someone to",
  "anyone know a",
  "any recommendations",
  "recommend a",
  "who do you use",
  "budget",
  "freelancer needed",
  "rfp",
  "scope of work",
  "deliverables",
  "willing to pay",
];
const WARM = [
  "frustrated",
  "struggling",
  "can't figure out",
  "any tools",
  "alternative to",
  "vs ",
  "competitor",
  "tired of",
  "switching from",
  "migrating from",
  "stack",
];
const DM_TITLES = ["ceo", "cto", "founder", "co-founder", "head of", "vp", "director", "owner"];

export function hasBuyerSignal(text: string): { signal: boolean; tier: "hot" | "warm" } {
  const t = text.toLowerCase();
  // Seller rhetorical CTAs must never get HOT +60
  if (
    /\bfor your (business|company|startup)\b/i.test(text) ||
    /\bdm me your (requirements|project|brief|details)\b/i.test(text) ||
    /\bcommission[- ]based partner\b/i.test(text) ||
    /\bpartner to find .{0,30}(clients|customers)\b/i.test(text)
  ) {
    return { signal: false, tier: "warm" };
  }
  const urgency = scoreUrgency(t);
  const demand = detectDemandBuckets(t);
  if (urgency.hasUrgency && (demand.primary === "hiring" || demand.primary === "explicit_demand")) {
    return { signal: true, tier: "hot" };
  }
  for (const kw of HOT) if (t.includes(kw)) return { signal: true, tier: "hot" };
  if (demand.buckets.length > 0) return { signal: true, tier: urgency.hasUrgency ? "hot" : "warm" };
  for (const kw of WARM) if (t.includes(kw)) return { signal: true, tier: "warm" };
  return { signal: false, tier: "warm" };
}

export function detectDecisionMaker(author?: string, bio?: string): boolean {
  const text = `${author ?? ""} ${bio ?? ""}`.toLowerCase();
  return DM_TITLES.some((t) => text.includes(t));
}

export function scoreLead(l: Lead): number {
  const text = `${l.title} ${l.snippet}`;
  const { tier } = hasBuyerSignal(text);
  const urgency = scoreUrgency(text);
  let s = 0;
  if (tier === "hot") s += 60;
  else if (tier === "warm") s += 30;
  // Urgency boost — ASAP / urgently ranks above soft matches
  s += Math.round((urgency.score / 100) * 25);
  if (l.has_urgency) s += 8;
  s += Math.min(20, Math.log2((l.engagement ?? 0) + 1) * 4);
  if (l.is_decision_maker) s += 15;
  s += recencyPoints(l);
  return Math.round(s);
}

/**
 * How much being FRESH is worth.
 *
 * This used to be `+10 under a day, +5 under a week`, which had two problems.
 * The spread between a 2-minute-old ask and a 6-day-old job posting was five
 * points, against factors worth up to 25 (urgency), 20 (engagement) and 15
 * (decision-maker) — so a well-scored stale job comfortably outranked a fresh
 * one, which is exactly the "relevant but from days/weeks ago" complaint. And
 * everything inside 24h scored identically, so minutes-old could not beat
 * hours-old even in principle.
 *
 * The curve below is steep and continuous across the first day, and the total
 * spread (30) is now the largest single factor in the score, which is the
 * intended statement: for buyer intent, WHEN beats almost everything else. An
 * ask answered a day late has usually already been answered by someone else.
 */
const RECENCY_TIERS: ReadonlyArray<readonly [maxHours: number, points: number]> = [
  [1, 30],
  [3, 27],
  [6, 24],
  [12, 20],
  [24, 16],
  [48, 9],
  [72, 5],
  [168, 2],
];

/**
 * Age multiplier used for ORDERING ONLY — never for qualification.
 *
 * The split matters. Recency points inside scoreLead raise a fresh lead's
 * score, but they cannot guarantee it outranks a stale one, because a company
 * posting also collects decision-maker (+15) and engagement (+20) bonuses that
 * an anonymous forum ask never will. Measured: a 5-day-old "Hiring Senior
 * Product Designer" scored 97 against 87 for a 1-hour-old "need a designer,
 * can pay $500" — the stale role won, which is precisely the complaint.
 *
 * Folding the decay into scoreLead instead would have pushed stale-but-valid
 * company openings under the minScore floors and emptied the Companies tab —
 * the same mistake as tightening the ATS window. So membership is decided by
 * the real score, and only the running order is decayed.
 */
const FRESHNESS_DECAY: ReadonlyArray<readonly [maxHours: number, factor: number]> = [
  [1, 1.0],
  [3, 0.98],
  [6, 0.95],
  [12, 0.92],
  [24, 0.88],
  [48, 0.65],
  [72, 0.55],
  [168, 0.42],
];

/** Score adjusted for age, for sorting. Higher is better, same as score. */
export function rankValue(l: Lead): number {
  const score = l.score ?? 0;
  if (l.posted_at) {
    const hours = (Date.now() - new Date(l.posted_at).getTime()) / 3_600_000;
    if (!Number.isNaN(hours) && hours >= 0) {
      for (const [maxHours, factor] of FRESHNESS_DECAY) if (hours < maxHours) return score * factor;
      return score * 0.32;
    }
  }
  // Known-recent but undated ranks like a same-day lead, not a stale one.
  if (l.freshness_window || l.demand_verified) return score * 0.85;
  return score * 0.6;
}

function recencyPoints(l: Lead): number {
  if (l.posted_at) {
    const hours = (Date.now() - new Date(l.posted_at).getTime()) / 3_600_000;
    if (!Number.isNaN(hours) && hours >= 0) {
      for (const [maxHours, points] of RECENCY_TIERS) if (hours < maxHours) return points;
      return 0;
    }
  }
  // Undated is not the same as stale: a SERP row retrieved under a time filter,
  // or a dork whose query encodes the ask, is known-recent without a timestamp.
  // Worth less than a dated fresh lead, more than a dated old one.
  if (l.freshness_window || l.demand_verified) return 12;
  return 0;
}

/** Attach primary why_match + match_reasons from intent lexicon when missing. */
export function enrichLeadWhy(lead: Lead, skillHit?: string): Lead {
  if (lead.why_match && lead.match_reasons?.length) return lead;
  const text = `${lead.title} ${lead.snippet}`;
  const built = buildIntentWhy(text, {
    skillHit,
    source: lead.platform_label || lead.platform,
    remote: /\b(remote|wfh|work from home)\b/i.test(text),
  });
  return {
    ...lead,
    has_urgency: lead.has_urgency || built.urgency.hasUrgency,
    why_match: lead.why_match || built.why_match,
    match_reasons: lead.match_reasons?.length ? lead.match_reasons : built.match_reasons,
  };
}

/** Remove exact URL duplicates, keeping first occurrence (highest upstream score). */
export function dedupeByUrl(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  const out: Lead[] = [];
  for (const l of leads) {
    if (!l.full_post_url || seen.has(l.full_post_url)) continue;
    seen.add(l.full_post_url);
    out.push(l);
  }
  return out;
}

// =====================================================================
// Cross-source fuzzy deduplication (Task 1.1)
//
// Exact-URL dedup misses the same underlying job posted to a Greenhouse
// board AND mentioned in a LinkedIn post — they surface as two separate
// "hot leads." This pass normalizes company + role, compares with a
// token-sort similarity within a rough posting-date window, and collapses
// matches above a tuned threshold into ONE lead: the higher-intent-score
// version wins, and the loser's platform/url is preserved on `also_seen_on`
// so the "also seen on LinkedIn" signal isn't lost.
//
// NOTE: this is a deliberately lightweight threshold-fuzzy approach. If lead
// volume grows enough that pairwise O(n^2) comparison or the fixed threshold
// starts producing bad merges, upgrade to a proper probabilistic model
// (Splink-style blocking + EM-trained match weights). Explicitly out of
// scope for now per the build spec.
// =====================================================================

const LEGAL_SUFFIXES = [
  "inc",
  "incorporated",
  "llc",
  "l.l.c",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "sa",
  "srl",
  "bv",
  "plc",
  "pty",
  "pvt",
  "llp",
  "lp",
  "ag",
  "oy",
  "ab",
  "as",
];

// Prefixes our fetchers prepend to titles; stripped before role comparison.
const TITLE_PREFIXES = /^(?:\[hiring\]|job:|bounty\/hiring:|remote job:|bounty:|hiring:)\s*/i;

const ROLE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "to",
  "of",
  "and",
  "or",
  "at",
  "in",
  "on",
  "with",
  "senior",
  "sr",
  "junior",
  "jr",
  "staff",
  "lead",
  "principal",
  "mid",
  "remote",
  "hybrid",
  "onsite",
  "contract",
  "fulltime",
  "full-time",
  "part-time",
  "position",
  "role",
  "opening",
  "opportunity",
  "hiring",
  "wanted",
  "needed",
  "freelance",
  "freelancer",
]);

function normalizeCompany(raw: string): string {
  let s = (raw || "").toLowerCase();
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ");
  const tokens = s.split(/\s+/).filter((t) => t && !LEGAL_SUFFIXES.includes(t));
  return tokens.join(" ").trim();
}

// Company signatures show up in different structural positions per platform:
// "Role @ Company" (RemoteOK/Remotive/LinkedIn Jobs), "Role - Company"
// (LinkedIn posts), "Company: X" (RemoteOK snippet), or the author field.
// Return ALL plausible candidates so we can find one shared across sources.
export function companyCandidates(lead: Lead): string[] {
  const out: string[] = [];
  const push = (s?: string) => {
    const n = normalizeCompany(s || "");
    if (n) out.push(n);
  };
  const title = lead.title || "";
  // "@ Company" tail
  push(title.match(/@\s*([^|•]+?)\s*$/)?.[1]);
  // " - Company" / " – " / " — " tail (last segment only)
  const dash = title.split(/\s[-–—]\s/);
  if (dash.length > 1) push(dash[dash.length - 1]);
  // "Company: X" line in snippet
  push((lead.snippet || "").match(/company:\s*([^\n]+)/i)?.[1]);
  // author, when it looks like a company (not a @handle / u/ reddit user / "X Client")
  const author = lead.author || "";
  if (author && !/^@|^u\/|^\//.test(author) && !/client$/i.test(author)) push(author);
  // dedupe, keep only non-trivial (>=2 chars)
  return Array.from(new Set(out)).filter((c) => c.length >= 2);
}

/** Best-effort single company for external callers / display. */
export function extractCompany(lead: Lead): string {
  return companyCandidates(lead)[0] ?? "";
}

/** Full lowercased token set from title+snippet+author (for containment checks). */
function leadTokenBag(lead: Lead): Set<string> {
  const s = `${lead.title || ""} ${lead.snippet || ""} ${lead.author || ""}`
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#.\s]/g, " ");
  return new Set(s.split(/\s+/).filter((t) => t.length > 1 && !LEGAL_SUFFIXES.includes(t)));
}

/** True if every token of `company` appears in `bag`. */
function companyInBag(company: string, bag: Set<string>): boolean {
  const toks = company.split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every((t) => bag.has(t));
}

/**
 * Normalize role/title into a comparable, order-insensitive token string.
 * Strips our fetchers' prefixes, the "@ Company" / "- Company" tail, and any
 * tokens belonging to `removeCompany` (so the company name doesn't drown out
 * the role signal when it sits mid-title on one platform).
 */
export function normalizeRoleTitle(lead: Lead, removeCompany?: string): string {
  let s = (lead.title || "").toLowerCase();
  s = s.replace(TITLE_PREFIXES, "");
  s = s.replace(/\s[-–—]\s.*$/, " "); // drop " - Company" tail
  s = s.replace(/@\s*[^|•]+$/, " "); // drop "@ Company" tail
  s = s.replace(/[^a-z0-9+#.\s]/g, " ");
  const drop = new Set((removeCompany || "").split(/\s+/).filter(Boolean));
  const tokens = s
    .split(/\s+/)
    .filter((t) => t.length > 1 && !ROLE_STOPWORDS.has(t) && !drop.has(t));
  // token-sort: order-insensitive comparison ("react senior dev" ~ "dev react")
  return Array.from(new Set(tokens)).sort().join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1));
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

/** Token-sort similarity, 0..100 (100 = identical after sorting tokens). */
export function tokenSortRatio(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.round((1 - dist / maxLen) * 100);
}

// Similarity thresholds (tuned defaults, exported for testability).
export const FUZZY_THRESHOLDS = {
  role: 82, // when both leads expose a company
  roleOnly: 90, // stricter when company can't be extracted from one side
  company: 85,
  dateWindowDays: 14,
};

function withinDateWindow(a: Lead, b: Lead, days: number): boolean {
  if (!a.posted_at || !b.posted_at) return true; // missing date → don't block
  const ta = new Date(a.posted_at).getTime();
  const tb = new Date(b.posted_at).getTime();
  if (isNaN(ta) || isNaN(tb)) return true;
  return Math.abs(ta - tb) <= days * 86_400_000;
}

function leadIntent(l: Lead): number {
  return l.intent_score ?? l.score ?? 0;
}

/** True if two leads describe the same underlying job/post. */
function isSameUnderlyingLead(a: Lead, b: Lead): boolean {
  if (!withinDateWindow(a, b, FUZZY_THRESHOLDS.dateWindowDays)) return false;

  const candA = companyCandidates(a);
  const candB = companyCandidates(b);
  const bagA = leadTokenBag(a);
  const bagB = leadTokenBag(b);

  // Find a company that is present in BOTH leads' full text (handles the case
  // where one platform puts it in "@ Company" and the other in the post body).
  let sharedCompany = "";
  for (const c of [...candA, ...candB].sort((x, y) => y.length - x.length)) {
    if (companyInBag(c, bagA) && companyInBag(c, bagB)) {
      sharedCompany = c;
      break;
    }
  }

  if (sharedCompany) {
    const roleA = normalizeRoleTitle(a, sharedCompany);
    const roleB = normalizeRoleTitle(b, sharedCompany);
    if (!roleA || !roleB) return false;
    return tokenSortRatio(roleA, roleB) >= FUZZY_THRESHOLDS.role;
  }

  // Both sides expose company info but share none → different companies. Never
  // merge (prevents "Backend Engineer @ Globex" ≡ "Backend Engineer @ Initech").
  if (candA.length > 0 && candB.length > 0) return false;

  // At least one side has no parseable company: fall back to a strict role
  // match only (conservative, to avoid false collapses).
  const roleA = normalizeRoleTitle(a);
  const roleB = normalizeRoleTitle(b);
  if (!roleA || !roleB) return false;
  return tokenSortRatio(roleA, roleB) >= FUZZY_THRESHOLDS.roleOnly;
}

function mergeInto(winner: Lead, loser: Lead): void {
  winner.also_seen_on = winner.also_seen_on ?? [];
  const seenUrls = new Set(winner.also_seen_on.map((s) => s.url));
  if (loser.full_post_url && !seenUrls.has(loser.full_post_url)) {
    winner.also_seen_on.push({ platform: loser.platform, url: loser.full_post_url });
  }
  // carry any nested attribution the loser already accumulated
  for (const s of loser.also_seen_on ?? []) {
    if (s.url && !seenUrls.has(s.url) && s.url !== winner.full_post_url) {
      winner.also_seen_on.push(s);
      seenUrls.add(s.url);
    }
  }
  const note = `Also seen on ${loser.platform}`;
  winner.match_reasons = winner.match_reasons ?? [];
  if (!winner.match_reasons.includes(note)) winner.match_reasons.push(note);
}

/**
 * Collapse cross-source duplicates. Run AFTER dedupeByUrl. Keeps the
 * higher-intent-score lead of each match group and records the rest on
 * `also_seen_on`. O(n^2) worst case — fine at current volume (n<=~200).
 */
export function fuzzyDedupeLeads(leads: Lead[]): Lead[] {
  const kept: Lead[] = [];
  for (const lead of leads) {
    let mergedInto: Lead | null = null;
    for (const existing of kept) {
      if (isSameUnderlyingLead(existing, lead)) {
        mergedInto = existing;
        break;
      }
    }
    if (!mergedInto) {
      kept.push(lead);
      continue;
    }
    // Decide winner by intent score; the higher one stays in `kept`.
    if (leadIntent(lead) > leadIntent(mergedInto)) {
      mergeInto(lead, mergedInto);
      const idx = kept.indexOf(mergedInto);
      kept[idx] = lead;
    } else {
      mergeInto(mergedInto, lead);
    }
  }
  return kept;
}

/** Diversified "front page" size; everything relevant is still returned after it. */
const MAX_RESULTS = 220;
/** Hard sanity cap — must allow ~100–200 per tab (Posts/Companies/People). */
const MAX_TOTAL_RESULTS = 450;
const MAX_TOTAL_BOTH = 500;
const MAX_PER_PLATFORM = 55;
const MAX_JOB_BOARD = 6;
const MAX_COMPANY_ATS = 120;
const MIN_SOCIAL = 8;
const MAX_SMB_DEFAULT = 24;
const MAX_SMB_DIRECTORY = 48;
/** Warm floor — leads below this never show (Hot/Warm only). */
export const WARM_SCORE_FLOOR = 45;
const MIN_SCORE_CLIENTS = WARM_SCORE_FLOOR;
/** News / gov / startup sources count toward the "non-job" floor. */
const NEWS_GOV_SOURCES = new Set([
  "news",
  "secedgar",
  "startupsgallery",
  "samgov",
  "github",
  "githubhiring",
]);

// Company-identity boards: the posting org IS the prospective buyer, so these
// are Companies-segment signal — not aggregator noise. Capped separately.
const COMPANY_ATS_SOURCES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
]);

// Buyer-posted project marketplaces: a human posting "I need X" with a budget.
// Demand, not a job board.
const FREELANCE_DEMAND_SOURCES = new Set(["freelancer"]);

// Aggregators: syndicated listings with no direct buyer identity.
const JOB_BOARD_SOURCES = new Set([
  "upwork",
  "remoteok",
  "indeed",
  "glassdoor",
  "google_jobs",
  "wellfound",
  "weworkremotely",
  "remotive",
  "jobicy",
  "arbeitnow",
  "themuse",
  "usajobs",
  "samgov",
  "workingnomads",
  "githubjobs",
]);

const SMB_SOURCES = new Set(["geoapify", "foursquare", "smb", "coreclaw_maps"]);

const SOCIAL_SOURCES = new Set([
  "reddit",
  "hn",
  "bluesky",
  "mastodon",
  "lemmy",
  "twitter",
  "linkedin",
  "searxng",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "devto",
  "hashnode",
  "lobsters",
  "indiehackers",
  "quora",
  "threads",
  "discourse",
  "redditrss",
  "serpapi",
  "tavily",
  "githubintent",
  "githubhiring",
  "secedgar",
  "tenders",
  "news",
  "samgov",
]);

function isCompanyAtsLead(lead: Lead): boolean {
  return COMPANY_ATS_SOURCES.has(lead.source);
}

function isFreelanceDemandLead(lead: Lead): boolean {
  return FREELANCE_DEMAND_SOURCES.has(lead.source);
}

function isJobBoardLead(lead: Lead): boolean {
  // Company-identity and buyer-posted sources are never aggregator noise.
  if (isCompanyAtsLead(lead) || isFreelanceDemandLead(lead)) return false;
  if (JOB_BOARD_SOURCES.has(lead.source)) return true;
  const url = (lead.full_post_url || "").toLowerCase();
  if (url.includes("linkedin.com/jobs")) return true;
  if (url.includes("jobscollider") || url.includes("remoteok.com")) return true;
  const plat = (lead.platform || "").toLowerCase();
  if (plat.includes("linkedin jobs") || /web:\s*hiring\/job/.test(plat)) return true;
  return false;
}

/**
 * Job-shaped = an organisation advertising a role it wants to fill.
 * Opportunity-shaped = anything else, i.e. someone describing work they need
 * done. The product is an opportunity finder, so the feed is held to at least
 * two opportunities per job.
 */
function isJobShapedLead(lead: Lead): boolean {
  return isCompanyAtsLead(lead) || isJobBoardLead(lead);
}

function isSocialLead(lead: Lead): boolean {
  if (SOCIAL_SOURCES.has(lead.source)) return true;
  if (NEWS_GOV_SOURCES.has(lead.source)) return true;
  const p = (lead.platform || "").toLowerCase();
  return (
    p.includes("reddit") ||
    p.includes("twitter") ||
    p.includes("linkedin post") ||
    p.includes("hacker news") ||
    p.includes("hn:") ||
    p.includes("bluesky") ||
    p.includes("mastodon") ||
    p.includes("lemmy") ||
    p.includes("youtube") ||
    p.includes("instagram") ||
    p.includes("tiktok") ||
    p.includes("news") ||
    p.includes("github")
  );
}

function isSmbLead(lead: Lead): boolean {
  if (SMB_SOURCES.has(lead.source)) return true;
  const p = (lead.platform || "").toLowerCase();
  return p.includes("geoapify") || p.includes("foursquare") || p.includes("local business");
}

/** Pick top leads with job-board cap, social minimum, SMB cap, and per-platform diversity. */
export function diversifiedTop12(
  leads: Lead[],
  opts?: {
    directoryMode?: boolean;
    maxJobBoard?: number;
    maxCompanyAts?: number;
    minSocial?: number;
    maxTotal?: number;
    minScore?: number;
    maxPerPlatform?: number;
    /** Cap Reddit so LinkedIn/X/FB can surface (clients path). */
    maxReddit?: number;
    /** Cap Freelancer marketplace rows so social/People aren't drowned out. */
    maxFreelancer?: number;
  },
): Lead[] {
  const directoryMode = !!opts?.directoryMode;
  const smbCap = directoryMode ? MAX_SMB_DIRECTORY : MAX_SMB_DEFAULT;
  const minSocial = directoryMode ? 0 : (opts?.minSocial ?? MIN_SOCIAL);
  const maxJobBoard = opts?.maxJobBoard ?? MAX_JOB_BOARD;
  const maxCompanyAts = opts?.maxCompanyAts ?? MAX_COMPANY_ATS;
  const maxTotal = opts?.maxTotal ?? MAX_TOTAL_RESULTS;
  const minScore = opts?.minScore ?? 0;
  const perPlatformCap = directoryMode ? maxTotal : (opts?.maxPerPlatform ?? MAX_PER_PLATFORM);
  const maxReddit = directoryMode ? maxTotal : (opts?.maxReddit ?? 6);
  const maxFreelancer = opts?.maxFreelancer ?? 12;
  const frontPage = Math.min(MAX_RESULTS, maxTotal);
  const isReddit = (l: Lead) => l.source === "reddit" || l.source === "redditrss";
  const isFreelancer = (l: Lead) => l.source === "freelancer";
  // Qualify on the real score, ORDER on the age-decayed one.
  //
  // Sorting by raw score put a 5-day-old company posting above a 1-hour-old
  // buyer ask, because the posting collects decision-maker and engagement
  // points the ask cannot. Recency was only a tiebreaker between exactly equal
  // scores, which essentially never happens, so it never actually ordered
  // anything. See rankValue.
  const sorted = [...leads]
    .filter((l) => (l.score ?? 0) >= minScore)
    .sort((a, b) => {
      const d = rankValue(b) - rankValue(a);
      if (d !== 0) return d;
      return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
    });
  const used = new Set<string>();
  const platformCounts: Record<string, number> = {};
  let jobBoardCount = 0;
  let companyAtsCount = 0;
  let smbCount = 0;
  let jobShapedCount = 0;
  let redditCount = 0;
  let freelancerCount = 0;
  const result: Lead[] = [];

  // Hold the front page to >= 2 opportunities per job, but only while there is
  // opportunity supply left to hold it with — starving the feed to protect a
  // ratio would trade one complaint for a worse one.
  const opportunitySupply = sorted.filter((l) => !isJobShapedLead(l)).length;
  let opportunityCount = 0;

  const canAdd = (lead: Lead): boolean => {
    const key = lead.platform || lead.source;
    if ((platformCounts[key] ?? 0) >= perPlatformCap) return false;
    if (!directoryMode && isReddit(lead) && redditCount >= maxReddit) return false;
    if (!directoryMode && isFreelancer(lead) && freelancerCount >= maxFreelancer) return false;
    if (!directoryMode && isJobBoardLead(lead) && jobBoardCount >= maxJobBoard) return false;
    if (!directoryMode && isCompanyAtsLead(lead) && companyAtsCount >= maxCompanyAts) return false;
    if (!directoryMode && isJobShapedLead(lead) && opportunityCount < opportunitySupply) {
      // jobs may occupy at most a third of the page
      if ((jobShapedCount + 1) * 3 > result.length + 1) return false;
    }
    if (isSmbLead(lead) && smbCount >= smbCap) return false;
    return true;
  };

  const add = (lead: Lead) => {
    if (!lead.full_post_url || used.has(lead.full_post_url)) return false;
    if (!canAdd(lead)) return false;
    used.add(lead.full_post_url);
    const key = lead.platform || lead.source;
    platformCounts[key] = (platformCounts[key] ?? 0) + 1;
    if (isJobBoardLead(lead)) jobBoardCount++;
    if (isCompanyAtsLead(lead)) companyAtsCount++;
    if (isJobShapedLead(lead)) jobShapedCount++;
    else opportunityCount++;
    if (isSmbLead(lead)) smbCount++;
    if (isReddit(lead)) redditCount++;
    if (isFreelancer(lead)) freelancerCount++;
    result.push(lead);
    return true;
  };

  for (const lead of sorted) {
    if (result.length >= frontPage) break;
    add(lead);
  }

  if (minSocial > 0) {
    // Prefer non-Reddit social first so LinkedIn/X/FB fill the mix.
    const socialAvailable = [
      ...sorted.filter((l) => isSocialLead(l) && !isReddit(l)),
      ...sorted.filter((l) => isSocialLead(l) && isReddit(l)),
    ];
    const socialTarget = Math.min(minSocial, socialAvailable.length);
    let socialInResult = result.filter(isSocialLead).length;

    if (socialInResult < socialTarget) {
      for (const lead of socialAvailable) {
        if (socialInResult >= socialTarget) break;
        if (used.has(lead.full_post_url)) continue;
        // Make room by swapping Freelancer / job-board / other non-social first —
        // otherwise marketplace volume parks LinkedIn/X/FB below the fold.
        if (result.length >= frontPage || !canAdd(lead)) {
          const replaceIdx = result.findIndex(
            (r) =>
              !isSocialLead(r) && (isFreelancer(r) || isJobBoardLead(r) || isCompanyAtsLead(r)),
          );
          if (replaceIdx === -1) break;
          const removed = result[replaceIdx];
          used.delete(removed.full_post_url);
          const removedKey = removed.platform || removed.source;
          platformCounts[removedKey] = Math.max(0, (platformCounts[removedKey] ?? 1) - 1);
          if (isJobBoardLead(removed)) jobBoardCount--;
          if (isCompanyAtsLead(removed)) companyAtsCount--;
          if (isJobShapedLead(removed)) jobShapedCount = Math.max(0, jobShapedCount - 1);
          else opportunityCount = Math.max(0, opportunityCount - 1);
          if (isSmbLead(removed)) smbCount--;
          if (isReddit(removed)) redditCount = Math.max(0, redditCount - 1);
          if (isFreelancer(removed)) freelancerCount = Math.max(0, freelancerCount - 1);
          result.splice(replaceIdx, 1);
        }
        if (add(lead)) socialInResult++;
      }
    }

    // Pin non-Reddit social into the first viewport (demo + relevance signal).
    const pinTarget = Math.min(
      6,
      socialTarget,
      result.filter((l) => isSocialLead(l) && !isReddit(l)).length,
    );
    if (pinTarget > 0) {
      const pinned: Lead[] = [];
      const rest: Lead[] = [];
      for (const r of result) {
        if (pinned.length < pinTarget && isSocialLead(r) && !isReddit(r)) pinned.push(r);
        else rest.push(r);
      }
      // Interleave: social, filler, social, filler… so Freelancer volume remains visible.
      const interleaved: Lead[] = [];
      let pi = 0;
      let ri = 0;
      while (interleaved.length < result.length && (pi < pinned.length || ri < rest.length)) {
        if (pi < pinned.length) interleaved.push(pinned[pi++]);
        if (ri < rest.length && interleaved.length < result.length) interleaved.push(rest[ri++]);
      }
      while (ri < rest.length && interleaved.length < result.length) interleaved.push(rest[ri++]);
      while (pi < pinned.length && interleaved.length < result.length)
        interleaved.push(pinned[pi++]);
      result.length = 0;
      result.push(...interleaved);
    }
  }

  if (result.length < frontPage) {
    for (const lead of sorted) {
      if (result.length >= frontPage) break;
      add(lead);
    }
  }

  // After diversified front page, append remaining quality leads (by score).
  for (const lead of sorted) {
    if (result.length >= maxTotal) break;
    if (!lead.full_post_url || used.has(lead.full_post_url)) continue;
    // Overflow still respects caps (Reddit + platform) so mix isn't re-flooded.
    if (!canAdd(lead)) continue;
    used.add(lead.full_post_url);
    const key = lead.platform || lead.source;
    platformCounts[key] = (platformCounts[key] ?? 0) + 1;
    if (isJobBoardLead(lead)) jobBoardCount++;
    if (isCompanyAtsLead(lead)) companyAtsCount++;
    if (isReddit(lead)) redditCount++;
    if (isFreelancer(lead)) freelancerCount++;
    if (isSmbLead(lead)) smbCount++;
    result.push(lead);
  }

  return result;
}

export function enrichAndRank(leads: Lead[], limit = 30): Lead[] {
  const seen = new Set<string>();
  const out: Lead[] = [];
  for (const l of leads) {
    if (!l.full_post_url || seen.has(l.full_post_url)) continue;
    seen.add(l.full_post_url);
    // Preserve score/tier set upstream by the buyer-intent engine; only fall
    // back to keyword scoring if a lead arrives without them.
    if (l.score == null) {
      const text = `${l.title} ${l.snippet}`;
      const { tier } = hasBuyerSignal(text);
      l.tier = l.tier ?? tier;
      l.is_decision_maker = l.is_decision_maker ?? detectDecisionMaker(l.author);
      l.score = scoreLead(l);
    }
    if (!l.match_reasons || l.match_reasons.length === 0) {
      const reasons: string[] = [];
      if (l.is_decision_maker) reasons.push("Posted by a decision-maker");
      if (l.posted_at) {
        const days = (Date.now() - new Date(l.posted_at).getTime()) / 86_400_000;
        if (days < 1) reasons.push("Posted within the last 24h");
        else if (days < 7) reasons.push("Posted this week");
      }
      if (l.tier === "hot") reasons.push("Matches a strong buyer phrase");
      else if (l.tier === "warm") reasons.push("Matches an intent phrase");
      l.match_reasons = reasons;
      l.why_match = reasons.length
        ? `This is a ${l.tier ?? "warm"} lead because ${reasons.join("; ").toLowerCase()}.`
        : "";
    }
    out.push(l);
  }
  out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out.slice(0, limit);
}
