// =====================================================================
// Community + public-tender sources
//
// Added because the social platforms (Instagram/Facebook/X/LinkedIn) are
// structurally capped: we reach them only through SearXNG dorks, and the free
// upstream engines suspend after ~20 queries/minute. No amount of tuning gets
// volume out of a metasearch dork. These sources have REAL feeds, so they give
// volume without fighting a rate limiter.
//
// Every endpoint here was probed live on 2026-07-31 before being included —
// three earlier attempts shipped sources that returned nothing because the
// endpoint had changed (PullPush 14 months stale, Lever tokens unguessable,
// Bluesky now auth-only). Nothing goes in this file unverified.
//
//   • DISCOURSE — thousands of real communities run it, and every one exposes
//     /latest.json with no key. This is the biggest untapped surface available.
//   • PRODUCT HUNT — RSS, 50 items, makers launching (they need marketing,
//     design, content right after launch).
//   • UK CONTRACTS FINDER — OCDS tender feed. Real procurement with a NAMED
//     BUYER on every row, which makes it the strongest Companies source we
//     have: an organisation publicly committing budget.
// =====================================================================
import type { Lead } from "../scoring";
import { isRecent, type ExpandedQueries } from "./query-expander";
import { classifyDemand, matchesCraft, personNoun } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 9000;
const CACHE_MS = 5 * 60_000;

const cache = new Map<string, { at: number; body: string }>();

async function fetchCached(url: string, accept = "application/json"): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const body = await res.text();
    cache.set(url, { at: Date.now(), body });
    return body;
  } catch {
    return "";
  }
}

function craftTermsOf(qx: ExpandedQueries): string[] {
  return [qx.skill, qx.role, ...(qx.relatedSkills ?? [])]
    .flatMap((t) => (t || "").split(/\s*\/\s*/))
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function relativeAge(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Discourse ───────────────────────────────────────────────────────────────
//
// Curated because a Discourse instance is only useful if its members BUY the
// kind of work our users sell. A forum of hobbyists is volume without value.
// Each entry is a real instance verified to answer /latest.json.
const DISCOURSE_FORUMS: Array<{ host: string; label: string }> = [
  { host: "forum.obsidian.md", label: "Obsidian" },
  { host: "forum.ghost.org", label: "Ghost" },
  { host: "forum.level1techs.com", label: "Level1Techs" },
  { host: "community.openai.com", label: "OpenAI" },
  { host: "meta.discourse.org", label: "Discourse" },
  { host: "forum.bubble.io", label: "Bubble" },
  { host: "discuss.python.org", label: "Python" },
  { host: "forum.djangoproject.com", label: "Django" },
  { host: "community.home-assistant.io", label: "Home Assistant" },
  { host: "community.n8n.io", label: "n8n" },
  { host: "community.wanikani.com", label: "WaniKani" },
  { host: "discuss.streamlit.io", label: "Streamlit" },
  { host: "community.grafana.com", label: "Grafana" },
  { host: "discourse.mozilla.org", label: "Mozilla" },
  { host: "discuss.elastic.co", label: "Elastic" },
  { host: "forum.rclone.org", label: "rclone" },
  { host: "forum.snapcraft.io", label: "Snapcraft" },
  { host: "answers.netlify.com", label: "Netlify" },
  { host: "discuss.hashicorp.com", label: "HashiCorp" },
  { host: "community.retool.com", label: "Retool" },
  { host: "forum.gitlab.com", label: "GitLab" },
  { host: "community.latenode.com", label: "Latenode" },
  { host: "community.temporal.io", label: "Temporal" },
  { host: "discuss.circleci.com", label: "CircleCI" },
  { host: "forum.uipath.com", label: "UiPath" },
  { host: "community.make.com", label: "Make" },
];

type DiscourseTopic = {
  id: number;
  title: string;
  slug: string;
  created_at: string;
  excerpt?: string;
  pinned?: boolean;
  last_poster_username?: string;
  posters?: Array<{ username?: string; description?: string; extras?: string | null }>;
};

/**
 * Poll Discourse communities for demand posts.
 *
 * `?order=created` matters: the default /latest.json ordering floats pinned
 * welcome threads to the top (measured: a 40,000-hour-old "Welcome to the
 * Ghost Community" was the first row), which would fill results with permanent
 * stickies instead of fresh asks.
 */
export async function searchDiscourse(qx: ExpandedQueries): Promise<SourceLead[]> {
  const terms = craftTermsOf(qx);
  if (!terms.length) return [];
  const out: SourceLead[] = [];
  // Forum asks name the person ("need a designer"), not the field — see
  // personNoun. `qx.skill` alone searched these forums for "design".
  const craft = personNoun(qx.skill, qx.role);

  // Ask each forum for the demand, don't poll its front page and hope.
  //
  // This used to read /latest.json?order=created — the ~30 newest topics per
  // forum — and then filter those for demand + craft. The probability that
  // CircleCI's 30 newest threads contain "need a designer" is ~0, so this
  // source returned 0 on every run since it was written. /search.json actually
  // queries the forum's index; `order:latest` keeps the recency guarantee that
  // motivated `order=created` in the first place.
  const queries = [
    `${craft} order:latest`,
    `need ${craft} order:latest`,
    `looking for ${craft} order:latest`,
  ].filter(() => craft.length >= 3);

  const pages = await Promise.all(
    DISCOURSE_FORUMS.flatMap((f) =>
      queries.map(async (q) => ({
        forum: f,
        body: await fetchCached(`https://${f.host}/search.json?q=${encodeURIComponent(q)}`),
      })),
    ),
  );

  const seen = new Set<string>();
  for (const { forum, body } of pages) {
    if (!body) continue;
    let topics: DiscourseTopic[] = [];
    try {
      const d = JSON.parse(body) as {
        topics?: DiscourseTopic[];
        topic_list?: { topics?: DiscourseTopic[] };
      };
      // /search.json returns a flat `topics`; /latest.json nests under
      // topic_list. Accept both so the parser survives either endpoint.
      topics = d.topics ?? d.topic_list?.topics ?? [];
    } catch {
      continue;
    }

    for (const t of topics) {
      if (t.pinned) continue; // permanent stickies are never a lead
      if (!t.created_at || !isRecent(t.created_at, 14)) continue;
      const url = `https://${forum.host}/t/${t.slug}/${t.id}`;
      if (seen.has(url)) continue;

      const excerpt = (t.excerpt || "").replace(/<[^>]+>/g, " ").trim();
      const verdict = classifyDemand({ title: t.title, body: excerpt });
      if (!verdict.isDemand) continue;

      // TITLE ONLY — matching the excerpt is the trap that has bitten four
      // times across Greenhouse, Reddit, Freelancer and Lemmy.
      const matched = matchesCraft(t.title, terms);
      if (!matched) continue;
      seen.add(url);

      const op =
        t.posters?.find((p) => /original poster/i.test(p.description || ""))?.username ||
        t.posters?.[0]?.username ||
        t.last_poster_username;

      out.push({
        source: "discourse",
        platform: "Community forum",
        platform_label: forum.label,
        title: t.title.slice(0, 200),
        snippet: (excerpt || t.title).slice(0, 400),
        full_post_url: `https://${forum.host}/t/${t.slug}/${t.id}`,
        author: op || undefined,
        author_url: op ? `https://${forum.host}/u/${op}` : undefined,
        posted_at: t.created_at,
        posted_at_relative: relativeAge(t.created_at),
        source_confidence: 74,
        signal_type: "direct_intent",
        intentBoost: verdict.boost,
        match_reasons: [verdict.reason, `Mentions "${matched}"`, `${forum.label} community`],
        why_match: `${verdict.reason} — ${forum.label} community`,
      });
    }
  }
  return out;
}

// ── Product Hunt ────────────────────────────────────────────────────────────

/**
 * Makers who just launched. This is a LEADING INDICATOR, not direct intent —
 * nobody on Product Hunt is saying "I need a designer", but a team that shipped
 * yesterday needs marketing, content and design imminently. Marked as such so
 * the scorer can never rank it as an active ask.
 */
export async function searchProductHunt(qx: ExpandedQueries): Promise<SourceLead[]> {
  const body = await fetchCached("https://www.producthunt.com/feed", "application/rss+xml");
  if (!body) return [];
  const terms = craftTermsOf(qx);
  const out: SourceLead[] = [];

  // Product Hunt serves ATOM (<feed>/<entry>), not RSS (<channel>/<item>).
  // Splitting on <item> found nothing — verified 2026-07-31: the document
  // opens `<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom">`.
  for (const block of body.split("<entry>").slice(1, 40)) {
    const title = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/
      .exec(block)?.[1]
      ?.trim();
    // Atom puts the URL in an attribute, not element text.
    const link = (/<link[^>]+href="([^"]+)"/.exec(block)?.[1] ?? "").replace(/&amp;/g, "&");
    const pub =
      /<published>([\s\S]*?)<\/published>/.exec(block)?.[1]?.trim() ??
      /<updated>([\s\S]*?)<\/updated>/.exec(block)?.[1]?.trim();
    const desc = (
      /<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/.exec(block)?.[1] ??
      /<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/.exec(block)?.[1] ??
      ""
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !link) continue;

    const iso = pub ? new Date(pub).toISOString() : "";
    if (iso && !isRecent(iso, 3)) continue;

    // Relevance here is about the PRODUCT's space, not a stated need.
    if (terms.length && !matchesCraft(`${title} ${desc}`, terms)) continue;

    out.push({
      source: "producthunt",
      platform: "Product Hunt",
      platform_label: "Product Hunt launch",
      title: title.slice(0, 200),
      snippet: desc.slice(0, 400) || title,
      full_post_url: link,
      posted_at: iso || undefined,
      posted_at_relative: iso ? relativeAge(iso) : undefined,
      source_confidence: 62,
      // Just-launched ≠ actively asking. Hard-capped to a leading indicator so
      // it can never be presented as someone waiting for a reply.
      signal_type: "leading_indicator",
      intentBoost: 8,
      match_reasons: ["Launched recently — likely needs launch support"],
      why_match: "Recently launched product, likely in-market soon",
    });
  }
  return out;
}

// ── UK public tenders (OCDS) ────────────────────────────────────────────────

type OcdsRelease = {
  date?: string;
  buyer?: { name?: string };
  tender?: {
    title?: string;
    description?: string;
    value?: { amount?: number; currency?: string };
  };
  ocid?: string;
};

/**
 * UK Contracts Finder, Open Contracting Data Standard feed.
 *
 * The strongest COMPANIES source available: every row is an organisation
 * publicly committing budget, with a named buyer and often a value. Free, no
 * key, and updated daily — probed 2026-07-31 and it returned tenders dated
 * that same day.
 */
export async function searchPublicTenders(qx: ExpandedQueries): Promise<SourceLead[]> {
  const terms = craftTermsOf(qx);
  if (!terms.length) return [];
  const body = await fetchCached(
    "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?stages=tender&limit=100",
  );
  if (!body) return [];

  let releases: OcdsRelease[] = [];
  try {
    releases = (JSON.parse(body) as { releases?: OcdsRelease[] }).releases ?? [];
  } catch {
    return [];
  }

  const out: SourceLead[] = [];
  for (const r of releases) {
    const t = r.tender;
    const title = t?.title?.trim();
    const buyer = r.buyer?.name?.trim();
    if (!title || !buyer) continue;
    if (r.date && !isRecent(r.date, 7)) continue;

    const desc = (t?.description || "").replace(/\s+/g, " ").trim();
    const matched = matchesCraft(`${title} ${desc}`, terms);
    if (!matched) continue;

    const value = t?.value?.amount;
    out.push({
      source: "tenders",
      platform: "Public tender",
      platform_label: buyer,
      title: title.slice(0, 200),
      snippet: desc.slice(0, 400) || title,
      // Contracts Finder has no stable per-notice permalink in the OCDS feed,
      // so we link to the search UI scoped to this notice's id.
      full_post_url: r.ocid
        ? `https://www.contractsfinder.service.gov.uk/Search?keywords=${encodeURIComponent(r.ocid)}`
        : "https://www.contractsfinder.service.gov.uk/Search",
      author: buyer,
      posted_at: r.date,
      posted_at_relative: r.date ? relativeAge(r.date) : undefined,
      source_confidence: 88,
      signal_type: "direct_intent",
      has_budget: typeof value === "number" && value > 0,
      is_decision_maker: true,
      intentBoost: 20,
      match_reasons: [
        "Public tender — budget already committed",
        `Mentions "${matched}"`,
        value ? `Value ${t?.value?.currency ?? ""} ${Math.round(value).toLocaleString()}` : "",
      ].filter(Boolean),
      why_match: `${buyer} published a tender for this work`,
    });
  }
  return out;
}

// ── TED EU tenders (keyless) ────────────────────────────────────────────────

/**
 * EU Tenders Electronic Daily — active notices. Buyer orgs populate Companies;
 * notice titles populate Posts.
 */
export async function searchTedTenders(qx: ExpandedQueries): Promise<SourceLead[]> {
  const terms = craftTermsOf(qx);
  if (!terms.length) return [];
  const craft = personNoun(qx.skill, qx.role) || qx.skill || "";
  const q = craft.length >= 3 ? craft : terms[0];

  let notices: Array<{
    "notice-title"?: string | Record<string, string>;
    "publication-date"?: string;
    "buyer-name"?: string | string[];
    "notice-id"?: string;
    links?: { html?: string };
  }> = [];

  try {
    const res = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        query: q,
        page: 1,
        limit: 50,
        scope: "ACTIVE",
        fields: ["notice-title", "publication-date", "buyer-name", "notice-id", "links"],
      }),
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { notices?: typeof notices };
    notices = data.notices ?? [];
  } catch {
    return [];
  }

  const out: SourceLead[] = [];
  for (const n of notices) {
    const titleRaw = n["notice-title"];
    const title =
      typeof titleRaw === "string"
        ? titleRaw
        : titleRaw
          ? Object.values(titleRaw)[0] || ""
          : "";
    const buyerRaw = n["buyer-name"];
    const buyer = Array.isArray(buyerRaw) ? buyerRaw[0] : buyerRaw;
    if (!title?.trim()) continue;
    const pub = n["publication-date"];
    if (pub && !isRecent(pub, 14)) continue;
    const matched = matchesCraft(`${title} ${buyer || ""}`, terms);
    if (!matched) continue;
    const id = n["notice-id"] || title;
    const link =
      n.links?.html ||
      (id
        ? `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(String(id))}`
        : "https://ted.europa.eu/");
    out.push({
      source: "tenders",
      platform: "TED EU tender",
      platform_label: buyer || "EU buyer",
      title: title.slice(0, 200),
      snippet: `${buyer ? `Buyer: ${buyer}\n` : ""}${title}`.slice(0, 400),
      full_post_url: link,
      author: buyer || undefined,
      posted_at: pub || undefined,
      posted_at_relative: pub ? relativeAge(pub) : undefined,
      source_confidence: 86,
      signal_type: "direct_intent",
      is_decision_maker: true,
      has_budget: true,
      intentBoost: 18,
      match_reasons: ["EU TED public tender", `Mentions "${matched}"`],
      why_match: `${buyer || "EU buyer"} published a TED notice`,
    });
  }
  return out;
}
