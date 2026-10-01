// =====================================================================
// News platform monitoring (Phase 2, Task 2.4)
//
// News produces TWO genuinely different signal types that MUST be classified
// and scored differently — this split is a first-class part of extraction, not
// an afterthought, because it is the fork point that protects the whole
// hot/warm trust distinction:
//
//   • direct_hiring_announcement → the article itself states a company is
//     actively hiring a specific role NOW. This is DIRECT intent (same class as
//     a Reddit [Hiring] post): signal_type "direct_intent", NO score cap,
//     eligible for hot.
//   • leading_indicator → funding round / leadership hire / new office /
//     growth narrative that IMPLIES future hiring but states no concrete open
//     role. Identical in kind to Task 2.3's government sources: signal_type
//     "leading_indicator", hard-capped to warm, and ALSO feeds the ATS-check
//     trigger hook (a funding signal is exactly when to go check that company's
//     Ashby/SmartRecruiters board soon).
//
// A single cached LLM call classifies each article at the fork point BEFORE
// anything is scored. Standard new-source pattern (input/output/resilience/
// registration) per ats-sources.server.ts.
// =====================================================================
import type { Lead } from "../scoring";
import { isRecent, isRelevantToSkill, type ExpandedQueries } from "./query-expander";
import { aiComplete, safeJsonParse } from "../ai/router.server";

type SourceLead = Lead & { intentBoost?: number };

type Article = { title: string; url: string; snippet: string; postedAt?: string; outlet: string };

// Small, relevant RSS set. Kept minimal; expand per target vertical later.
const NEWS_FEEDS: Array<{ url: string; outlet: string }> = [
  { url: "https://techcrunch.com/feed/", outlet: "TechCrunch" },
  { url: "https://news.crunchbase.com/feed/", outlet: "Crunchbase News" },
  { url: "https://www.eu-startups.com/feed/", outlet: "EU-Startups" },
  // Funding-event specialists — the highest-reliability leading indicator.
  { url: "https://www.finsmes.com/feed", outlet: "FinSMEs" },
  { url: "https://venturebeat.com/feed/", outlet: "VentureBeat" },
];

const NEWS_TIMEOUT_MS = 9000;
const MAX_ARTICLES_PER_FEED = 20;
const MAX_CLASSIFY = 24;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

function pick(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`),
  );
  return m
    ? m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

async function fetchFeed(feed: { url: string; outlet: string }): Promise<Article[]> {
  const text = await withTimeout(
    (async () => {
      const res = await fetch(feed.url, {
        headers: { "user-agent": "scrapivo/1.0", accept: "application/rss+xml, application/xml" },
      });
      return res.ok ? await res.text() : "";
    })(),
    NEWS_TIMEOUT_MS,
    "",
  );
  if (!text) return [];
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX_ARTICLES_PER_FEED);
  const out: Article[] = [];
  for (const m of items) {
    const b = m[1];
    const title = pick(b, "title");
    const link = (b.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "").trim();
    const desc = pick(b, "description") || pick(b, "content:encoded");
    const pub = pick(b, "pubDate");
    if (!title || !link) continue;
    out.push({
      title,
      url: link,
      snippet: desc.slice(0, 500),
      postedAt: pub ? new Date(pub).toISOString() : undefined,
      outlet: feed.outlet,
    });
  }
  return out;
}

const NEWS_SYSTEM = `You classify company/tech NEWS articles into buyer-signal categories for a lead-discovery tool.

For each article decide ONE category:
- "direct_hiring_announcement" = the article explicitly states a company is ACTIVELY hiring / opening specific roles NOW (e.g. "X is hiring 20 engineers", "company announces open roles"). A concrete present-tense hiring action.
- "leading_indicator" = funding round, acquisition, leadership hire, new office/market, or growth narrative that IMPLIES future hiring/budget but states NO concrete open role right now.
- "none" = neither (product news, opinion, general tech coverage, unrelated).

Also extract the primary COMPANY the signal is about (short name, "" if unclear) and a short EVIDENCE quote.

Be strict: only use "direct_hiring_announcement" when a real, present hiring action is stated. Funding/"raised $X"/"plans to grow" is ALWAYS leading_indicator, never direct.

Respond with strict JSON, no prose/markdown:
{"results":[{"id":"<id>","category":"direct_hiring_announcement|leading_indicator|none","company":"<name>","evidence":"<quote max 140 chars>"}]}`;

function buildUser(articles: Array<Article & { id: string }>): string {
  const items = articles
    .map((a) => `ID: ${a.id}\nTITLE: ${a.title}\nTEXT: ${a.snippet}`.slice(0, 700))
    .join("\n\n---\n\n");
  return `ARTICLES:\n\n${items}`;
}

export type NewsCategory = "direct_hiring_announcement" | "leading_indicator" | "none";
export type NewsClassification = {
  id: string;
  category: NewsCategory;
  company: string;
  evidence: string;
};

/** Classify a batch of articles at the fork point. Exported for verification. */
export async function classifyNewsArticles(
  articles: Array<Article & { id: string }>,
): Promise<Record<string, NewsClassification>> {
  const out: Record<string, NewsClassification> = {};
  if (!articles.length) return out;
  const BATCH = 12;
  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);
    try {
      const content = await aiComplete({
        task: "classify",
        system: NEWS_SYSTEM,
        user: buildUser(batch),
        json: true,
        temperature: 0,
        maxTokens: 1500,
      });
      const parsed = safeJsonParse<{ results?: NewsClassification[] }>(content);
      for (const r of parsed?.results ?? []) {
        if (!r?.id) continue;
        const category: NewsCategory =
          r.category === "direct_hiring_announcement" || r.category === "leading_indicator"
            ? r.category
            : "none";
        out[r.id] = {
          id: r.id,
          category,
          company: (r.company || "").slice(0, 80),
          evidence: (r.evidence || "").slice(0, 200),
        };
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development")
        console.warn("[news-signals] classify batch failed", (err as Error)?.message);
    }
  }
  return out;
}

// ── ATS-check trigger hook (Task 2.4, part b) ──────────────────────────────
// A funding/growth signal is exactly the kind of thing that should prompt
// "go check this company's Ashby/SmartRecruiters/Recruitee board soon". This is
// the extension point: we record the company so a follow-up ATS sweep can pick
// it up (best-effort insert into ats_check_queue if present; always logged).
async function triggerAtsCheck(companies: string[]): Promise<void> {
  const unique = Array.from(new Set(companies.map((c) => c.trim()).filter(Boolean)));
  if (!unique.length) return;
  if (process.env.NODE_ENV === "development") {
    console.info("[news-signals] ATS-check trigger for:", unique.join(", "));
  }
  try {
    const { skipPersistence } = await import("@/lib/persistence-policy.server");
    if (skipPersistence("ats_check_queue")) return;
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    await getAdmin()
      .from("ats_check_queue")
      .upsert(
        unique.map((company) => ({ company, requested_at: new Date().toISOString() })),
        { onConflict: "company" },
      );
  } catch {
    /* table optional — the log above is the durable minimum */
  }
}

export async function searchNewsSignals(qx: ExpandedQueries): Promise<SourceLead[]> {
  const skill = qx.skill || qx.role || "";
  // Gather + lightly pre-filter articles (recent; relevance is loose here since
  // funding/hiring for ANY company is a valid signal, but we keep it on-topic).
  const feeds = await Promise.allSettled(NEWS_FEEDS.map(fetchFeed));
  const articles: Array<Article & { id: string }> = [];
  let idx = 0;
  for (const f of feeds) {
    if (f.status !== "fulfilled") continue;
    for (const a of f.value) {
      if (a.postedAt && !isRecent(a.postedAt, 21)) continue;
      articles.push({ ...a, id: String(idx++) });
      if (articles.length >= MAX_CLASSIFY) break;
    }
    if (articles.length >= MAX_CLASSIFY) break;
  }
  if (!articles.length) return [];

  const labels = await classifyNewsArticles(articles);

  const out: SourceLead[] = [];
  const leadingCompanies: string[] = [];
  for (const a of articles) {
    const label = labels[a.id];
    if (!label || label.category === "none") continue;
    const isDirect = label.category === "direct_hiring_announcement";
    // On-topic gate: direct hiring must relate to the searched skill; leading
    // indicators need skill OR hire/contract language (pure "raised $X" alone
    // is too noisy for clients Discover).
    if (isDirect && skill && !isRelevantToSkill(`${a.title} ${a.snippet}`, skill)) continue;
    if (!isDirect) {
      const text = `${a.title} ${a.snippet}`;
      const hireish =
        /\b(hiring|looking for|contract|freelance|open role|we're hiring|engineers?|developers?)\b/i.test(
          text,
        );
      const fundingOnly =
        /\b(raises?|raised|funding|series [a-d]|seed round|secures? \$)\b/i.test(text) && !hireish;
      if (fundingOnly && skill && !isRelevantToSkill(text, skill)) continue;
      if (!hireish && skill && !isRelevantToSkill(text, skill) && !label.company) continue;
    }

    if (!isDirect) leadingCompanies.push(label.company);

    out.push({
      source: "news",
      platform: `News: ${a.outlet}`,
      title: a.title.slice(0, 200),
      snippet: (label.evidence ? `${label.evidence} — ` : "") + a.snippet.slice(0, 350),
      full_post_url: a.url,
      author: label.company || a.outlet,
      posted_at: a.postedAt || new Date().toISOString(),
      engagement: 20,
      is_decision_maker: false,
      signal_type: isDirect ? "direct_intent" : "leading_indicator",
      // direct announcements get a real hiring boost; leading indicators stay
      // modest AND are hard-capped to warm downstream by the scorer.
      intentBoost: isDirect ? 16 : 8,
    });
  }

  // Leading-indicator companies feed the ATS-check trigger (fire-and-forget).
  void triggerAtsCheck(leadingCompanies);

  return out;
}
