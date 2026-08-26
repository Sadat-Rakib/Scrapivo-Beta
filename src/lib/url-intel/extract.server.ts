/**
 * URL intelligence — paste a website, get a validated structured profile.
 * Free-first fetch stack: direct fetch → Crawl4AI worker → stealth worker.
 * Deterministic parsing (JSON-LD / meta / mailto / tel) runs first; the AI
 * router fills gaps and generates follow-ups. Every AI payload passes zod
 * validation — invalid output retries the next provider (hallucination gate).
 */
import * as cheerio from "cheerio";
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import { WebsiteIntelSchema, FollowUpsSchema, type WebsiteIntel, type FollowUps } from "./schema";

export type RawPage = { url: string; html: string; text: string; title: string };

async function directFetch(url: string): Promise<RawPage | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct && !/html|xml|text/i.test(ct)) return null;
    const html = (await res.text()).slice(0, 500_000);
    return { url: res.url || url, html, text: "", title: "" };
  } catch {
    return null;
  }
}

async function workerFetch(url: string): Promise<RawPage | null> {
  try {
    const { fetchPageContent } = await import("@/lib/search/page-enrichment.server");
    const page = await fetchPageContent(url);
    if (!page) return null;
    const text = (page.text || page.markdown || "").slice(0, 60_000);
    if (!text) return null;
    // Text-only shell keeps downstream cheerio/regex paths uniform.
    return {
      url: page.url || url,
      html: `<html><body>${text.replace(/[<>]/g, " ")}</body></html>`,
      text,
      title: page.title || "",
    };
  } catch {
    return null;
  }
}

export async function fetchPageForIntel(url: string): Promise<RawPage | null> {
  return (await directFetch(url)) ?? (await workerFetch(url));
}

// ── deterministic extraction ────────────────────────────────────────────────

function jsonLdBlocks($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  // Walk nested structures so @graph containers and arrays-of-entities resolve.
  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== "object" || depth > 4) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if ("@type" in obj) blocks.push(obj);
    for (const key of ["@graph", "mainEntity", "itemListElement", "hasPart"]) {
      if (key in obj) walk(obj[key], depth + 1);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).contents().text() as unknown as string));
    } catch {
      /* malformed ld+json */
    }
  });
  return blocks;
}

function metaContent($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const sel of selectors) {
    const v = $(sel).attr("content")?.trim();
    if (v) return v.slice(0, 400);
  }
  return null;
}

function firstLink($: cheerio.CheerioAPI, re: RegExp): string | null {
  let out: string | null = null;
  $("a[href]").each((_, el) => {
    if (out) return;
    const href = $(el).attr("href") || "";
    if (re.test(href)) out = href.startsWith("http") ? href : `https://${href.replace(/^\/+/, "")}`;
  });
  return out;
}

/** Deterministic profile from structured markup + contact links. */
export function parseDeterministic(page: RawPage): Partial<WebsiteIntel> & { textLen: number } {
  const $ = cheerio.load(page.html);
  const ld = jsonLdBlocks($).filter(
    (b) => typeof b["@type"] === "string" || Array.isArray(b["@type"]),
  );
  const org = ld.find((b) =>
    /organization|company|localbusiness|fund|product/i.test(String(b["@type"])),
  );
  const person = ld.find((b) => String(b["@type"]).toLowerCase() === "person");

  const name =
    (typeof org?.name === "string" && org.name.trim()) ||
    (typeof person?.name === "string" && person.name.trim()) ||
    $('[itemprop="name"]').first().attr("content")?.trim() ||
    $('[itemscope] [itemprop="name"]').first().text().trim() ||
    metaContent($, ['meta[property="og:site_name"]', 'meta[name="application-name"]']) ||
    $("title")
      .first()
      .text()
      .split(/[|\u2013\u2014\-·]/)[0]
      .trim() ||
    null;

  const description =
    (typeof org?.description === "string" && org.description.trim()) ||
    (typeof person?.description === "string" && (person.description as string).trim()) ||
    $('[itemprop="description"]').first().attr("content")?.trim() ||
    $('[itemprop="description"]').first().text().trim() ||
    metaContent($, ['meta[name="description"]', 'meta[property="og:description"]']);

  const industry =
    metaContent($, ['meta[property="og:type"]', 'meta[name="industry"]']) ||
    (typeof org?.["@type"] === "string" ? String(org["@type"]) : null);

  const location =
    (() => {
      const addr = org?.address as
        | { addressLocality?: string; addressRegion?: string; addressCountry?: string }
        | undefined;
      if (addr) {
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(
          Boolean,
        );
        if (parts.length) return parts.join(", ");
      }
      return null;
    })() || metaContent($, ['meta[name="geo.region"]', 'meta[name="geo.placename"]']);

  const emails = new Set<string>();
  for (const m of page.html.matchAll(
    /mailto:([a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
  )) {
    emails.add(m[1].toLowerCase());
  }
  const phones = new Set<string>();
  for (const m of page.html.matchAll(/tel:([+\d()\s.-]{7,})/gi)) phones.add(m[1].trim());

  const linkedin = firstLink($, /linkedin\.com\/(company|in)\//i);
  // twitter:site meta often carries the handle even when no footer link exists.
  const twMeta = metaContent($, ['meta[name="twitter:site"]']);
  const twitter =
    firstLink($, /(?:twitter\.com|x\.com)\//i) ??
    (twMeta
      ? `https://twitter.com/${twMeta.replace(/^https?:\/\/(?:twitter|x)\.com\//, "").replace(/^@/, "")}`
      : null);
  const github = firstLink($, /github\.com\//i);

  const bodyText = ($("body").text() || page.text || "").replace(/\s+/g, " ").trim();

  return {
    name: name || undefined,
    description: description || undefined,
    industry: industry || undefined,
    location: location || undefined,
    emails: [...emails].slice(0, 5),
    phones: [...phones].slice(0, 3),
    linkedin: linkedin || undefined,
    twitter: twitter || undefined,
    github: github || undefined,
    textLen: bodyText.length,
  } as Partial<WebsiteIntel> & { textLen: number };
}

// ── AI extraction with validation gate ─────────────────────────────────────

const EXTRACT_SYSTEM = `You extract structured company/person/fund profiles from website content. Return ONLY a JSON object with these exact keys: name, kind ("company"|"person"|"fund"|"product"|"unknown"), industry, description (<=2 sentences), location, emails (array), phones (array), linkedin (URL or null), twitter (URL or null), github (URL or null), skills (array of up to 12 skill keywords found, for portfolios/resumes), sectors (array of up to 4 sector keywords), stage_hint (funding stage hint or null). Use ONLY facts present in the content — never invent values. Use null for unknown strings and [] for unknown arrays.`;

async function aiExtract(
  text: string,
  variant: string,
  pageTitle?: string,
): Promise<WebsiteIntel | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await aiComplete({
        task: "extract",
        system:
          EXTRACT_SYSTEM +
          (attempt === 1
            ? " REMINDER: output must be a single valid JSON object matching the keys exactly; no prose."
            : ""),
        user: `Variant: ${variant}\nPage title: ${pageTitle ?? "(none)"}\n\nPAGE CONTENT:\n${text.slice(0, 20_000)}`,
        maxTokens: 900,
        temperature: attempt === 0 ? 0 : 0.1,
      });
      const parsed = safeJsonParse<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("unparseable AI JSON");
      const result = WebsiteIntelSchema.safeParse(parsed);
      if (!result.success)
        throw new Error(`schema: ${result.error.issues[0]?.message ?? "invalid"}`);
      return result.data;
    } catch (e) {
      lastError = e;
    }
  }
  console.warn("[url-intel] AI extraction failed validation:", String(lastError).slice(0, 140));
  return null;
}

/** Merge deterministic + AI layers; deterministic wins on conflicts. */
function mergeIntel(
  det: ReturnType<typeof parseDeterministic>,
  ai: WebsiteIntel | null,
): WebsiteIntel {
  const pick = <T>(a: T | undefined | null, b: T | undefined | null): T | null =>
    (a !== undefined && a !== null && a !== "" ? a : (b ?? null)) as T | null;
  const base: WebsiteIntel = {
    name: pick(det.name, ai?.name),
    kind: ai?.kind ?? "unknown",
    industry: pick(det.industry, ai?.industry),
    description: pick(det.description, ai?.description),
    location: pick(det.location, ai?.location),
    emails: det.emails?.length ? det.emails : (ai?.emails ?? []),
    phones: det.phones?.length ? det.phones : (ai?.phones ?? []),
    linkedin: pick(det.linkedin, ai?.linkedin),
    twitter: pick(det.twitter, ai?.twitter),
    github: pick(det.github, ai?.github),
    skills: ai?.skills ?? [],
    sectors: ai?.sectors ?? [],
    stage_hint: ai?.stage_hint ?? null,
  };
  return WebsiteIntelSchema.parse(base);
}

/** SearXNG (self-hosted, free) snippet enrichment for thin/JS-walled pages.
 *  Many instances disable format=json, so we parse the HTML response.
 *  Fail-soft: any error returns null and the pipeline continues. */
async function searxngEnrich(query: string): Promise<string | null> {
  const base = process.env.SEARXNG_URL?.trim();
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300_000);
    // Result blocks: <article class="result ..."> <h3><a>title</a></h3> <p>content</p>
    const snippets: string[] = [];
    const articleRe = /<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    const tagRe = /<[^>]+>/g;
    let m: RegExpExecArray | null;
    while ((m = articleRe.exec(html)) && snippets.length < 5) {
      const block = m[1];
      const title = /<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "";
      const content = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "";
      const clean = `${title.replace(tagRe, "").trim()}. ${content.replace(tagRe, " ").replace(/\s+/g, " ").trim()}`.trim();
      if (clean.length > 25) snippets.push(clean);
    }
    if (!snippets.length) return null;
    return snippets.join("\n").slice(0, 3_000);
  } catch {
    return null;
  }
}

export async function extractWebsiteIntel(
  url: string,
  variant: "jobs" | "local" | "investors",
): Promise<{ intel: WebsiteIntel; source: string }> {
  let page = await fetchPageForIntel(url);
  if (!page) {
    // JS-walled or blocked — fall back to SearXNG snippets about the domain.
    const host = url.replace(/^https?:\/\//i, "").split("/")[0];
    const snippets = await searxngEnrich(host);
    if (!snippets) throw new Error(`Could not fetch ${url}`);
    page = {
      url,
      html: `<html><body>${snippets.replace(/[<>]/g, " ")}</body></html>`,
      text: snippets,
      title: host,
    };
  }
  const det = parseDeterministic(page);
  let bodyText =
    cheerio.load(page.html)("body").text().replace(/\s+/g, " ").trim() || page.text || "";

  // Thin page → fold in SearXNG snippets so the AI layer still has substance.
  let searx = false;
  if (bodyText.length < 400) {
    const host = url.replace(/^https?:\/\//i, "").split("/")[0];
    const brand = det.name || host.split(".")[0];
    const snippets = await searxngEnrich(`${brand} ${host} company`);
    if (snippets) {
      bodyText = `${bodyText}\n\nWEB SEARCH CONTEXT ABOUT THIS SITE:\n${snippets}`;
      searx = true;
    }
  }

  let ai: WebsiteIntel | null = null;
  if (bodyText.length > 200) {
    ai = await aiExtract(bodyText, variant, page.title);
  }
  const intel = mergeIntel(det, ai);
  const source = [ai ? "ai" : "deterministic", searx ? "searxng" : null].filter(Boolean).join("+");
  return { intel, source };
}

// ── follow-up questions ─────────────────────────────────────────────────────

export async function generateFollowUps(intel: WebsiteIntel, variant: string): Promise<FollowUps> {
  try {
    const raw = await aiComplete({
      task: "expand",
      system:
        `Given this extracted profile for a ${variant} workflow, produce JSON {"questions": [...up to 4 follow-up questions...], "suggestions": [...up to 4 concrete next steps...]}. ` +
        `Every question MUST reference a specific fact from the profile (its name, industry, sector, location, stage, or skills) and ask the user whether to act on it — ` +
        `e.g. 'Since ${"{name}"} works in ${"{industry}"}, should I search for investors active in that space?' Never ask generic questions that could apply to any site.`,
      user: JSON.stringify(intel).slice(0, 3000),
      maxTokens: 500,
      temperature: 0.3,
    });
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (!parsed) throw new Error("unparseable");
    const result = FollowUpsSchema.safeParse(parsed);
    if (!result.success) throw new Error("schema mismatch");
    return result.data;
  } catch {
    return { questions: [], suggestions: [] };
  }
}
