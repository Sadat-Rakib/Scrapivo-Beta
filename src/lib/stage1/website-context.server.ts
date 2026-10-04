import { ensureHttpUrl } from "@/lib/search/site-url";
import { validateExternalUrl } from "@/lib/intelligence/security/url-validator";
import { fetchPageContent, type FetchedPage } from "@/lib/search/page-enrichment.server";
import { detectUrlTokens, type DetectedUrl } from "./url-utils";

/**
 * Stage-1 bounded website context (P3).
 *
 * A user-provided URL — especially an own-business site like mirrin.agency —
 * is research ABOUT THE USER'S BUSINESS, never prospect discovery. Retrieval
 * is strictly bounded: homepage + at most 2 high-value same-domain pages
 * (About / Services), ≤3 fetches, 6s each, SSRF-validated, fail-open.
 * Everything fetched is untrusted DATA handed to the fact extractor with
 * provenance; nothing here decides intent.
 */

const SITE_PAGE_BUDGET_MS = 6_000;
const MAX_SITE_PAGES = 3;
const HIGH_VALUE_LINK_RE = /(?:about|services|what-we-do|solutions|offerings|expertise|our-work|agency|company)/i;
const LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|href=["'](https?:\/\/[^"']+)["']/gi;

/** Detect + SSRF-filter user-supplied URLs, and flag own-business context
 *  ("my agency mirrin.agency", "our site …") from the surrounding text. */
export function detectUserUrls(
  text: string,
): Array<DetectedUrl & { ownOrg: boolean; rejected?: string }> {
  const ownCue =
    /\b(?:my|our)\s+(?:agency|company|studio|business|firm|consultancy|practice|portfolio|website|site|startup)\b/i
      .test(text) ||
    /\b(?:i am|i'm|we are|we're)\s+(?:the\s+)?(?:owner|founder)\b/i.test(text);
  const out: Array<DetectedUrl & { ownOrg: boolean; rejected?: string }> = [];
  for (const token of detectUrlTokens(text)) {
    const qualified = ensureHttpUrl(token.url);
    if (!qualified) {
      out.push({ ...token, ownOrg: ownCue, rejected: "not a usable URL" });
      continue;
    }
    const guard = validateExternalUrl(qualified);
    if (!guard.valid) {
      out.push({ ...token, ownOrg: ownCue, rejected: guard.error ?? "URL rejected by SSRF guard" });
      continue;
    }
    // Stable provenance refs: strip the URL parser's trailing slash so the
    // ref the extractor sees matches what the user typed and what gets quoted.
    const sanitized = (guard.sanitized_url ?? qualified).replace(/\/+$/, "");
    out.push({ ...token, url: sanitized || qualified, ownOrg: ownCue });
  }
  return out;
}

async function fetchBounded(url: string): Promise<FetchedPage | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchPageContent(url),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SITE_PAGE_BUDGET_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sameDomainLinks(markdown: string, host: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (markdown ?? "").matchAll(LINK_RE)) {
    const href = (m[2] ?? m[3] ?? "").trim();
    if (!href) continue;
    try {
      const u = new URL(href, `https://${host}`);
      if (u.host !== host) continue;
      if (!/^https?:$/.test(u.protocol)) continue;
      if (/\.(?:pdf|jpg|jpeg|png|webp|zip|mp4)$/i.test(u.pathname)) continue;
      const key = u.origin + u.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      /* malformed link — skip */
    }
  }
  return out;
}

export type SiteContext = {
  pages: Array<{ url: string; title: string; text: string }>;
  /** Set when even the homepage could not be fetched — honest unresolved. */
  failed: string | null;
};

/** Homepage + ≤2 high-value same-domain pages, hard-capped. */
export async function fetchSiteContext(rawUrl: string): Promise<SiteContext> {
  const home = await fetchBounded(rawUrl);
  if (!home || !home.text?.trim()) {
    return { pages: [], failed: rawUrl };
  }
  const pages: Array<{ url: string; title: string; text: string }> = [
    { url: rawUrl, title: home.title ?? "", text: home.text.slice(0, 8_000) },
  ];
  try {
    const host = new URL(rawUrl).host;
    const candidates = sameDomainLinks(home.markdown || home.text, host)
      .filter((link) => HIGH_VALUE_LINK_RE.test(link))
      .slice(0, MAX_SITE_PAGES - pages.length);
    for (const link of candidates) {
      const page = await fetchBounded(link);
      if (page?.text?.trim()) {
        pages.push({ url: link, title: page.title ?? "", text: page.text.slice(0, 6_000) });
      }
    }
  } catch {
    /* link discovery is best-effort */
  }
  return { pages: pages.slice(0, MAX_SITE_PAGES), failed: null };
}
