// =====================================================================
// Social platforms via public search dorks — logged out, no API keys
//
// Why this module exists: LinkedIn/Twitter/Instagram/Facebook had no dedicated
// dork source. Their leads arrived incidentally through `webboolean`, which
// spends its 4-query budget on generic web queries, so a real search produced
// 0-1 social leads even though a LinkedIn dork returns ~60 results standing
// alone (measured 2026-08-02: linkedin 60, facebook 47, twitter 3, instagram 3).
//
// Each platform gets its OWN quota key so they cannot starve each other — the
// budget bug this was written to fix. See SOURCE_QUOTAS in searxng.server.ts.
//
// When SearXNG is down (local without Docker, or Vercel), we fall back to
// hosted Google SERP (Serper → ScrapingDog → SerpAPI) for the same dorks.
//
// Legal posture: this reads a public search index, logged out. We never
// authenticate to any of these platforms, so we never accept their terms —
// the same reasoning the Reddit transport documents at length.
// =====================================================================
import type { Lead } from "../scoring";
import type { ExpandedQueries } from "./query-expander";
import { extractDateFromText, isRecent, CLIENTS_SOCIAL_MAX_AGE_DAYS } from "./query-expander";
import { classifyDemand, craftVariants, matchesCraft, personNoun } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

type PlatformSpec = {
  /** Quota bucket in SOURCE_QUOTAS. */
  key: string;
  label: string;
  /** Built per craft. Keep to 2 — quota is small and precision beats breadth. */
  dorks: (craft: string) => string[];
  /** Reject results that aren't actually on-platform content. */
  urlTest: RegExp;
};

/**
 * Ordered by measured yield, and the order is load-bearing.
 *
 * When the minute's social budget is nearly spent — the normal case for the
 * 2nd and 3rd back-to-back search — only the first few dorks get a live slot.
 * Whichever platform is listed first wins that slot, because the budget check
 * runs synchronously before any await. Measured 2026-08-02 on the same box:
 * linkedin 60 rows, facebook 47, twitter 3, instagram 3. Spending the last slot
 * on Quora instead of LinkedIn is the difference between a handful of leads and
 * none, so yield order it is.
 */
const PLATFORMS: PlatformSpec[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    urlTest: /linkedin\.com\/(posts|feed\/update)/i,
    dorks: (c) => [
      `site:linkedin.com/posts ("looking for a ${c}" OR "need a ${c}" OR "hiring a ${c}")`,
      `site:linkedin.com/posts ("${c}") ("willing to pay" OR "need help with" OR "anyone recommend")`,
    ],
  },
  {
    key: "facebook",
    label: "Facebook",
    urlTest: /facebook\.com\/(groups|posts|permalink|story)/i,
    dorks: (c) => [
      `site:facebook.com/groups ("looking for a ${c}" OR "need a ${c}")`,
      `site:facebook.com ("can anyone recommend a ${c}" OR "looking for someone who") ${c}`,
    ],
  },
  {
    key: "twitter",
    label: "Twitter/X",
    urlTest: /(twitter|x)\.com\/[A-Za-z0-9_]+\/status/i,
    dorks: (c) => [
      `site:x.com ("looking for a ${c}" OR "need a ${c}" OR "hiring a ${c}")`,
      `site:twitter.com ("${c}") ("willing to pay" OR "anyone know a" OR "need help")`,
    ],
  },
  {
    key: "instagram",
    label: "Instagram",
    urlTest: /instagram\.com\/(p|reel)\//i,
    dorks: (c) => [
      `site:instagram.com ("looking for a ${c}" OR "need a ${c}" OR "hiring a ${c}")`,
      `site:instagram.com ("${c}") ("commission" OR "paid" OR "budget")`,
    ],
  },
  {
    key: "threads",
    label: "Threads",
    urlTest: /threads\.(net|com)\/@/i,
    dorks: (c) => [
      `site:threads.net ("looking for a ${c}" OR "need a ${c}")`,
      `site:threads.net ("${c}") ("willing to pay" OR "anyone recommend")`,
    ],
  },
  {
    key: "quora",
    label: "Quora",
    urlTest: /quora\.com\//i,
    dorks: (c) => [
      `site:quora.com ("looking for a ${c}" OR "recommend a ${c}" OR "where can I find a ${c}")`,
      `site:quora.com ("need a ${c}" OR "hiring a ${c}" OR "best ${c} for")`,
    ],
  },
  {
    key: "substack",
    label: "Substack",
    urlTest: /substack\.com\//i,
    dorks: (c) => [
      `site:substack.com ("looking for a ${c}" OR "need a ${c}" OR "hiring a ${c}" OR "we're hiring")`,
      `site:substack.com ("${c}") ("willing to pay" OR "open role" OR "looking to hire")`,
    ],
  },
];

const SERP_PRIORITY_KEYS = ["linkedin", "facebook", "twitter", "instagram"] as const;

type LooseLead = {
  full_post_url?: string;
  title?: string;
  snippet?: string;
  posted_at?: string;
  author?: string;
  author_url?: string;
  source?: string;
};

function ingestPlatformLeads(
  spec: PlatformSpec,
  leads: LooseLead[],
  terms: string[],
  seen: Set<string>,
  out: SourceLead[],
  detectPlatformFromUrl: (url: string) => { source: string; platform: string },
  opts?: { freshness_window?: "day" | "week" },
) {
  for (const l of leads) {
    const url = l.full_post_url || "";
    if (!url || !spec.urlTest.test(url) || seen.has(url)) continue;

    const title = l.title || "";
    const snippet = l.snippet || "";

    if (terms.length && !matchesCraft(title, terms) && !matchesCraft(snippet, terms)) continue;

    const verdict = classifyDemand({ title, body: snippet });
    if (verdict.rejectedAs) continue;
    if (!verdict.isDemand) continue;

    seen.add(url);
    const postedAt =
      l.posted_at || extractDateFromText(`${title} ${snippet}`) || undefined;
    if (postedAt && !isRecent(postedAt, CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;

    const id = detectPlatformFromUrl(url);

    out.push({
      source: id.source || spec.key,
      platform: spec.label,
      platform_label: `${spec.label} post`,
      title,
      snippet,
      full_post_url: url,
      author: l.author,
      author_url: l.author_url,
      signal_type: "direct_intent",
      source_confidence: 66,
      posted_at: postedAt,
      demand_verified: true,
      freshness_window: opts?.freshness_window,
      engagement: 10,
      intentBoost: verdict.boost || 16,
      match_reasons: [verdict.reason, `${spec.label} public post`],
      why_match: `${verdict.reason} — public ${spec.label} post`,
    } as SourceLead);
  }
}

/**
 * Hosted SERP fallback when SearXNG returns nothing (local Docker down / Vercel).
 * Credit-capped: LI / FB / X primary dorks first; IG only if still thin.
 */
async function searchSocialDorksViaSerp(
  craft: string,
  terms: string[],
  seen: Set<string>,
  existing: SourceLead[],
  detectPlatformFromUrl: (url: string) => { source: string; platform: string },
): Promise<SourceLead[]> {
  const { paidDiscoveryEnabled } = await import("./paid-discovery");
  if (!paidDiscoveryEnabled()) return [];
  const { searchGoogleSerp, hasGoogleSerpProvider } = await import("./serp-providers.server");
  if (!hasGoogleSerpProvider()) return [];

  const out: SourceLead[] = [];
  const priority = PLATFORMS.filter((p) =>
    (SERP_PRIORITY_KEYS as readonly string[]).includes(p.key),
  );

  const runDork = async (spec: PlatformSpec, dork: string, window: "day" | "week") => {
    try {
      const data = await searchGoogleSerp(dork, {
        tbs: window === "day" ? "qdr:d" : "qdr:w",
        num: 15,
      });
      if (!data?.organic_results?.length) return;
      const leads: LooseLead[] = data.organic_results.map((r) => ({
        full_post_url: r.link || "",
        title: r.title || "",
        snippet: (r.snippet || "").slice(0, 400),
        posted_at: r.date || undefined,
      }));
      ingestPlatformLeads(spec, leads, terms, seen, out, detectPlatformFromUrl, {
        freshness_window: window,
      });
    } catch {
      /* optional */
    }
  };

  const core = priority.filter((p) => p.key !== "instagram");
  // Week-first: day windows are too sparse for Discover tab volume; day is a
  // second pass only when week already returned something thin.
  await Promise.all(core.map((spec) => runDork(spec, spec.dorks(craft)[0], "week")));

  if (existing.length + out.length < 12) {
    await Promise.all(
      core.map((spec) => {
        const d2 = spec.dorks(craft)[1];
        return d2 ? runDork(spec, d2, "week") : Promise.resolve();
      }),
    );
  }

  if (existing.length + out.length < 8) {
    await Promise.all(core.map((spec) => runDork(spec, spec.dorks(craft)[0], "day")));
  }

  if (existing.length + out.length < 6) {
    const ig = priority.find((p) => p.key === "instagram");
    if (ig) await runDork(ig, ig.dorks(craft)[0], "week");
  }

  if (out.length) {
    console.info(`[social-dorks] Serper path added ${out.length}`);
  }
  return out;
}

/**
 * Run every platform's dorks in parallel. Each platform draws on its own quota,
 * so a slow or suspended one cannot consume another's share.
 */
export async function searchSocialDorks(qx: ExpandedQueries): Promise<SourceLead[]> {
  const raw = (qx.skill || qx.role || "").trim();
  if (raw.length < 3) return [];
  // Include related crafts so "lead generation services" also matches
  // titles that only say "lead gen" / "SDR" / "appointment setting".
  const termSeeds = [raw, qx.role, ...(qx.relatedSkills || []).slice(0, 8)].filter(
    (t): t is string => !!t && t.trim().length >= 3,
  );
  const terms = [...new Set(termSeeds.flatMap((t) => craftVariants(t)))];

  // Prefer a short craft for "looking for a X" dorks — strip trailing services.
  const craftSeed =
    (qx.relatedSkills || []).find((s) => /lead\s*gen/i.test(s)) ||
    raw.replace(/\b(services?|solutions?|agency|consulting)\b/gi, " ").replace(/\s+/g, " ").trim() ||
    raw;
  const craft = personNoun(craftSeed, qx.role);

  const { searchSearxng, searxngResultsToLeads, detectPlatformFromUrl } = await import(
    "./searxng.server",
  );
  const { paidDiscoveryEnabled } = await import("./paid-discovery");

  const wave = (n: number) =>
    PLATFORMS.map((p) => ({ spec: p, dork: p.dorks(craft)[n] })).filter((x) => !!x.dork);

  const runOne = async ({ spec, dork }: { spec: PlatformSpec; dork: string }) => {
    try {
      let rawHits = await searchSearxng([dork], 1, "", spec.key);
      if (!rawHits.length && /\bsite:/i.test(dork)) {
        const soft = dork.replace(/\bsite:[^\s)]+/gi, "").replace(/\s+/g, " ").trim();
        if (soft.length > 12) {
          rawHits = await searchSearxng([soft], 1, "", spec.key);
        }
      }
      return { spec, leads: searxngResultsToLeads(rawHits, 18) };
    } catch {
      return { spec, leads: [] as Lead[] };
    }
  };

  const runWave = async (items: Array<{ spec: PlatformSpec; dork: string }>) => {
    const batch: Array<{ spec: PlatformSpec; leads: Lead[] }> = [];
    for (let i = 0; i < items.length; i += 3) {
      const chunk = await Promise.all(items.slice(i, i + 3).map(runOne));
      batch.push(...chunk);
    }
    return batch;
  };

  // Run hosted SERP in parallel with SearXNG. On Vercel / slow SearXNG the
  // outer withBudget used to kill this entire function before the Serper
  // fallback ever ran — socialdorks stayed at 0 and Discover collapsed.
  const searxSeen = new Set<string>();
  const searxOut: SourceLead[] = [];
  const searxPromise = (async () => {
    const primary = await runWave(wave(0));
    const secondary = await runWave(wave(1));
    for (const { spec, leads } of [...primary, ...secondary]) {
      ingestPlatformLeads(spec, leads, terms, searxSeen, searxOut, detectPlatformFromUrl);
    }
  })();

  const serpSeen = new Set<string>();
  const serpPromise = paidDiscoveryEnabled()
    ? searchSocialDorksViaSerp(craft, terms, serpSeen, [], detectPlatformFromUrl)
    : Promise.resolve([] as SourceLead[]);

  const [, serpExtra] = await Promise.all([searxPromise, serpPromise]);

  const out: SourceLead[] = [...searxOut];
  const seen = new Set(searxSeen);
  for (const l of serpExtra) {
    const u = (l.full_post_url || "").split("?")[0].toLowerCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(l);
  }

  // If paid SERP was off / empty and SearXNG was thin, one last Serper try.
  if (out.length < 4 && paidDiscoveryEnabled() && !serpExtra.length) {
    const late = await searchSocialDorksViaSerp(
      craft,
      terms,
      seen,
      out,
      detectPlatformFromUrl,
    );
    out.push(...late);
  }

  return out;
}
