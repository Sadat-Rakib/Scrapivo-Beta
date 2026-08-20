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

const JUNK_TITLE_RE = /^(404|not found|error|untitled|access denied|forbidden|just a moment)/i;

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
  const meaningful = tokens.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3);
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

/**
 * Lightweight HEAD/GET probe for Discover lead URLs.
 * Drops obvious 404 / gone / soft-404 / login walls without full page scrape.
 */
export async function probeUrlAlive(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; reason?: string }> {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: "bad_url" };
  // First-party APIs / known-good hosts — skip network probe.
  if (
    /reddit\.com|freelancer\.com|news\.ycombinator|stackoverflow\.com|stackexchange\.com|github\.com|sam\.gov/i.test(
      url,
    )
  ) {
    return { ok: true };
  }
  const timeout = opts?.timeoutMs ?? 4000;
  try {
    const ctrl = AbortSignal.timeout(timeout);
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl,
      headers: { "user-agent": "Mozilla/5.0 (compatible; ScrapivoBot/1.0)" },
    });
    // Some hosts reject HEAD — fall back to GET range.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; ScrapivoBot/1.0)",
          Range: "bytes=0-2047",
        },
      });
    }
    if (res.status === 404 || res.status === 410 || res.status === 451) {
      return { ok: false, reason: `http_${res.status}` };
    }
    if (res.status >= 400 && res.status !== 403) {
      // 403 often means bot wall on a live page — keep.
      return { ok: false, reason: `http_${res.status}` };
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !/html|text|json|xml|javascript/i.test(ct) && /image|video|audio|octet/i.test(ct)) {
      return { ok: false, reason: "non_page" };
    }
    return { ok: true };
  } catch {
    // Network flake — keep the lead rather than wipe the feed.
    return { ok: true, reason: "probe_error_keep" };
  }
}

/** Probe top N leads in parallel; drop confirmed dead URLs. */
export async function filterAliveLeads<T extends { full_post_url?: string }>(
  leads: T[],
  opts?: { sample?: number; concurrency?: number },
): Promise<T[]> {
  const sample = opts?.sample ?? 24;
  const concurrency = opts?.concurrency ?? 6;
  if (!leads.length) return leads;
  const head = leads.slice(0, sample);
  const tail = leads.slice(sample);
  const alive: T[] = [];
  for (let i = 0; i < head.length; i += concurrency) {
    const batch = head.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (l) => {
        const probe = await probeUrlAlive(l.full_post_url || "");
        return { lead: l, ok: probe.ok };
      }),
    );
    for (const r of results) {
      if (r.ok) alive.push(r.lead);
    }
  }
  return [...alive, ...tail];
}
