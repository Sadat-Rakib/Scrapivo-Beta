/**
 * Page relevance verdicts (beta spec §23-32) — goal-conditioned browsing.
 *
 * Before extracting from (or following links on) an opened page, decide
 * whether that page can serve the CURRENT research goal for the CURRENT
 * entity. Pure and synchronous: no server singletons, no imports from
 * network modules. The browser/research loops consume `keepExtracting` and
 * the per-candidate budget helper to stop wasting page visits.
 */

export type PageVerdict =
  | "RELEVANT"
  | "PARTIALLY_RELEVANT"
  | "THIN"
  | "WRONG_ENTITY"
  | "IRRELEVANT"
  | "LOGIN_REQUIRED"
  | "CHALLENGE"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "ERROR";

export interface PageRelevanceInput {
  url: string;
  title?: string;
  text?: string;
  /** Entity currently being researched (company/person name). */
  entityName?: string;
  /** Registrable host of the entity's own site, when known. */
  entityHost?: string;
  /** Current research goal, e.g. "contacts" | "team" | "careers" | "research". */
  goal?: string;
  /** Browser friction markers observed on the page (BrowserFriction values or lowercase tokens). */
  friction?: readonly string[];
  /** Final HTTP status, when the page was fetched over HTTP. */
  httpStatus?: number;
}

export interface PageRelevanceResult {
  verdict: PageVerdict;
  reason: string;
  /** false → the caller must NOT extract and must NOT follow links from this page. */
  keepExtracting: boolean;
}

// ---------------------------------------------------------------------------
// Keyword sets
// ---------------------------------------------------------------------------

/** Pages that are never goal pages: legal/boilerplate/support furniture. */
const IRRELEVANT_PATH_KEYWORDS = [
  "privacy",
  "cookie",
  "cookies",
  "terms",
  "legal",
  "policies",
  "policy",
  "support",
  "help",
  "help-center",
  "helpcenter",
  "faq",
  "disclaimer",
  "gdpr",
  "ccpa",
  "accessibility-statement",
];

/** Standalone legal/boilerplate titles (cookie banners, consent screens). */
const IRRELEVANT_TITLE_RE =
  /\b(privacy (?:policy|statement|notice)|cookie (?:policy|banner|settings|preferences|consent|notice)|terms (?:of (?:use|service)|and conditions)|legal notice|manage cookies|we value your privacy| consent management)\b/i;

/** Known support/help destinations that are never entity research targets. */
const KNOWN_IRRELEVANT_PATHS: Array<{ host?: RegExp; path: RegExp }> = [
  { host: /(^|\.)microsoft\.com$/i, path: /\/support(?:\/|$)/i },
  { path: /\/(?:privacy|cookie|cookies|terms|legal|policies|policy|disclaimer|gdpr|ccpa)(?:[a-z-]*)(?:\/|$|\?)/i },
  { path: /\/(?:support|help|faq|help-center|helpcenter|customer-service)(?:\/|$|\?)/i },
  { path: /\/(?:signin|signup|login|register|account)(?:\/|$|\?)/i },
];

/** Goal hint keywords: page content that can satisfy the research goal. */
const GOAL_HINTS: Record<string, RegExp> = {
  contacts: /\b(contact|email|phone|telephone|call us|get in touch|reach us|talk to|sales@|info@|hello@|@[\w.-]+\.(?:com|io|net|co|org))\b/i,
  team: /\b(our team|meet the team|about us|who we are|leadership|founders?|management|people|staff|bios?)\b/i,
  careers: /\b(careers?|jobs?|we'?re hiring|join us|join our team|open (?:roles|positions)|vacanc|apply)\b/i,
  research: /\b(about|contact|team|careers?|jobs?|services?|products?|company)\b/i,
};

/** Navigational/boilerplate markers — a page made of these carries no facts. */
const NAV_MARKERS_RE =
  /\b(home|menu|about us|contact us|sign in|log in|subscribe|read more|learn more|view all|click here|privacy|terms|cookies|copyright|all rights reserved|skip to content|toggle navigation|follow us|newsletter)\b/gi;

/** Minimum text below which a page carries too little to research (aligned
 * with the existing 100-char pipeline floor; spec ~200). */
const THIN_TEXT_CHARS = 120;
/** Below this length a page is treated as mostly navigation. */
const NAVIGATIONAL_TEXT_CHARS = 600;
/** How much of the page head is scanned for entity mention. */
const MENTION_WINDOW_CHARS = 2000;

export const STOP_VERDICTS: ReadonlySet<PageVerdict> = new Set([
  "IRRELEVANT",
  "WRONG_ENTITY",
  "LOGIN_REQUIRED",
  "CHALLENGE",
  "RATE_LIMITED",
  "BLOCKED",
  "ERROR",
  "THIN",
]);

/**
 * Stop verdicts the research loops enforce per page. THIN is excluded there:
 * the read ladders (static-usability / thin-scroll-retry) already own
 * too-short pages, and short contact pages can legitimately carry an email or
 * phone. THIN still counts toward the per-candidate waste budget below.
 */
export const PAGE_LEVEL_STOP_VERDICTS: ReadonlySet<PageVerdict> = new Set([
  "IRRELEVANT",
  "WRONG_ENTITY",
  "LOGIN_REQUIRED",
  "CHALLENGE",
  "RATE_LIMITED",
  "BLOCKED",
  "ERROR",
]);

/** Host-level problems — the whole domain is degraded, not just this page. */
export const HOST_LEVEL_VERDICTS: ReadonlySet<PageVerdict> = new Set([
  "LOGIN_REQUIRED",
  "CHALLENGE",
  "RATE_LIMITED",
  "BLOCKED",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hostOfUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function mentions(haystackTitle: string, haystackText: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n || n.length < 3) return false; // too generic / too short to prove anything
  const window = `${haystackTitle}\n${haystackText.slice(0, MENTION_WINDOW_CHARS)}`;
  return normalize(window).includes(n);
}

function mapFriction(friction: readonly string[] | undefined): { verdict: PageVerdict; reason: string } | null {
  for (const raw of friction ?? []) {
    const f = raw.trim().toUpperCase();
    if (f === "CAPTCHA" || f === "CHALLENGE") return { verdict: "CHALLENGE", reason: `friction:${raw}` };
    if (f === "LOGIN_WALL" || f === "LOGIN") return { verdict: "LOGIN_REQUIRED", reason: `friction:${raw}` };
    if (f === "RATE_LIMIT" || f === "RATE_LIMITED" || f === "TOO_MANY_REQUESTS") return { verdict: "RATE_LIMITED", reason: `friction:${raw}` };
    if (f === "ACCESS_BLOCK" || f === "BLOCKED" || f === "FORBIDDEN") return { verdict: "BLOCKED", reason: `friction:${raw}` };
    // MODAL / COOKIE_BANNER are benign overlays — never stop on them.
  }
  return null;
}

function pathIsIrrelevant(url: string, title: string): string | null {
  let path = "";
  let host = "";
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    path = parsed.pathname.toLowerCase();
    host = parsed.hostname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  if (IRRELEVANT_TITLE_RE.test(title)) return "title_boilerplate";
  for (const entry of KNOWN_IRRELEVANT_PATHS) {
    if (entry.host && !entry.host.test(host)) continue;
    if (entry.path.test(path)) return entry.host ? "known_irrelevant_path" : "irrelevant_path";
  }
  for (const keyword of IRRELEVANT_PATH_KEYWORDS) {
    if (new RegExp(`(?:^|/)${keyword}(?:[a-z-]*)?(?:/|$)`).test(path)) return `irrelevant_path:${keyword}`;
  }
  return null;
}

function navigationalRatio(text: string): number {
  if (!text.trim()) return 1;
  const markers = text.match(NAV_MARKERS_RE)?.length ?? 0;
  const words = text.trim().split(/\s+/).length;
  return words ? markers / Math.max(1, words) * 10 : 1; // markers per 10 words
}

// ---------------------------------------------------------------------------
// Main verdict
// ---------------------------------------------------------------------------

/**
 * Goal-conditioned page verdict. Order matters: friction → status → thin →
 * irrelevant furniture → wrong entity → entity/goal match.
 */
export function classifyPageRelevance(input: PageRelevanceInput): PageRelevanceResult {
  const title = input.title ?? "";
  const text = input.text ?? "";
  const trimmed = text.trim();

  const frictionVerdict = mapFriction(input.friction);
  if (frictionVerdict) return { ...frictionVerdict, keepExtracting: false };

  if (input.httpStatus != null && input.httpStatus >= 400) {
    return { verdict: "ERROR", reason: `http_${input.httpStatus}`, keepExtracting: false };
  }

  if (trimmed.length < THIN_TEXT_CHARS) {
    // A short page made mostly of menu/boilerplate markers is a navigation
    // shell, not thin content — it is weak but usable (its links lead to the
    // real pages), so keep extracting instead of stopping.
    if (navigationalRatio(trimmed) > 1.5) {
      return { verdict: "PARTIALLY_RELEVANT", reason: "navigational_shell_page", keepExtracting: true };
    }
    return { verdict: "THIN", reason: `text_too_short_${trimmed.length}`, keepExtracting: false };
  }

  const irrelevant = pathIsIrrelevant(input.url, title);
  if (irrelevant) {
    return { verdict: "IRRELEVANT", reason: irrelevant, keepExtracting: false };
  }

  const entityHost = input.entityHost ? hostOfUrl(input.entityHost) : "";
  const pageHost = hostOfUrl(input.url);
  const onEntityHost = !!entityHost && pageHost === entityHost;
  const goalHints = GOAL_HINTS[(input.goal ?? "research").toLowerCase()] ?? GOAL_HINTS.research!;
  const hay = `${title}\n${trimmed}`;
  const goalMatch = goalHints.test(hay) || goalHints.test(input.url);

  const entityName = input.entityName?.trim();
  if (entityName) {
    const mentioned = mentions(title, text, entityName);
    if (!mentioned && !onEntityHost) {
      return { verdict: "WRONG_ENTITY", reason: `entity_not_mentioned:${entityName}`, keepExtracting: false };
    }
    const nav = navigationalRatio(trimmed);
    // Entity present but the page is mostly menu/boilerplate — weak but usable.
    if (nav > 1.5) {
      return { verdict: "PARTIALLY_RELEVANT", reason: "entity_mentioned_navigational_page", keepExtracting: true };
    }
    if (mentioned && goalMatch) {
      return { verdict: "RELEVANT", reason: "entity_and_goal_matched", keepExtracting: true };
    }
    if (trimmed.length < NAVIGATIONAL_TEXT_CHARS) {
      return { verdict: "PARTIALLY_RELEVANT", reason: "entity_mentioned_short_page", keepExtracting: true };
    }
    return { verdict: "RELEVANT", reason: "entity_mentioned", keepExtracting: true };
  }

  // No entity context (e.g. discovery pass over a source article): the page is
  // researchable unless it is furniture — which the checks above caught.
  if (goalMatch || trimmed.length >= NAVIGATIONAL_TEXT_CHARS) {
    return { verdict: "RELEVANT", reason: "no_entity_context_page_readable", keepExtracting: true };
  }
  return { verdict: "PARTIALLY_RELEVANT", reason: "no_entity_context_thin_read", keepExtracting: true };
}

// ---------------------------------------------------------------------------
// Per-candidate page budget (waste guard)
// ---------------------------------------------------------------------------

export interface CandidatePageBudget {
  /** Pages actually opened for this candidate (all verdicts). */
  visitedPages: number;
  /** Pages whose verdict wasted the visit (IRRELEVANT / WRONG_ENTITY / THIN). */
  irrelevantPages: number;
  /** Set once >50% of visited pages proved irrelevant. */
  abandoned: boolean;
}

/** Verdicts that count toward the per-candidate waste budget. Host-level
 * problems (challenge/login/rate-limit/blocked/error) are host faults, not
 * wasted candidate pages, so they do not poison the guard. */
const WASTEFUL_VERDICTS: ReadonlySet<PageVerdict> = new Set(["IRRELEVANT", "WRONG_ENTITY", "THIN"]);

/** One stray page never kills a candidate; the guard needs a real sample. */
const MIN_PAGES_BEFORE_ABANDON = 2;

export function newCandidatePageBudget(): CandidatePageBudget {
  return { visitedPages: 0, irrelevantPages: 0, abandoned: false };
}

/**
 * Pure decision for the research loop: should this page be skipped, and has
 * the candidate's page budget tipped into waste (>50% irrelevant visits)?
 * Returns the updated budget; the caller persists it on the candidate.
 */
export function applyVerdictToPageBudget(
  budget: CandidatePageBudget,
  verdict: PageVerdict,
): { budget: CandidatePageBudget; skipPage: boolean; abandonCandidate: boolean } {
  const next: CandidatePageBudget = {
    visitedPages: budget.visitedPages + 1,
    irrelevantPages: budget.irrelevantPages + (WASTEFUL_VERDICTS.has(verdict) ? 1 : 0),
    abandoned: budget.abandoned,
  };
  const skipPage = STOP_VERDICTS.has(verdict);
  let abandonCandidate = false;
  if (!next.abandoned && next.visitedPages >= MIN_PAGES_BEFORE_ABANDON && next.irrelevantPages * 2 > next.visitedPages) {
    next.abandoned = true;
    abandonCandidate = true;
  }
  return { budget: next, skipPage, abandonCandidate };
}
