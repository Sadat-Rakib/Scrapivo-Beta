// =====================================================================
// GitHub buyer-intent — issues and discussions where someone says out loud
// that they need what you sell.
//
// Why this source and not the obvious one: stargazer lists are bookmarks, not
// intent (180k yt-dlp stars is noise with extra steps), and the dependents
// graph is HTML-only with ~30 rows a page, so paginating a large repo means
// thousands of sequential fetches for a list that's mostly forks and tutorials.
// What IS high-signal is the search API: `"alternative to X"` and
// `"looking for"` inside an issue body are literal buyer-intent statements with
// an author, a timestamp, and a repo for context. Recency does most of the
// work — a six-month-old complaint is dead, a two-week-old one is a lead.
//
// AUP boundary, and it is a hard one: GitHub's Acceptable Use Policies forbid
// using information from the service — however obtained, API included — for
// spamming, "including for the purposes of selling users' personal information".
// hiQ-line cases protect the COLLECTION of public data; they do not override a
// contract term about downstream USE. So this source deliberately stops at the
// COMPANY level:
//
//   • we keep the org, its website, its stated location, and the issue URL
//   • we NEVER emit a GitHub username as a contact, never read profile emails,
//     never touch the commit-history email trick, never hit /users for contacts
//   • contact resolution happens later, from the company's DOMAIN, via the
//     first-party harvest layer (contact/harvest.server.ts)
//
// That keeps the useful signal — which company, and why now — and leaves the
// part that would be a ToS liability on the table.
// =====================================================================
import type { Lead } from "../scoring";
import type { ExpandedQueries } from "./query-expander";
import { isRecent } from "./query-expander";
import { matchesCraft } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

const API = "https://api.github.com";
const UA = "Scrapivo/1.0 (lead discovery; hello@scrapivo.app)";

/**
 * The search API allows 30 req/min authenticated and only 10/min without a
 * token, so an unauthenticated run gets a much smaller query budget. We
 * throttle below the published limit rather than around it — routing around a
 * stated rate limit is the conduct Reddit's §1201 claim against Perplexity is
 * built on, and the ceiling here is generous enough that there's no reason to.
 */
const MAX_QUERIES_AUTHED = 4;
const MAX_QUERIES_ANON = 2;
const PER_QUERY = 20;
const INTER_QUERY_MS = 1200;
/**
 * Org lookups are a fetch each (cached per owner across the process). The cap
 * has to be generous because MOST issue authors are personal accounts, which we
 * drop by design — so the budget is spent mostly on rejections, and a small cap
 * means the whole source returns nothing. Still well inside the 16s per-source
 * budget: ~20 lookups at ~150ms, run only until MAX_LEADS is reached.
 */
const MAX_ORG_LOOKUPS = 24;
const MAX_LEADS = 10;
const CACHE_MS = 15 * 60_000;
/** A complaint older than this has usually been solved or abandoned. */
const MAX_AGE_DAYS = 45;

const cache = new Map<string, { at: number; items: GitHubIssue[] }>();

type GitHubIssue = {
  html_url: string;
  title: string;
  body?: string | null;
  created_at: string;
  updated_at: string;
  comments: number;
  state: string;
  repository_url: string;
  pull_request?: unknown;
};

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchIssues(q: string): Promise<GitHubIssue[]> {
  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

  try {
    const url = `${API}/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${PER_QUERY}`;
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      // 403 here is the secondary rate limit. Back off; do not retry harder.
      cache.set(q, { at: Date.now(), items: [] });
      return [];
    }
    const data = (await res.json()) as { items?: GitHubIssue[] };
    const items = (data.items ?? []).filter((i) => !i.pull_request);
    cache.set(q, { at: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}

// ── intent phrase templates ─────────────────────────────────────────────────
//
// These are the three patterns worth productizing, parameterised by the user's
// ICP rather than hardcoded to a fixed repo list — the value is in the phrase,
// not in which repo it appears under.
type IntentTemplate = {
  build: (term: string) => string;
  why: string;
  tier: "hot" | "warm";
  boost: number;
  /**
   * True when the template's slot must be a COMPETITOR/TOOL name rather than a
   * skill. `"alternative to Apollo"` is the highest-intent phrase on GitHub;
   * `"alternative to cold outreach"` is a phrase no human has ever typed, and
   * running it just burns a rate-limited query for a guaranteed zero.
   */
  needsCompetitor?: boolean;
};

const TEMPLATES: IntentTemplate[] = [
  {
    // Someone is shopping. This is the single highest-intent phrase on GitHub —
    // but only when the slot is a product name.
    build: (t) => `"alternative to ${t}" in:body,title is:issue`,
    why: "Actively looking to replace a tool",
    tier: "hot",
    boost: 22,
    needsCompetitor: true,
  },
  {
    build: (t) => `"switching from ${t}" in:body is:issue`,
    why: "Already moving off a competitor",
    tier: "hot",
    boost: 22,
    needsCompetitor: true,
  },
  {
    build: (t) => `"looking for" "${t}" in:body is:issue`,
    why: "Explicitly asking for what you do",
    tier: "hot",
    boost: 20,
  },
  {
    build: (t) => `"we need" "${t}" in:body is:issue`,
    why: "Stated a need in an open thread",
    tier: "hot",
    boost: 18,
  },
  {
    build: (t) => `"anyone know a" "${t}" in:body is:issue`,
    why: "Asking peers for a recommendation",
    tier: "warm",
    boost: 14,
  },
  {
    // "Doing it by hand" is the clearest buy-vs-build signal there is.
    build: (t) => `"doing this manually" "${t}" in:body is:issue`,
    why: "Doing it manually today — a buying trigger",
    tier: "warm",
    boost: 12,
  },
  {
    build: (t) => `"is there a tool" "${t}" in:body is:issue`,
    why: "Shopping for a tool in this space",
    tier: "warm",
    boost: 12,
  },
];

/**
 * Curated-list and directory repos. An "Add SendDock" issue on awesome-selfhosted
 * looks exactly like buyer intent to a phrase matcher, but it's a catalogue
 * submission — the org behind the list is not in market for anything.
 */
const REPO_NOISE_RE =
  /^(awesome[-_]|.*[-_]awesome$|.*(?:-|^)(?:list|lists|directory|catalog|catalogue|collection|resources|links|bookmarks|showcase|curated)(?:-|$))/i;

/**
 * Pull competitor/tool names out of the user's own query. "find people looking
 * for an alternative to Apollo" gives us "Apollo" — which is the only slot the
 * highest-intent templates can actually use. Proper nouns only: a lowercase
 * word after "alternative to" is a category, not a product.
 */
export function competitorsFromQuery(raw: string): string[] {
  const out = new Set<string>();
  const triggers =
    /\b(?:alternative(?:s)? to|instead of|switching from|migrating from|moving (?:away )?from|replace|replacing|competitor(?:s)? (?:to|of)|vs\.?|versus|better than|fed up with)\s+/gi;

  for (const m of (raw || "").matchAll(triggers)) {
    const tail = raw.slice(m.index + m[0].length, m.index + m[0].length + 40);
    // A product name: capitalised, or a known lowercase-branded tool shape.
    const name = /^([A-Z][A-Za-z0-9.+-]{1,24}(?:\s+[A-Z][A-Za-z0-9.+-]{1,24})?)/.exec(tail.trim());
    if (name) out.add(name[1].trim());
  }
  return [...out].slice(0, 3);
}

/** Terms that would return the entire site — never search these bare. */
const TOO_BROAD = new Set([
  "web",
  "app",
  "api",
  "code",
  "data",
  "ai",
  "ml",
  "dev",
  "software",
  "tool",
  "development",
  "developer",
  "engineer",
  "design",
  "help",
  "service",
]);

function intentQueries(
  qx: ExpandedQueries,
  sinceISO: string,
  competitors: string[],
): Array<{ q: string; t: IntentTemplate }> {
  const terms = [qx.skill, ...(qx.relatedSkills ?? []).slice(0, 2)]
    .map((t) => (t || "").trim())
    .filter((t) => t.length >= 3 && !TOO_BROAD.has(t.toLowerCase()));
  const tools = competitors.map((c) => c.trim()).filter((c) => c.length >= 3);
  if (!terms.length && !tools.length) return [];

  const out: Array<{ q: string; t: IntentTemplate }> = [];
  // Competitor-slot templates first — they are the highest-intent phrases, and
  // they're the ones the query budget should be spent on when we have names.
  for (const template of TEMPLATES) {
    const slots = template.needsCompetitor ? tools : terms;
    for (const slot of slots.slice(0, 2)) {
      out.push({ q: `${template.build(slot)} created:>${sinceISO}`, t: template });
    }
  }
  return out.sort((a, b) => b.t.boost - a.t.boost);
}

// ── repo → org → company ────────────────────────────────────────────────────

type OrgProfile = {
  login: string;
  name?: string;
  website?: string;
  location?: string;
  type: string;
  public_repos?: number;
  created_at?: string;
};

const orgCache = new Map<string, OrgProfile | null>();

/**
 * Resolve the owner of the repo an issue lives in, and keep it ONLY if it's an
 * organization with a website. Two reasons: a personal account is a person (so
 * it's out of scope by the AUP boundary above), and an org with a website hands
 * the contact layer a domain, which is the whole point of this source.
 */
async function repoOwnerCompany(repositoryUrl: string): Promise<OrgProfile | null> {
  const owner = repositoryUrl.split("/repos/")[1]?.split("/")[0];
  if (!owner) return null;
  if (orgCache.has(owner)) return orgCache.get(owner) ?? null;

  try {
    const res = await fetch(`${API}/orgs/${encodeURIComponent(owner)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      orgCache.set(owner, null); // 404 = a user account, not an org
      return null;
    }
    const d = (await res.json()) as Record<string, unknown>;
    const profile: OrgProfile = {
      login: String(d.login ?? owner),
      name: typeof d.name === "string" ? d.name : undefined,
      website: typeof d.blog === "string" && d.blog.trim() ? d.blog.trim() : undefined,
      location: typeof d.location === "string" ? d.location : undefined,
      type: String(d.type ?? "Organization"),
      public_repos: typeof d.public_repos === "number" ? d.public_repos : undefined,
      created_at: typeof d.created_at === "string" ? d.created_at : undefined,
    };
    orgCache.set(owner, profile);
    return profile;
  } catch {
    orgCache.set(owner, null);
    return null;
  }
}

function domainFromWebsite(website?: string): string | undefined {
  if (!website) return undefined;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    // A personal GitHub Pages site isn't a company domain.
    if (/github\.io$|github\.com$/.test(host)) return undefined;
    return host.includes(".") ? host : undefined;
  } catch {
    return undefined;
  }
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function snippetFrom(issue: GitHubIssue, term: string): string {
  const body = (issue.body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return issue.title;
  // Quote the sentence containing the intent term — that's the evidence.
  const idx = body.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return body.slice(0, 280);
  const start = Math.max(0, body.lastIndexOf(". ", idx) + 1);
  return body.slice(start, start + 300).trim();
}

/**
 * Search GitHub issues for buyer-intent statements.
 *
 * Emits COMPANY-level leads: the org behind the repo, its website, and the
 * issue that shows intent. Contact resolution is a separate, later step that
 * works from the domain — no GitHub identity ever becomes a contact record.
 */
export async function searchGitHubIntent(
  qx: ExpandedQueries,
  /**
   * Competitor/tool names from the user's ICP. Without these the
   * "alternative to X" / "switching from X" templates are skipped entirely —
   * see IntentTemplate.needsCompetitor for why.
   */
  competitors: string[] = [],
): Promise<SourceLead[]> {
  const authed = !!process.env.GITHUB_TOKEN;
  const budget = authed ? MAX_QUERIES_AUTHED : MAX_QUERIES_ANON;

  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const queries = intentQueries(qx, since, competitors).slice(0, budget);
  if (!queries.length) return [];

  // Craft terms used to re-check relevance on what we display (see below).
  const craftTerms = [qx.skill, qx.role, ...(qx.relatedSkills ?? [])]
    .map((t) => (t || "").trim())
    .filter((t) => t.length >= 3);

  const leads: SourceLead[] = [];
  const seenUrls = new Set<string>();
  const seenOrgs = new Set<string>();
  let orgLookups = 0;

  for (let i = 0; i < queries.length && leads.length < MAX_LEADS; i++) {
    const { q, t } = queries[i];
    const items = await searchIssues(q);

    for (const issue of items) {
      if (leads.length >= MAX_LEADS || orgLookups >= MAX_ORG_LOOKUPS) break;
      if (seenUrls.has(issue.html_url)) continue;
      if (!isRecent(issue.created_at, MAX_AGE_DAYS)) continue;

      const [owner, repoName] = issue.repository_url.split("/repos/")[1]?.split("/") ?? [];
      if (owner && seenOrgs.has(owner)) continue;
      // Catalogue repos produce convincing false positives — drop before the fetch.
      if (repoName && REPO_NOISE_RE.test(repoName)) continue;

      // GitHub's full-text search matches ANYWHERE in the issue body, so a
      // search for "writer" returns tickets like "[BUG] Sync can prepend a
      // SECOND frontmatter block" — the word appears a thousand words down,
      // buried in a stack trace. Re-check that the craft is present in what we
      // actually SHOW the user (title + the snippet we quote); otherwise the
      // lead is unexplainable on the card and reads as pure noise.
      const shown = `${issue.title}\n${(issue.body || "").slice(0, 700)}`;
      if (craftTerms.length && !matchesCraft(shown, craftTerms)) continue;
      // Seller pitches / product launches on GitHub look like "looking for"
      // but are supply-side ("try our agent", "I built a tool").
      if (
        /\b(hire me|my portfolio|check out (my|our)|try (our|my)|i built (an? |this )?|we (built|launched|offer)|introducing our|our ai agent|pitching our|available for hire)\b/i.test(
          shown,
        )
      ) {
        continue;
      }
      if (
        !/\b(looking for|we need|need a|need an|anyone know|is there a|alternative to|switching from|doing this manually|hiring|willing to pay)\b/i.test(
          shown,
        )
      ) {
        continue;
      }

      if (!orgCache.has(owner ?? "")) orgLookups++;
      const org = await repoOwnerCompany(issue.repository_url);
      // No org, or no website → no domain → nothing the contact layer can use,
      // and following it any further would mean profiling a person.
      if (!org) continue;
      const domain = domainFromWebsite(org.website);
      if (!domain) continue;
      // One lead per company: five issues from the same org is one buyer.
      if (seenOrgs.has(org.login)) continue;

      seenUrls.add(issue.html_url);
      seenOrgs.add(org.login);

      const company = org.name || org.login;
      leads.push({
        source: "githubintent",
        platform: "GitHub Issue",
        platform_label: `GitHub: ${company}`,
        title: issue.title.slice(0, 200),
        snippet: snippetFrom(issue, qx.skill).slice(0, 400),
        full_post_url: issue.html_url,
        // The ORG is the author here, never the human who filed the issue.
        author: company,
        author_url: `https://${domain}`,
        posted_at: issue.created_at,
        posted_at_relative: relativeAge(issue.created_at),
        engagement: issue.comments,
        source_confidence: 78,
        signal_type: "direct_intent",
        tier: t.tier,
        intent_tier: t.tier,
        intentBoost: t.boost,
        match_reasons: [
          t.why,
          `Opened ${relativeAge(issue.created_at)} on a repo owned by ${company}`,
          org.location ? `Org location: ${org.location}` : "",
        ].filter(Boolean),
        why_match: `${t.why} — ${company} (${domain})`,
      });
    }

    if (i < queries.length - 1) await sleep(INTER_QUERY_MS);
  }

  return leads;
}

/**
 * Company-level technographics: which orgs depend on a package that implies
 * budget (stripe-node = payments are live, medusa = a real store, supabase /
 * langchain = a shipping product).
 *
 * Kept SMALL on purpose. The dependents graph has no API — it's HTML, ~30 rows
 * a page — so paginating next.js would be ~5,000 sequential fetches for a list
 * that's mostly forks and abandoned side projects. The first couple of pages,
 * sorted by stars, is where the real companies are; the tail is not worth the
 * crawl. Returns domains for the contact layer, not leads.
 */
export async function dependentOrgs(
  repo: `${string}/${string}`,
  maxPages = 2,
): Promise<Array<{ owner: string; repo: string }>> {
  const out: Array<{ owner: string; repo: string }> = [];
  let url: string | null =
    `https://github.com/${repo}/network/dependents?dependent_type=REPOSITORY`;

  for (let page = 0; page < maxPages && url; page++) {
    const target: string = url;
    try {
      const res: Response = await fetch(target, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) break;
      const html: string = await res.text();

      for (const m of html.matchAll(
        /<span[^>]*data-repository-hovercards-enabled[^>]*>[\s\S]{0,400}?href="\/([^/"]+)\/([^/"]+)"/g,
      )) {
        out.push({ owner: m[1], repo: m[2] });
      }
      const next: string | undefined = /href="([^"]*network\/dependents[^"]*after=[^"]*)"/.exec(
        html,
      )?.[1];
      const decoded = next ? next.replace(/&amp;/g, "&") : null;
      url = decoded && !decoded.startsWith("http") ? `https://github.com${decoded}` : decoded;
      await sleep(1500); // stay well under anything that looks like a limit
    } catch {
      break;
    }
  }

  // Dedupe by owner — we want companies, not repos.
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.owner)) return false;
    seen.add(r.owner);
    return true;
  });
}
