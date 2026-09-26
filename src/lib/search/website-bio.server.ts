/**
 * Website-derived business bios (Phase 2c): the expanded card's About
 * section comes ONLY from fetched public site content — extractive excerpts,
 * never generated summaries. No site (or failed fetch) → honest null, never
 * stitched-together filler from name/location fields.
 *
 * Bounds: 10s fetch timeout, 200-entry cache (7d TTL, 1h negative cache),
 * one fetch per panel open (naturally sequential). Never blocks retrieval —
 * the panel renders first, the bio fills in asynchronously.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { ensureHttpUrl } from "@/lib/search/site-url";
// NOTE: page-enrichment stays behind dynamic import() at the use site. This
// module is statically imported by client components (for the getWebsiteBio
// server-fn reference), and the enrichment chain reaches node:child_process
// (http-fetch.server), which crashes the browser bundle if statically linked.

export interface WebsiteBio {
  url: string;
  /** Extractive excerpt (title + leading substance), ≤280 chars. */
  blurb: string;
  fetchedAt: string;
}

type FetchPage = (url: string) => Promise<{
  title: string;
  text: string;
  markdown: string;
} | null>;

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const NEGATIVE_TTL_MS = 3600 * 1000;
const CACHE_CAP = 200;
const FETCH_TIMEOUT_MS = 10000;

const cache = new Map<string, { bio: WebsiteBio | null; at: number }>();

function cacheGet(url: string): { hit: boolean; bio: WebsiteBio | null } {
  const e = cache.get(url);
  if (!e) return { hit: false, bio: null };
  const ttl = e.bio ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
  if (Date.now() - e.at > ttl) {
    cache.delete(url);
    return { hit: false, bio: null };
  }
  return { hit: true, bio: e.bio };
}

function cacheSet(url: string, bio: WebsiteBio | null): void {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(url, { bio, at: Date.now() });
}

/** First substantial sentences of page text (skips nav/cookie boilerplate). */
export function extractBlurb(title: string, text: string): string | null {
  const clean = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length >= 40 &&
        !/^(menu|navigation|cookie|cookies|subscribe|newsletter|sign up|log in|login|cart|search|home|contact us)\b/i.test(
          l,
        ),
    )
    .join(" ");
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? (clean ? [clean] : []);
  const picked = sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 20)
    .slice(0, 3)
    .join(" ");
  const head = (title ?? "").trim();
  const body = picked || (clean.length >= 20 ? clean.slice(0, 280) : "");
  if (!body) return null;
  const blurb =
    head && body.toLowerCase().startsWith(head.toLowerCase().slice(0, 24))
      ? body
      : head
        ? `${head.replace(/\s+/g, " ")} — ${body}`
        : body;
  return blurb.slice(0, 280) || null;
}

export async function fetchWebsiteBio(
  rawUrl: string,
  opts: { fetchPage?: FetchPage; timeoutMs?: number } = {},
): Promise<WebsiteBio | null> {
  const url = ensureHttpUrl(rawUrl);
  if (!url) return null;
  const cached = cacheGet(url);
  if (cached.hit) return cached.bio;
  const fetchPage =
    opts.fetchPage ??
    (await import("@/lib/search/page-enrichment.server")).fetchPageContent;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  let page: Awaited<ReturnType<FetchPage>> = null;
  try {
    page = await Promise.race([
      fetchPage(url),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    page = null;
  }
  if (!page) {
    cacheSet(url, null);
    return null;
  }
  const blurb = extractBlurb(page.title, page.text || page.markdown);
  if (!blurb) {
    cacheSet(url, null);
    return null;
  }
  const bio: WebsiteBio = { url, blurb, fetchedAt: new Date().toISOString() };
  cacheSet(url, bio);
  return bio;
}

/** Test hook: reset the module cache between cases. */
export function clearWebsiteBioCache(): void {
  cache.clear();
}

export const getWebsiteBio = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().max(500) }).parse(d))
  .handler(async ({ data }): Promise<WebsiteBio | null> => {
    return fetchWebsiteBio(data.url);
  });
