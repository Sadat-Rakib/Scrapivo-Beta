// =====================================================================
// Freelance marketplaces — where clients post the work itself
//
// This is a different source class from ATS boards, and it fills the gap those
// structurally cannot: corporate boards hire employees, so a search for
// "writer" or "video editor" found almost nothing (measured: writer = 4 leads
// across 80 Greenhouse boards). Nobody hires a video editor through Greenhouse.
// They post it on a marketplace.
//
// Probed live 2026-08-01. What works and what doesn't, so nobody re-tries the
// dead ones:
//   ✓ Freelancer.com RSS   — 20 projects, MINUTES old, real client asks
//   ✓ RemoteOK API         — 101 rows, JSON
//   ✓ Working Nomads API   — 43 rows, JSON
//   ✗ Upwork RSS           — HTTP 410 GONE (the existing searchUpwork is dead)
//   ✗ Craigslist gigs      — 403 to server-side requests, all regions
//   ✗ Guru / Workana       — 404, feeds removed
//   ✗ PeoplePerHour        — 302 to a login wall
// =====================================================================
import type { Lead } from "../scoring";
import { isRecent, type ExpandedQueries } from "./query-expander";
import { classifyDemand, matchesCraft } from "./demand-classifier";

type SourceLead = Lead & { intentBoost?: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 9000;
const CACHE_MS = 3 * 60_000;

/** Angles per craft on Freelancer, and rows per angle. */
const FREELANCER_MAX_QUERIES = 8;
const FREELANCER_MAX_QUERIES_VOLUME = 10;
const FREELANCER_PAGE_SIZE = 100;

function craftTermsOf(qx: ExpandedQueries): string[] {
  return [qx.skill, qx.role, ...(qx.relatedSkills ?? [])]
    .flatMap((t) => (t || "").split(/\s*\/\s*/))
    .map((t) => t.trim())
    .filter(
      (t) => t.length >= 3 && !/^(lead|leads|generation|service|services|client|clients)$/i.test(t),
    );
}

function isVolumeCraft(qx: ExpandedQueries): boolean {
  const blob = `${qx.skill} ${qx.role} ${qx.queryType} ${(qx.relatedSkills || []).join(" ")}`;
  // Lead-gen / sales crafts must NOT use loose description matching — that
  // matched any Freelancer gig whose description mentioned "lead" or "services".
  // They still get the default multi-angle query fan-out below.
  if (/\blead\s*gen|sales|sdr|bdr|outbound|appointment\s*sett/i.test(blob)) return false;
  // Any concrete craft/role gets wider Freelancer fan-out (not a tiny allowlist).
  const craft = (qx.role || qx.skill || "").trim();
  if (craft.length >= 3) return true;
  return (
    qx.queryType === "product" ||
    /tutor|tutoring|homework|teacher|invoice|billing|client acquisition|freelance/i.test(blob)
  );
}

const cache = new Map<string, { at: number; body: string }>();

async function fetchCached(url: string, accept: string): Promise<string> {
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

function relativeAge(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function decodeEntities(s: string): string {
  return (
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      // Latin-1 named entities appear in Spanish/Portuguese project titles
      // ("Video Promocional 30s $15 R&aacute;pido").
      .replace(/&([aeiounAEIOUN])(?:acute|grave|circ|uml|tilde);/g, "$1")
      .replace(/&nbsp;/g, " ")
  );
}

type FreelancerProject = {
  title?: string;
  preview_description?: string;
  seo_url?: string;
  time_submitted?: number;
  submitdate?: number;
  budget?: { minimum?: number; maximum?: number };
  currency?: { code?: string };
};

/** Freelancer's public active-projects search. No key, no auth. */
async function searchFreelancerApi(qx: ExpandedQueries, terms: string[]): Promise<SourceLead[]> {
  // The person noun is what marketplace titles use ("logo designer needed"),
  // and qx.skill is the field ("design"), so prefer the role.
  const craft = (qx.role || qx.skill || "").trim();
  if (craft.length < 3) return [];

  // Several angles on the same craft, not one.
  //
  // This is the freshest high-volume source we have — measured 2026-08-02,
  // 34 projects of which 32 were under 24h old and 2 under an hour — and one
  // query for the role was leaving most of it unread. The related skills matter
  // because clients name the deliverable ("logo", "brand identity"), not the
  // profession, so a single "designer" query misses them.
  // Product/tutor hunts: prefer relatedSkills (invoicing, math tutor…) over
  // awkward phrase skills like "find clients".
  const volume = isVolumeCraft(qx);
  const preferred = volume
    ? [...(qx.relatedSkills ?? []), qx.role, qx.skill, craft]
    : [craft, qx.skill, ...(qx.relatedSkills ?? [])];
  const queries = [...new Set(preferred)]
    .map((t) => (t || "").trim())
    .filter(
      (t) =>
        t.length >= 3 &&
        t.length <= 40 &&
        !/^(lead|leads|generation|service|services|client|clients)$/i.test(t),
    )
    .slice(0, volume ? FREELANCER_MAX_QUERIES_VOLUME : FREELANCER_MAX_QUERIES);

  const bodies = await Promise.all(
    queries.map((q) =>
      fetchCached(
        "https://www.freelancer.com/api/projects/0.1/projects/active/" +
          `?query=${encodeURIComponent(q)}&limit=${FREELANCER_PAGE_SIZE}` +
          "&job_details=true&full_description=true&sort_field=time_updated",
        "application/json",
      ),
    ),
  );

  const projects: FreelancerProject[] = [];
  const seenIds = new Set<string>();
  for (const body of bodies) {
    if (!body) continue;
    try {
      for (const p of (JSON.parse(body)?.result?.projects ?? []) as FreelancerProject[]) {
        const id = (p.seo_url ?? "").trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        projects.push(p);
      }
    } catch {
      continue;
    }
  }
  if (!projects.length) return [];

  const out: SourceLead[] = [];
  for (const p of projects) {
    const title = (p.title ?? "").trim();
    const seo = (p.seo_url ?? "").trim();
    if (!title || !seo) continue;

    const submitted = p.time_submitted ?? p.submitdate;
    const iso = submitted ? new Date(submitted * 1000).toISOString() : "";
    if (iso && !isRecent(iso, volume ? 7 : 3)) continue;

    const desc = (p.preview_description ?? "").replace(/\s+/g, " ").trim();
    // Product hunts: relatedSkills are capabilities — accept if ANY term hits.
    // Tutor: "math tutor" etc. must match title loosely.
    if (
      terms.length &&
      !matchesCraft(title, terms) &&
      !(volume && matchesCraft(`${title} ${desc}`, terms))
    ) {
      continue;
    }

    const verdict = classifyDemand({ title, body: desc });
    if (verdict.rejectedAs === "self_promotion" || verdict.rejectedAs === "aggregator") continue;

    const min = p.budget?.minimum;
    const max = p.budget?.maximum;
    const cur = p.currency?.code ?? "";
    const budgetText = min || max ? `Budget ${cur} ${min ?? "?"}-${max ?? "?"}` : "";

    out.push({
      source: "freelancer",
      platform: "Freelancer",
      platform_label: "Freelancer project",
      title: title.slice(0, 200),
      snippet: (desc || title).slice(0, 400),
      full_post_url: `https://www.freelancer.com/projects/${seo}`,
      posted_at: iso || undefined,
      posted_at_relative: iso ? relativeAge(iso) : undefined,
      source_confidence: 80,
      signal_type: "direct_intent",
      intentBoost: 22,
      has_budget: Boolean(min || max),
      match_reasons: [
        "Client posted this project",
        budgetText || "Marketplace — ready to hire",
      ].filter(Boolean),
      why_match: "Client posted this project on a freelance marketplace",
    });
  }
  return out;
}

// ── Freelancer.com ──────────────────────────────────────────────────────────

/**
 * The single best marketplace feed available free: real clients posting real
 * projects, and the feed is minutes fresh (measured: newest item 2 minutes old).
 *
 * Every item is BY DEFINITION demand — you don't post a project on Freelancer
 * unless you want it done — so the demand classifier is used only to strip the
 * occasional spam/self-promo row, not to establish intent.
 */
export async function searchFreelancer(qx: ExpandedQueries): Promise<SourceLead[]> {
  const terms = craftTermsOf(qx);
  const out: SourceLead[] = [];

  // Ask for THIS craft rather than filtering a firehose.
  //
  // rss.xml is the 20 most recent projects sitewide, across every category in
  // every language, and they then had to survive a craft match on the title —
  // so the source reported 0 unless one of those 20 random projects happened to
  // be a design job. The search endpoint takes the craft as a query and returns
  // 20 matching projects instead (measured 2026-08-02: 20 rows for "designer").
  // RSS stays as the fallback, since it needs no query and cannot 4xx.
  const searched = await searchFreelancerApi(qx, terms);
  if (searched.length) return searched;

  const body = await fetchCached("https://www.freelancer.com/rss.xml", "application/rss+xml");
  if (!body) return [];

  for (const block of body.split("<item>").slice(1)) {
    const rawTitle = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1] ?? "";
    const title = decodeEntities(rawTitle).trim();
    const link = (/<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? "").trim();
    const pub = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] ?? "").trim();
    const desc = decodeEntities(
      (/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(block)?.[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " "),
    ).trim();
    if (!title || !link) continue;

    const iso = pub ? new Date(pub).toISOString() : "";
    if (iso && !isRecent(iso, 3)) continue;

    // TITLE ONLY — the third time this exact trap has bitten. Matching the
    // description returned "Structural Engineer for Home Renovation" for a
    // *video editor* search, the same way it gave "Account Executive" for a
    // designer search on Greenhouse and "Graphic Designer" for marketing on
    // Reddit. A project title states the work; the body mentions everything
    // adjacent to it.
    if (terms.length && !matchesCraft(title, terms)) continue;
    // Only used to strip spam — a posted project is inherently demand.
    const verdict = classifyDemand({ title, body: desc });
    if (verdict.rejectedAs === "self_promotion" || verdict.rejectedAs === "aggregator") continue;

    out.push({
      source: "freelancer",
      platform: "Freelancer",
      platform_label: "Freelancer project",
      title: title.slice(0, 200),
      snippet: (desc || title).slice(0, 400),
      full_post_url: link,
      posted_at: iso || undefined,
      posted_at_relative: iso ? relativeAge(iso) : undefined,
      source_confidence: 80,
      signal_type: "direct_intent",
      // A posted project is someone actively spending — rank it like a tagged
      // hiring post, above a forum mention.
      intentBoost: 22,
      has_budget: /\$|\bbudget\b|\busd\b|\beur\b|\bgbp\b/i.test(`${title} ${desc}`),
      match_reasons: ["Client posted this project", "Marketplace — ready to hire"],
      why_match: "Client posted this project on a freelance marketplace",
    });
  }
  return out;
}

// ── Remote job APIs (JSON) ──────────────────────────────────────────────────

type RemoteOkRow = {
  position?: string;
  company?: string;
  description?: string;
  url?: string;
  date?: string;
  tags?: string[];
};

/**
 * RemoteOK's public JSON. The FIRST row is a legal/attribution notice, not a
 * job — dropping it is required, not cosmetic.
 */
export async function searchRemoteOkApi(qx: ExpandedQueries): Promise<SourceLead[]> {
  const body = await fetchCached("https://remoteok.com/api", "application/json");
  if (!body) return [];
  let rows: RemoteOkRow[] = [];
  try {
    rows = JSON.parse(body) as RemoteOkRow[];
  } catch {
    return [];
  }
  const terms = craftTermsOf(qx);
  const out: SourceLead[] = [];

  for (const r of rows.slice(1)) {
    const title = (r.position || "").trim();
    const company = (r.company || "").trim();
    if (!title || !r.url) continue;
    if (r.date && !isRecent(r.date, 5)) continue;

    // TITLE ONLY. Tags were in here too, and RemoteOK tags every posting
    // broadly — that is how a search for "design" returned "Cleaning Assistant
    // Afternoon Evening". Same trap as Greenhouse/Reddit/Freelancer/Lemmy:
    // the title states the work, everything else merely mentions it.
    if (terms.length && !matchesCraft(title, terms)) continue;

    out.push({
      source: "remoteok",
      platform: "RemoteOK",
      platform_label: company || "RemoteOK",
      title: company ? `${title} @ ${company}` : title,
      snippet: (r.description || title).replace(/<[^>]+>/g, " ").slice(0, 400),
      full_post_url: r.url,
      author: company || undefined,
      posted_at: r.date,
      posted_at_relative: r.date ? relativeAge(r.date) : undefined,
      source_confidence: 72,
      signal_type: "direct_intent",
      is_decision_maker: true,
      intentBoost: 14,
      match_reasons: ["Open remote role", company ? `Hiring at ${company}` : ""].filter(Boolean),
      why_match: company ? `${company} is hiring for this` : "Open remote role",
    });
  }
  return out;
}

type NomadRow = {
  title?: string;
  company_name?: string;
  url?: string;
  pub_date?: string;
  description?: string;
  category_name?: string;
};

/** Working Nomads — smaller feed, but distinct companies from RemoteOK. */
export async function searchWorkingNomads(qx: ExpandedQueries): Promise<SourceLead[]> {
  const body = await fetchCached(
    "https://www.workingnomads.com/api/exposed_jobs/",
    "application/json",
  );
  if (!body) return [];
  let rows: NomadRow[] = [];
  try {
    const parsed = JSON.parse(body);
    rows = Array.isArray(parsed) ? (parsed as NomadRow[]) : [];
  } catch {
    return [];
  }
  const terms = craftTermsOf(qx);
  const out: SourceLead[] = [];

  for (const r of rows) {
    const title = (r.title || "").trim();
    const company = (r.company_name || "").trim();
    if (!title || !r.url) continue;
    if (r.pub_date && !isRecent(r.pub_date, 5)) continue;
    if (terms.length && !matchesCraft(`${title} ${r.category_name ?? ""}`, terms)) continue;

    out.push({
      source: "workingnomads",
      platform: "Working Nomads",
      platform_label: company || "Working Nomads",
      title: company ? `${title} @ ${company}` : title,
      snippet: (r.description || title).replace(/<[^>]+>/g, " ").slice(0, 400),
      full_post_url: r.url.startsWith("http") ? r.url : `https://www.workingnomads.com${r.url}`,
      author: company || undefined,
      posted_at: r.pub_date,
      posted_at_relative: r.pub_date ? relativeAge(r.pub_date) : undefined,
      source_confidence: 70,
      signal_type: "direct_intent",
      is_decision_maker: true,
      intentBoost: 12,
      match_reasons: ["Open remote role", company ? `Hiring at ${company}` : ""].filter(Boolean),
      why_match: company ? `${company} is hiring for this` : "Open remote role",
    });
  }
  return out;
}
