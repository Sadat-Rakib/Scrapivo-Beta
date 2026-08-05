import type { Lead } from "./types.ts";
import type { SearchQuery } from "./types.ts";
import {
  detectDecisionMaker,
  generateSummary,
  generateWhyShown,
  relativeTime,
  scoreIntent,
} from "./intent-filter.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function ok<T>(r: Response): Promise<T | null> {
  return r.ok ? ((await r.json()) as T) : null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function idFromUrl(url: string): string {
  try {
    const bytes = new TextEncoder().encode(url);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).slice(0, 16);
  } catch {
    return url.slice(-16);
  }
}

export async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  retries = 2,
  timeoutMs = 12000,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(300 * (i + 1));
    }
  }
  throw lastErr;
}

/** Keyless fallback: Jina Reader returns clean text for public pages. */
export async function jinaRead(url: string): Promise<string> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  const res = await fetchWithRetry(`https://r.jina.ai/${target}`, {
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) return "";
  const text = await res.text();
  return text.slice(0, 4000);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function cleanText(s: string | undefined | null): string {
  if (!s) return "";
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return "";
      }
    })
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export interface BuildLeadParams {
  id: string;
  platform: string;
  platform_label: string;
  post_url: string;
  post_title: string;
  post_body_snippet: string;
  query: SearchQuery;
  posted_at: string;
  author_handle?: string;
  author_url?: string;
  author_name?: string;
  author_bio?: string;
  author_followers?: number;
  engagement?: Lead["engagement"];
  source_confidence: number;
  is_decision_maker?: boolean;
  skipIntentCheck?: boolean;
  raw_data?: Record<string, unknown>;
}

export function buildLead(p: BuildLeadParams): Lead | null {
  const text = `${p.post_title} ${p.post_body_snippet}`;
  const isDM = p.is_decision_maker ?? detectDecisionMaker(text + " " + (p.author_bio || ""));
  const { score, tier, hasBudget, hasUrgency } = scoreIntent({
    text,
    platform: p.platform,
    postedAt: p.posted_at,
    isDecisionMaker: isDM,
    platformSourceConfidence: p.source_confidence,
  });
  if (score === 0) return null;

  return {
    id: p.id,
    platform: p.platform,
    platform_label: p.platform_label,
    post_url: p.post_url,
    post_title: cleanText(p.post_title).slice(0, 200),
    post_body_snippet: cleanText(p.post_body_snippet).slice(0, 600),
    ai_summary: generateSummary(p.post_title, p.post_body_snippet, p.query.skill),
    why_shown: generateWhyShown(
      p.platform_label,
      p.query.skill,
      hasBudget,
      isDM,
      tier,
      p.posted_at,
    ),
    author_handle: p.author_handle || "",
    author_url: p.author_url || "",
    author_name: p.author_name || "",
    author_bio: p.author_bio,
    author_followers: p.author_followers,
    posted_at: p.posted_at,
    posted_at_relative: relativeTime(p.posted_at),
    engagement: p.engagement || {},
    intent_score: score,
    intent_tier: tier,
    is_decision_maker: isDM,
    has_budget: hasBudget,
    has_urgency: hasUrgency,
    source_confidence: p.source_confidence,
    raw_data: p.raw_data,
  };
}

export { BROWSER_UA };
