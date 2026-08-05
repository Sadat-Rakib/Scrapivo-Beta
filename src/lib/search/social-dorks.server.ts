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
    // Second phrasing is informal pay-intent — the half of the market that is
    // not a job post. Measured: without it, LinkedIn only returned hiring-
    // shaped rows and the "I need help / willing to pay" asks never surfaced.
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

/**
 * Run every platform's dorks in parallel. Each platform draws on its own quota,
 * so a slow or suspended one cannot consume another's share.
 */
export async function searchSocialDorks(qx: ExpandedQueries): Promise<SourceLead[]> {
  const raw = (qx.skill || qx.role || "").trim();
  if (raw.length < 3) return [];
  const terms = craftVariants(raw);

  // These dorks are natural-language phrasings ("looking for a X"), so X has to
  // be the PERSON noun — see personNoun, which the fediverse, forum and HN
  // sources now share after each of them hit this same bug independently.
  const craft = personNoun(raw, qx.role);

  const { searchSearxng, searxngResultsToLeads } = await import("./searxng.server");

  // Two waves, and the split matters as much as the platform order.
  //
  // Firing all 12 dorks at once let a platform's SECOND phrasing take the last
  // slot in the minute while another platform's FIRST got nothing — so a search
  // could burn its whole allocation on "need a designer" variants and never ask
  // LinkedIn at all. Every platform's primary dork goes out before any
  // secondary one, so a tight budget degrades to "one phrasing per platform"
  // instead of "no coverage on half the platforms".
  const wave = (n: number) =>
    PLATFORMS.map((p) => ({ spec: p, dork: p.dorks(craft)[n] })).filter((x) => !!x.dork);

  const runOne = async ({ spec, dork }: { spec: PlatformSpec; dork: string }) => {
    try {
      // Empty time range on purpose — see searxng.server.ts.
      let raw = await searchSearxng([dork], 1, "", spec.key);
      // When site:-capable engines are suspended, a soft phrasing without the
      // site: operator still sometimes returns on-platform URLs (host filter
      // in searxngResultsToLeads / urlTest keeps only real posts).
      if (!raw.length && /\bsite:/i.test(dork)) {
        const soft = dork.replace(/\bsite:[^\s)]+/gi, "").replace(/\s+/g, " ").trim();
        if (soft.length > 12) {
          raw = await searchSearxng([soft], 1, "", spec.key);
        }
      }
      return { spec, leads: searxngResultsToLeads(raw, 18) };
    } catch {
      return { spec, leads: [] as Lead[] };
    }
  };

  // Cap concurrency — firing all six platforms at once against a local SearXNG
  // produced connection errors that zeroed social mid-search.
  const runWave = async (items: Array<{ spec: PlatformSpec; dork: string }>) => {
    const out: Array<{ spec: PlatformSpec; leads: Lead[] }> = [];
    for (let i = 0; i < items.length; i += 3) {
      const chunk = await Promise.all(items.slice(i, i + 3).map(runOne));
      out.push(...chunk);
    }
    return out;
  };

  const primary = await runWave(wave(0));
  const secondary = await runWave(wave(1));
  const perPlatform = [...primary, ...secondary];

  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const { spec, leads } of perPlatform) {
    for (const l of leads) {
      const url = l.full_post_url || "";
      // A profile or hub page is not an opportunity — only real posts count.
      if (!url || !spec.urlTest.test(url) || seen.has(url)) continue;

      const title = l.title || "";
      const snippet = l.snippet || "";

      // TITLE-first. SERP titles for social posts carry the post's opening
      // text, which is where the ask lives; the snippet drifts into comments
      // and sidebars. Same trap as Greenhouse/Reddit/Freelancer/RemoteOK.
      if (terms.length && !matchesCraft(title, terms) && !matchesCraft(snippet, terms)) continue;

      const verdict = classifyDemand({ title, body: snippet });
      if (verdict.rejectedAs) continue;
      if (!verdict.isDemand) continue;

      seen.add(url);
      // Empty SearXNG timeRange means these are NOT day-fresh — never stamp
      // freshness_window:"day" (that leaked 2019 tweets under the 24h chip).
      const postedAt =
        l.posted_at || extractDateFromText(`${title} ${snippet}`) || undefined;
      if (postedAt && !isRecent(postedAt, CLIENTS_SOCIAL_MAX_AGE_DAYS)) continue;
      out.push({
        ...l,
        platform: spec.label,
        platform_label: `${spec.label} post`,
        signal_type: "direct_intent",
        source_confidence: 66,
        posted_at: postedAt,
        demand_verified: true,
        // No day window without a real engine time filter — undated only under All.
        intentBoost: verdict.boost || 16,
        match_reasons: [verdict.reason, `${spec.label} public post`],
        why_match: `${verdict.reason} — public ${spec.label} post`,
      } as SourceLead);
    }
  }
  return out;
}
