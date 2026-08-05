/**
 * Fetch validation gate — reject 404s, empty pages, soft-404s, login walls,
 * and (optionally) pages with no query relevance before they become evidence.
 */

export type FetchGateInput = {
  url: string;
  status?: number;
  title?: string;
  text?: string;
  /** Query / ICP tokens that should appear for relevance (optional). */
  relevanceTokens?: string[];
  minTextLength?: number;
};

export type FetchGateResult = {
  ok: boolean;
  reason?: string;
};

const SOFT_404_RE =
  /\b(page not found|404\s*error|404\s*not\s*found|doesn't exist|does not exist|nothing here|no longer available|content not found|error 404| entamos perdido|oops.? something went wrong)\b/i;

const LOGIN_WALL_RE =
  /\b(sign in to continue|log in to continue|please log in|please sign in|create an account to|captcha|cloudflare|access denied|forbidden|verify you are human)\b/i;

const PARKED_RE =
  /\b(parked domain|domain for sale|buy this domain|this domain is for sale|godaddy|namecheap parking)\b/i;

const JUNK_TITLE_RE =
  /^(404|not found|error|untitled|access denied|forbidden|just a moment)/i;

export function isSoft404(title: string, text: string): boolean {
  const head = `${title}\n${(text || "").slice(0, 800)}`;
  if (SOFT_404_RE.test(head)) return true;
  if (JUNK_TITLE_RE.test((title || "").trim())) return true;
  return false;
}

export function isLoginWall(title: string, text: string): boolean {
  return LOGIN_WALL_RE.test(`${title}\n${(text || "").slice(0, 1200)}`);
}

export function isParkedDomain(title: string, text: string): boolean {
  return PARKED_RE.test(`${title}\n${(text || "").slice(0, 800)}`);
}

function hasRelevance(text: string, tokens?: string[]): boolean {
  if (!tokens?.length) return true;
  const hay = (text || "").toLowerCase();
  const meaningful = tokens
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= 3);
  if (!meaningful.length) return true;
  const hits = meaningful.filter((t) => hay.includes(t));
  return hits.length >= Math.min(1, meaningful.length);
}

/**
 * Validate a fetched page before using it as lead evidence or research citation.
 */
export function validateFetchedPage(input: FetchGateInput): FetchGateResult {
  const minLen = input.minTextLength ?? 120;
  if (input.status != null && (input.status < 200 || input.status >= 400)) {
    return { ok: false, reason: `http_${input.status}` };
  }
  const title = input.title || "";
  const text = input.text || "";
  if (!text.trim() || text.trim().length < minLen) {
    return { ok: false, reason: "empty_or_short" };
  }
  if (isSoft404(title, text)) return { ok: false, reason: "soft_404" };
  if (isLoginWall(title, text)) return { ok: false, reason: "login_wall" };
  if (isParkedDomain(title, text)) return { ok: false, reason: "parked" };
  if (!hasRelevance(`${title}\n${text}`, input.relevanceTokens)) {
    return { ok: false, reason: "not_relevant" };
  }
  return { ok: true };
}

/** Strip obvious boilerplate / nav noise for LLM context (Cook-style condenser lite). */
export function condensePageText(text: string, maxChars = 4000): string {
  let t = (text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop repeated cookie banners
  t = t.replace(/we use cookies[\s\S]{0,200}/gi, " ");
  return t.slice(0, maxChars);
}

/** Random jitter between minMs and maxMs (Cook-style polite crawling). */
export function jitterMs(minMs = 2000, maxMs = 4000): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
