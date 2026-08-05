// =====================================================================
// GitHub job-repo network — community-maintained job boards that live as
// repos and update hourly/daily. Free forever, no keys, no scraping walls:
// we read raw README/JSON/RSS exactly like a browser would.
//
// Parser types:
//   • json-simplify   — SimplifyJobs listings.json (structured, unix dates)
//   • md-table        — "| Company | Position | Location | Type | Date |"
//                       (the jobs-jobr-pro family; one registry line adds a
//                        new category/location repo)
//   • rss-collider    — JobsCollider hourly category feeds. Their usage
//                       rules require linking back + attribution: our lead
//                       URL is theirs and the platform label names them.
//   • funded-startups — landedjobs "recently funded AI startups hiring"
//                       (funding + hiring double signal → leading_indicator)
// =====================================================================
import type { Lead } from "../scoring";
import {
  isRecent,
  isStronglyRelevantToSkill,
  type ExpandedQueries,
} from "./query-expander";
import type { ClassifiedQuery } from "./query-classifier";

type SourceLead = Lead & { intentBoost?: number };

const UA = { "User-Agent": "Scrapivo/1.0 (lead discovery; hello@scrapivo.app)" };
const FETCH_TIMEOUT_MS = 9000;
const CACHE_MS = 30 * 60_000;
const MAX_BODY = 900_000; // listings.json can be large; hard-cap what we parse
// Repo boards refresh daily-ish; allow a week and let recency scoring rank.
const REPO_MAX_AGE_DAYS = 7;

const cache = new Map<string, { at: number; text: string }>();

async function fetchCached(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    clearTimeout(t);
    const text = res.ok ? (await res.text()).slice(0, MAX_BODY) : "";
    cache.set(url, { at: Date.now(), text });
    return text;
  } catch {
    cache.set(url, { at: Date.now(), text: "" });
    return "";
  }
}

// ── Registry ────────────────────────────────────────────────────────────────
type MdRepo = { raw: string; label: string; tags: string[]; location?: string };

const MD_TABLE_REPOS: MdRepo[] = [
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Software-Engineering-Jobs/main/README.md",
    label: "GitHub: Software Engineering Jobs",
    tags: ["software", "engineer", "developer", "backend", "frontend", "fullstack", "react", "next.js", "node.js", "python", "java", "golang", "rust", "typescript", "javascript", "web development"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Full-Stack-Development-Jobs/main/README.md",
    label: "GitHub: Full-Stack Jobs",
    tags: ["fullstack", "full stack", "react", "next.js", "node.js", "frontend", "backend", "web development", "javascript", "typescript"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Remote-Software-Engineering-Jobs/main/README.md",
    label: "GitHub: Remote SE Jobs",
    tags: ["software", "engineer", "developer", "react", "next.js", "node.js", "python", "remote", "frontend", "backend", "fullstack"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Data-Analyst-Jobs/main/README.md",
    label: "GitHub: Data Analyst Jobs",
    tags: ["data", "sql", "analytics", "analyst", "tableau", "power bi"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Remote-Data-Science-Jobs/main/README.md",
    label: "GitHub: Remote Data Science Jobs",
    tags: ["data science", "machine learning", "ml", "ai", "python", "llm"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Cloud-Engineering-Jobs/main/README.md",
    label: "GitHub: Cloud Engineering Jobs",
    tags: ["cloud", "aws", "azure", "gcp", "devops", "kubernetes", "docker", "terraform"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Product-Management-Jobs/main/README.md",
    label: "GitHub: Product Management Jobs",
    tags: ["product manager", "product management", "roadmap"],
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Software-Engineering-Jobs-New-York/main/README.md",
    label: "GitHub: SE Jobs (New York)",
    tags: ["software", "engineer", "developer", "react", "next.js"],
    location: "new york",
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Software-Engineering-Jobs-San-Francisco/main/README.md",
    label: "GitHub: SE Jobs (San Francisco)",
    tags: ["software", "engineer", "developer", "react", "next.js"],
    location: "san francisco",
  },
  {
    raw: "https://raw.githubusercontent.com/jobs-jobr-pro/Software-Engineering-Jobs-Austin/main/README.md",
    label: "GitHub: SE Jobs (Austin)",
    tags: ["software", "engineer", "developer", "react", "next.js"],
    location: "austin",
  },
];

const COLLIDER_FEEDS: Array<{ url: string; tags: string[] }> = [
  { url: "https://jobscollider.com/remote-software-development-jobs.rss", tags: ["software", "developer", "engineer", "react", "next.js", "node.js", "python", "frontend", "backend", "fullstack", "web development", "javascript", "typescript"] },
  { url: "https://jobscollider.com/remote-design-jobs.rss", tags: ["design", "ux", "ui", "figma", "graphic design"] },
  { url: "https://jobscollider.com/remote-marketing-jobs.rss", tags: ["marketing", "seo", "ppc", "social media", "email marketing", "content writing"] },
  { url: "https://jobscollider.com/remote-sales-jobs.rss", tags: ["sales", "sdr", "bdr", "account executive"] },
  { url: "https://jobscollider.com/remote-data-jobs.rss", tags: ["data", "sql", "analytics", "data science", "machine learning"] },
  { url: "https://jobscollider.com/remote-devops-jobs.rss", tags: ["devops", "cloud", "aws", "kubernetes", "docker", "terraform"] },
  { url: "https://jobscollider.com/remote-cybersecurity-jobs.rss", tags: ["cybersecurity", "security", "infosec"] },
  { url: "https://jobscollider.com/remote-qa-jobs.rss", tags: ["qa", "testing", "automation"] },
  { url: "https://jobscollider.com/remote-writing-jobs.rss", tags: ["writing", "content writing", "copywriter"] },
  { url: "https://jobscollider.com/remote-product-jobs.rss", tags: ["product manager", "product management"] },
  { url: "https://jobscollider.com/remote-finance-legal-jobs.rss", tags: ["finance", "accounting", "legal", "bookkeeping"] },
  { url: "https://jobscollider.com/remote-human-resources-jobs.rss", tags: ["hr", "recruiting", "human resources"] },
];

const SIMPLIFY_LISTINGS =
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

const LANDED_FUNDED =
  "https://raw.githubusercontent.com/landedjobs/recently-funded-ai-startups-hiring/main/README.md";

// ── helpers ─────────────────────────────────────────────────────────────────
function skillBlob(qx: ExpandedQueries): string {
  return `${qx.skill} ${qx.role} ${qx.relatedSkills.join(" ")}`.toLowerCase();
}

function tagScore(tags: string[], blob: string): number {
  return tags.reduce((n, t) => (blob.includes(t.toLowerCase()) ? n + 1 : n), 0);
}

function stripMd(cell: string): { text: string; url?: string } {
  const link = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
  const text = (link ? link[1] : cell).replace(/\*\*/g, "").replace(/<[^>]+>/g, "").trim();
  return { text, url: link?.[2] };
}

/** "Jul 01" / "Jul 01, 2026" → ISO (assumes current year; never future). */
function parseShortDate(s: string): string | undefined {
  const t = (s || "").trim();
  if (!t) return undefined;
  const withYear = /\d{4}/.test(t) ? t : `${t}, ${new Date().getFullYear()}`;
  const d = new Date(withYear);
  if (isNaN(d.getTime())) return undefined;
  if (d.getTime() > Date.now() + 86_400_000) d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

// ── md-table parser (jobs-jobr-pro family) ──────────────────────────────────
function parseMdTable(md: string, label: string, qx: ExpandedQueries): SourceLead[] {
  const out: SourceLead[] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-+/.test(line) || /\|\s*Company\s*\|/i.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const company = stripMd(cells[0]);
    const position = stripMd(cells[1]);
    const location = stripMd(cells[2] ?? "").text;
    const type = stripMd(cells[3] ?? "").text;
    const date = parseShortDate(stripMd(cells[cells.length - 1] ?? "").text);
    if (!company.text || !position.text) continue;
    const url = position.url || company.url;
    if (!url) continue;
    if (!date || !isRecent(date, REPO_MAX_AGE_DAYS)) continue;
    if (!isStronglyRelevantToSkill(`${position.text} ${company.text}`, qx.skill)) continue;
    out.push({
      source: "githubjobs",
      platform: label,
      title: `${position.text} @ ${company.text}`,
      snippet: [position.text, company.text, location, type].filter(Boolean).join(" · "),
      full_post_url: url,
      author: company.text,
      posted_at: date,
      engagement: 40,
      is_decision_maker: true,
      intentBoost: 16,
    });
    if (out.length >= 15) break;
  }
  return out;
}

// ── SimplifyJobs listings.json ──────────────────────────────────────────────
function parseSimplify(jsonText: string, qx: ExpandedQueries): SourceLead[] {
  const out: SourceLead[] = [];
  let items: any[] = [];
  try {
    items = JSON.parse(jsonText);
  } catch {
    return out;
  }
  const cutoff = Date.now() / 1000 - REPO_MAX_AGE_DAYS * 86_400;
  for (const j of items) {
    if (!j?.active || !j?.url || !j?.title) continue;
    const posted = Number(j.date_posted ?? j.date_updated ?? 0);
    if (posted < cutoff) continue;
    if (!isStronglyRelevantToSkill(`${j.title} ${j.company_name} ${(j.locations || []).join(" ")}`, qx.skill)) continue;
    out.push({
      source: "githubjobs",
      platform: "GitHub: New-Grad Positions (Simplify)",
      title: `${j.title} @ ${j.company_name}`,
      snippet: [j.title, j.company_name, (j.locations || []).join(", "), j.category]
        .filter(Boolean)
        .join(" · "),
      full_post_url: j.url,
      author: j.company_name,
      posted_at: new Date(posted * 1000).toISOString(),
      engagement: 45,
      is_decision_maker: true,
      intentBoost: 18,
    });
    if (out.length >= 15) break;
  }
  return out;
}

// ── JobsCollider RSS ────────────────────────────────────────────────────────
function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function parseColliderRss(xml: string, qx: ExpandedQueries): SourceLead[] {
  const out: SourceLead[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = pickTag(b, "title");
    const link = (b.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "").trim();
    const desc = pickTag(b, "description").slice(0, 400);
    const pub = pickTag(b, "pubDate");
    const date = pub ? new Date(pub).toISOString() : undefined;
    if (!title || !link) continue;
    if (!date || !isRecent(date, 3)) continue;
    if (!isStronglyRelevantToSkill(`${title} ${desc}`, qx.skill)) continue;
    out.push({
      source: "githubjobs",
      platform: "Remote Jobs (via JobsCollider)",
      title,
      snippet: desc || title,
      full_post_url: link,
      author: title.split(" at ")[1]?.trim() || undefined,
      posted_at: date,
      engagement: 40,
      is_decision_maker: true,
      intentBoost: 16,
    });
    if (out.length >= 12) break;
  }
  return out;
}

// ── landedjobs funded AI startups ───────────────────────────────────────────
function parseAgo(s: string): string | undefined {
  const m = s.match(/(\d+)\s*([dw])\s*ago/);
  if (!m) return undefined;
  const days = Number(m[1]) * (m[2] === "w" ? 7 : 1);
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function parseFundedStartups(md: string, qx: ExpandedQueries, audience?: string | null): SourceLead[] {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const m of md.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const name = row.match(/<b><a href="[^"]*">([^<]{2,60})<\/a><\/b>/)?.[1]?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    const raised = row.match(/<b>(\$[\d.]+[BMK])<\/b>/)?.[1];
    const round = row.match(/<sub>(Series [A-Z]|seed|pre-seed)/i)?.[1];
    const agoText = row.match(/🗓️\s*([^<]+)</)?.[1] ?? "";
    const date = parseAgo(agoText);
    const raiseLink = row.match(/<a href="(https:\/\/x\.com\/[^"]+status[^"]+)"/)?.[1];
    // description = the wide <td> without markup
    const descTd = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) =>
      t[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    const desc = descTd.sort((a, b) => b.length - a.length)[0] ?? "";
    const founders = row.match(/🧑‍💼\s*([^<]+)</)?.[1]?.trim();
    if (!raised || !date || !isRecent(date, 21)) continue;
    // Relevance: description/name must mention the skill unless the user is
    // explicitly hunting companies (funding = budget signal for outreach).
    const text = `${name} ${desc}`;
    if (!isStronglyRelevantToSkill(text, qx.skill) && audience !== "companies") continue;
    seen.add(name.toLowerCase());
    out.push({
      source: "githubjobs",
      platform: "Funded AI Startups (GitHub)",
      title: `${name} raised ${raised}${round ? ` (${round})` : ""} — fresh budget, likely hiring`,
      snippet: [desc.slice(0, 300), founders ? `Founders: ${founders}` : ""].filter(Boolean).join(" · "),
      full_post_url: raiseLink || `https://github.com/landedjobs/recently-funded-ai-startups-hiring`,
      author: name,
      posted_at: date,
      engagement: 30,
      is_decision_maker: true,
      signal_type: "leading_indicator",
      intentBoost: 10,
    });
    if (out.length >= 10) break;
  }
  return out;
}

// ── orchestrating entry point ───────────────────────────────────────────────
export async function searchGitHubJobRepos(
  qx: ExpandedQueries,
  classified?: ClassifiedQuery,
): Promise<SourceLead[]> {
  const blob = skillBlob(qx);
  const loc = (classified?.location || "").toLowerCase();

  // Pick the best-matching md-table repos (max 3 + any location variants).
  const mdPicks = MD_TABLE_REPOS
    .map((r) => ({ r, score: tagScore(r.tags, blob) + (r.location && loc.includes(r.location) ? 3 : 0) }))
    .filter(({ r, score }) => (r.location ? loc.includes(r.location) && score > 0 : score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ r }) => r);

  // Pick up to 2 matching JobsCollider feeds (default dev feed if none match).
  const colliderPicks = COLLIDER_FEEDS
    .map((f) => ({ f, score: tagScore(f.tags, blob) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ f }) => f);

  const tasks: Array<Promise<SourceLead[]>> = [
    ...mdPicks.map(async (r) => parseMdTable(await fetchCached(r.raw), r.label, qx)),
    ...colliderPicks.map(async (f) => parseColliderRss(await fetchCached(f.url), qx)),
    (async () => parseSimplify(await fetchCached(SIMPLIFY_LISTINGS), qx))(),
    (async () => parseFundedStartups(await fetchCached(LANDED_FUNDED), qx, classified?.audience))(),
  ];

  const settled = await Promise.allSettled(tasks);
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const l of s.value) {
      if (!l.full_post_url || seen.has(l.full_post_url)) continue;
      seen.add(l.full_post_url);
      out.push(l);
    }
  }
  return out;
}
