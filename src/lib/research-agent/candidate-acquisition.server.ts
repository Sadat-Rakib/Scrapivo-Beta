/**
 * Candidate acquisition — Workstream 2 (acquisition policy + browser reliability).
 *
 * Owns three responsibilities, all offline-testable via injected fetch:
 *   1. HTTP-first static acquisition: fetch + extract (metadata, JSON-LD,
 *      links, emails, phones, text) BEFORE spending a browser page. Escalate
 *      to the browser only when the page is not statically usable or the page
 *      class is known to require rendering.
 *   2. Candidate task pool: max N in flight (SCRAPIVO_RESEARCH_CONCURRENCY,
 *      default 3, clamped 1–6) with STRICT per-registrable-domain
 *      serialization (domain→queue map). No new deps.
 *   3. Shared read/parse helpers used by the browser read-failure ladder
 *      (browser fail → one retry → HTTP fallback → SOURCE_DEGRADED).
 */
import { resilientFetch } from "@/lib/search/http-fetch.server";
import { throwIfAborted } from "@/lib/search/search-run";
import type { PageSnapshot } from "./browser";

// ---------------------------------------------------------------------
// Concurrency policy
// ---------------------------------------------------------------------

export const DEFAULT_RESEARCH_CONCURRENCY = 3;
export const MIN_RESEARCH_CONCURRENCY = 1;
export const MAX_RESEARCH_CONCURRENCY = 6;

export function researchConcurrency(env: { SCRAPIVO_RESEARCH_CONCURRENCY?: string | undefined } = process.env): number {
  const raw = Number(env.SCRAPIVO_RESEARCH_CONCURRENCY);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RESEARCH_CONCURRENCY;
  return Math.min(MAX_RESEARCH_CONCURRENCY, Math.max(MIN_RESEARCH_CONCURRENCY, Math.floor(raw)));
}

// ---------------------------------------------------------------------
// Registrable domain (best-effort, no deps — used for per-domain queues)
// ---------------------------------------------------------------------

const MULTIPART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "or.jp", "ne.jp",
  "com.au", "net.au", "org.au", "co.nz", "com.br", "com.mx", "co.in",
  "com.cn", "com.tw", "co.kr", "com.sg", "com.tr", "co.za", "com.ar",
]);

/** Registrable domain for per-domain serialization ("x.y.co.uk" → "y.co.uk"). */
export function registrableDomainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host || null;
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join(".");
    if (MULTIPART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
    return lastTwo;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Candidate task pool — global cap + strict per-domain serialization
// ---------------------------------------------------------------------

export interface PoolTask<T> {
  /** Registrable domain to serialize on (null → no domain constraint). */
  domain: string | null;
  work: () => Promise<T>;
}

export interface PoolRunResult<T> {
  /** Results indexed like tasks; undefined when never started (aborted). */
  results: Array<T | undefined>;
  errors: Array<{ index: number; error: unknown }>;
}

/**
 * Run tasks with at most `concurrency` in flight; never more than one task
 * per registrable domain at a time. Tasks may start out of order (later tasks
 * skip ahead when an earlier domain is busy); results keep their index.
 * Respects abort: no new task starts after abort; in-flight work finishes.
 */
export async function runCandidateTasks<T>(tasks: Array<PoolTask<T>>, concurrency: number, signal?: AbortSignal | null): Promise<PoolRunResult<T>> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const results = new Array<T | undefined>(tasks.length).fill(undefined);
  const errors: Array<{ index: number; error: unknown }> = [];
  const pending = tasks.map((_, index) => index);
  const domainBusy = new Map<string, number>();
  let inFlight = 0;
  let settledCount = 0;
  let aborted = false;

  const startable = (): number | null => {
    for (let k = 0; k < pending.length; k++) {
      const index = pending[k]!;
      const domain = tasks[index]!.domain;
      if (!domain || (domainBusy.get(domain) ?? 0) === 0) return index;
    }
    return null;
  };

  return new Promise<PoolRunResult<T>>((resolve) => {
    const maybeFinish = () => {
      if (settledCount === tasks.length) resolve({ results, errors });
    };
    const pump = () => {
      while (!aborted && !signal?.aborted && inFlight < limit) {
        const index = startable();
        if (index === null) return;
        pending.splice(pending.indexOf(index), 1);
        const task = tasks[index]!;
        const domain = task.domain;
        if (domain) domainBusy.set(domain, (domainBusy.get(domain) ?? 0) + 1);
        inFlight += 1;
        task.work()
          .then((value) => { results[index] = value; })
          .catch((error: unknown) => { errors.push({ index, error }); })
          .finally(() => {
            if (domain) domainBusy.set(domain, Math.max(0, (domainBusy.get(domain) ?? 1) - 1));
            inFlight -= 1;
            settledCount += 1;
            pump();
            maybeFinish();
          });
      }
      if (signal?.aborted) aborted = true;
      // Aborted (or nothing startable while all remaining domains are busy):
      // wait for in-flight completions; pump() re-runs from each .finally().
      if (inFlight === 0) {
        // Nothing running and we cannot start: the rest never ran.
        settledCount = tasks.length;
        resolve({ results, errors });
      }
    };
    pump();
  });
}

// ---------------------------------------------------------------------
// HTTP-first static acquisition
// ---------------------------------------------------------------------

export type StaticDecision =
  | "static_used"          // fetched, parsed, non-trivial content — browser skipped
  | "static_insufficient"  // fetched but nothing usable extracted — escalate
  | "rendering_required"   // URL/page class known to need a real browser
  | "static_failed";       // fetch error / non-OK / non-HTML — escalate

export interface StaticPageRead {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  title: string;
  headings: string[];
  text: string;
  links: Array<{ name: string; url: string }>;
  emails: string[];
  phones: string[];
  jsonLdTypes: string[];
  jsonLdBlocks: unknown[];
  html: boolean;
  /** Cheap usability check: status 200 + text/html + non-trivial content. */
  staticUsable: boolean;
  decision: StaticDecision;
  error?: string;
}

export type StaticFetch = (url: string, init?: { signal?: AbortSignal | null }) => Promise<Response>;

const TEXT_SLICE = 18_000;
const LINK_CAP = 80;
/** Minimum extracted text for "non-trivial content". */
const MIN_TEXT_CHARS = 400;

/**
 * Hosts whose candidate pages are genuinely JS-dependent: HTTP returns a
 * shell with no readable evidence. needsBrowser() behavior for these sources
 * is preserved — acquisition goes straight to the browser.
 */
const RENDER_REQUIRED_HOSTS: RegExp[] = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)(x\.com|twitter\.com)$/i,
  /(^|\.)wellfound\.com$/i,
  /(^|\.)glassdoor\.com$/i,
  /(^|\.)crunchbase\.com$/i,
  /(^|\.)indeed\.com$/i,
];

export function requiresRendering(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return RENDER_REQUIRED_HOSTS.some((re) => re.test(host));
  } catch {
    return true; // unparseable URL — let the browser/ladder handle it
  }
}

const ENTITY_DECODE: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_DECODE[m] ?? m);
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

export function extractEmails(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [])].slice(0, 10);
}

export function extractPhones(text: string): string[] {
  const raw = text.match(/(?:\+?\d[\d .()/-]{7,}\d)/g) ?? [];
  return [...new Set(raw.map((p) => p.trim()).filter((p) => p.replace(/\D/g, "").length >= 9))].slice(0, 5);
}

function extractLinks(html: string, baseUrl: string): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  const re = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && out.length < LINK_CAP) {
    const href = (match[1] ?? match[2] ?? "").trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      out.push({
        url: url.href,
        name: stripTags(match[3] ?? "").slice(0, 120) || url.hostname,
      });
    } catch { /* malformed href — skip */ }
  }
  return out;
}

function extractJsonLd(html: string): { blocks: unknown[]; types: string[] } {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try { blocks.push(JSON.parse(match[1]!.trim())); } catch { /* malformed JSON-LD — skip */ }
  }
  const types: string[] = [];
  for (const block of blocks) {
    const stack: unknown[] = [block];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        const type = rec["@type"];
        if (typeof type === "string") types.push(type);
        if (Array.isArray(type)) types.push(...type.filter((t): t is string => typeof t === "string"));
        for (const key of ["@graph", "mainEntity", "itemListElement"]) {
          if (rec[key] !== undefined) stack.push(rec[key]);
        }
      }
    }
  }
  return { blocks, types: [...new Set(types)].slice(0, 20) };
}

/**
 * HTTP fetch + extract one candidate page. Cheap static-usability check:
 * status 200 + text/html + non-trivial extracted content. The decision is
 * recorded on the read (and by callers in diagnostics).
 */
export async function fetchStaticPage(
  url: string,
  args: { signal?: AbortSignal | null; fetchPage?: StaticFetch } = {},
): Promise<StaticPageRead> {
  const doFetch = args.fetchPage ?? ((u, init) => resilientFetch(u, { signal: init?.signal ?? undefined, retries: 1, retryDelayMs: 250 }));
  const base: StaticPageRead = {
    requestedUrl: url, finalUrl: url, status: 0, contentType: null, title: "",
    headings: [], text: "", links: [], emails: [], phones: [], jsonLdTypes: [],
    jsonLdBlocks: [], html: false, staticUsable: false, decision: "static_failed",
  };
  if (requiresRendering(url)) return { ...base, decision: "rendering_required", error: "rendering_required_page_class" };
  let res: Response;
  try {
    throwIfAborted(args.signal);
    res = await doFetch(url, { signal: args.signal });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    return { ...base, decision: "static_failed", error: error instanceof Error ? error.message : String(error) };
  }
  throwIfAborted(args.signal);
  const contentType = res.headers.get("content-type");
  if (!res.ok) {
    return { ...base, finalUrl: res.url || url, status: res.status, contentType, decision: "static_failed", error: `HTTP ${res.status}` };
  }
  const body = await res.text().catch(() => "");
  throwIfAborted(args.signal);
  const html = !!contentType && /text\/html|application\/xhtml\+xml/i.test(contentType) ||
    (!contentType && /<html[\s>]/i.test(body.slice(0, 2000)));
  const text = stripTags(body).slice(0, TEXT_SLICE);
  const headings: string[] = [];
  const headingRe = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(body)) && headings.length < 12) {
    const value = stripTags(hm[1] ?? "").slice(0, 160);
    if (value) headings.push(value);
  }
  const { blocks, types } = extractJsonLd(body);
  const emails = extractEmails(text);
  const phones = extractPhones(text);
  const links = extractLinks(body, res.url || url);
  const nonTrivial = text.length >= MIN_TEXT_CHARS || emails.length > 0 || phones.length > 0 || types.length > 0;
  const staticUsable = html && nonTrivial;
  const decision: StaticDecision = !html || !nonTrivial ? "static_insufficient" : "static_used";
  return {
    requestedUrl: url,
    finalUrl: res.url || url,
    status: res.status,
    contentType,
    title: stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "")).slice(0, 200),
    headings, text, links, emails, phones, jsonLdTypes: types, jsonLdBlocks: blocks,
    html, staticUsable, decision,
  };
}

/** Adapt a static read onto the browser PageSnapshot contract so the exact same evidence pipeline applies. */
export function staticPageToSnapshot(read: StaticPageRead): PageSnapshot {
  return {
    url: read.finalUrl,
    title: read.title,
    pageType: "unknown",
    headings: read.headings,
    visibleRelevantText: read.text,
    interactiveElements: [],
    links: read.links.map((link, i) => ({ ref: `l${i}`, name: link.name, url: link.url })),
    selectedFilters: [],
    loadingState: "complete",
    friction: [],
    screenshotRef: null,
  };
}
