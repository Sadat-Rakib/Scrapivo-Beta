/**
 * Dedicated remote-board fetchers for the Jobs page.
 *
 * Unlike the shared Discover-pipeline search fns (which flatten jobs into
 * text leads, cap at 25 rows, and drop everything older than 3 days), these
 * hit the same free APIs directly and keep the structured fields (location,
 * employment type, salary, seniority) the /jobs page needs. Caps are 100 rows
 * and the age window is 21 days — wide enough for real volume, narrow enough
 * to stay fresh.
 */
import { resilientFetch, resilientJson } from "@/lib/search/http-fetch.server";
import { guessSeniority, looksRemote } from "./filters";
import { hasWord, parseQuery } from "./relevance";
import { sanitizeJobText } from "./hygiene";
import type { JobSourceKind, RawJobPosting } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;

const MAX_AGE_DAYS = 21;
const CAP = 100;

function freshEnough(iso: string | null | undefined): boolean {
  if (!iso) return true; // undated stays; isActiveJob's 30d floor still applies
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) / 86_400_000 <= MAX_AGE_DAYS;
}

function epochFresh(sec: number | null | undefined): boolean {
  if (!sec) return true;
  return (Date.now() - sec * 1000) / 86_400_000 <= MAX_AGE_DAYS;
}

/**
 * Title relevance gate: every role token from the query must appear in the
 * title (word-boundary) — or, when the title has no token, at least one token
 * must appear AND the query must be a single token (broad queries like
 * "design" keep tag/category matches alive). Empty query → no gate.
 */
function titleGate(title: string, query: string | undefined): boolean {
  const pq = parseQuery(query);
  if (!pq.tokens.length) return true;
  const hits = pq.tokens.filter((t) => hasWord(title, t));
  if (hits.length === pq.tokens.length) return true;
  if (pq.tokens.length === 1) return hits.length === 1;
  // Multi-token queries need the phrase or all tokens in the title.
  return pq.phrase ? new RegExp(`\\b${pq.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title) : false;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
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

// ── Remotive ────────────────────────────────────────────────────────────────

export async function fetchRemotiveJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const url = q
    ? `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=${CAP}`
    : `https://remotive.com/api/remote-jobs?limit=${CAP}`;
  const data = await withTimeout(
    resilientJson<{ jobs?: AnyJson[] }>(url).catch(() => null),
    12_000,
    null,
  );
  const out: RawJobPosting[] = [];
  for (const j of data?.jobs ?? []) {
    const title = sanitizeJobText(j.title);
    const url2 = String(j.url || "");
    if (!title || !url2) continue;
    if (!freshEnough(j.publication_date)) continue;
    if (q && !titleGate(title, q)) {
      // Remotive's server-side search matches descriptions too; keep only
      // title-relevant rows for precision.
      continue;
    }
    const loc = sanitizeJobText(j.candidate_required_location);
    const desc = sanitizeJobText(j.description).slice(0, 800);
    out.push({
      title,
      company: sanitizeJobText(j.company_name),
      location: loc || null,
      url: url2,
      source: "source-remotive",
      board_id: "remotive",
      posted_at: j.publication_date || null,
      description: desc || null,
      salary: sanitizeJobText(j.salary)?.slice(0, 200) || null,
      remote: true,
      seniority: guessSeniority(title),
      employment_type: sanitizeJobText(j.job_type) || null,
    });
  }
  return out.slice(0, CAP);
}

// ── Jobicy ──────────────────────────────────────────────────────────────────

export async function fetchJobicyJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const url = q
    ? `https://jobicy.com/api/v2/remote-jobs?count=${CAP}&tag=${encodeURIComponent(q)}`
    : `https://jobicy.com/api/v2/remote-jobs?count=${CAP}`;
  const data = await withTimeout(resilientJson<{ jobs?: AnyJson[] }>(url).catch(() => null), 12_000, null);
  const out: RawJobPosting[] = [];
  for (const j of data?.jobs ?? []) {
    const title = sanitizeJobText(j.jobTitle);
    const url2 = String(j.url || "");
    if (!title || !url2) continue;
    if (!freshEnough(j.pubDate)) continue;
    if (q && !titleGate(title, q)) continue;
    const loc = sanitizeJobText(
      Array.isArray(j.jobLocation) ? j.jobLocation.join(", ") : j.jobLocation,
    );
    out.push({
      title,
      company: sanitizeJobText(j.companyName),
      location: loc || null,
      url: url2,
      source: "source-jobicy",
      board_id: "jobicy",
      posted_at: j.pubDate || null,
      description: sanitizeJobText(j.jobExcerpt || j.jobDescription).slice(0, 800) || null,
      salary: null,
      remote: true,
      seniority: sanitizeJobText(j.jobLevel)?.toLowerCase() || guessSeniority(title),
      employment_type: sanitizeJobText(j.jobType) || null,
    });
  }
  return out.slice(0, CAP);
}

// ── We Work Remotely (RSS) ──────────────────────────────────────────────────

function pickTag(body: string, tag: string): string {
  const m = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

export async function fetchWwrJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const url = q
    ? `https://weworkremotely.com/remote-jobs/search.rss?term=${encodeURIComponent(q)}`
    : `https://weworkremotely.com/remote-jobs.rss`;
  const text = await withTimeout(
    resilientFetch(url, { headers: { Accept: "application/rss+xml" } })
      .then((r) => (r?.ok ? r.text() : ""))
      .catch(() => ""),
    12_000,
    "",
  );
  if (!text) return [];
  const out: RawJobPosting[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const title = sanitizeJobText(pickTag(body, "title"));
    const link = pickTag(body, "link");
    if (!title || !link) continue;
    const date = pickTag(body, "pubDate");
    const posted = date ? new Date(date).toISOString() : null;
    if (!freshEnough(posted)) continue;
    if (q && !titleGate(title, q)) continue;
    const desc = sanitizeJobText(pickTag(body, "description")).slice(0, 800);
    // WWR titles are "Company: Role" — flip for display parity with other boards.
    const flip = title.match(/^([^:]{2,40}):\s+(.+)$/);
    const company = flip ? flip[1].trim() : "We Work Remotely";
    const role = flip ? flip[2].trim() : title;
    out.push({
      title: role,
      company,
      location: null,
      url: link,
      source: "source-weworkremotely",
      board_id: "wwr",
      posted_at: posted,
      description: desc || null,
      salary: null,
      remote: true,
      seniority: guessSeniority(role),
    });
    if (out.length >= CAP) break;
  }
  return out;
}

// ── Arbeitnow ───────────────────────────────────────────────────────────────

export async function fetchArbeitnowJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const data = await withTimeout(
    resilientJson<{ data?: AnyJson[] }>("https://www.arbeitnow.com/api/job-board-api").catch(
      () => null,
    ),
    12_000,
    null,
  );
  const jobs: AnyJson[] = data?.data ?? [];
  const out: RawJobPosting[] = [];
  for (const j of jobs) {
    const title = sanitizeJobText(j.title);
    const url2 = String(j.url || "");
    if (!title || !url2) continue;
    const posted = j.created_at ? new Date(j.created_at * 1000).toISOString() : null;
    if (!epochFresh(j.created_at)) continue;
    if (q && !titleGate(title, q)) continue;
    const desc = sanitizeJobText(j.description).slice(0, 800);
    out.push({
      title,
      company: sanitizeJobText(j.company_name),
      location: sanitizeJobText(j.location) || null,
      url: url2,
      source: "source-arbeitnow",
      board_id: "arbeitnow",
      posted_at: posted,
      description: desc || null,
      salary: null,
      remote: Boolean(j.remote) || looksRemote(j.location, title, desc),
      seniority: guessSeniority(title),
    });
    if (out.length >= CAP) break;
  }
  return out;
}

// ── RemoteOK ────────────────────────────────────────────────────────────────

export async function fetchRemoteOkJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const data = await withTimeout(
    resilientJson<AnyJson[]>("https://remoteok.com/api").catch(() => null),
    12_000,
    null,
  );
  if (!Array.isArray(data)) return [];
  const out: RawJobPosting[] = [];
  for (const j of data) {
    const title = sanitizeJobText(j.position);
    const url2 = String(j.url || j.redirect || "");
    if (!title || !url2 || !/^https?:/.test(url2)) continue;
    const posted = j.date ? new Date(j.date).toISOString() : null;
    if (!freshEnough(posted)) continue;
    if (q && !titleGate(title, q)) continue;
    const desc = sanitizeJobText(j.description).slice(0, 800);
    out.push({
      title,
      company: sanitizeJobText(j.company),
      location: sanitizeJobText(j.location) || null,
      url: url2,
      source: "source-remoteok",
      board_id: "remoteok",
      posted_at: posted,
      description: desc || null,
      salary:
        j.salary_min && j.salary_max
          ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round(j.salary_max / 1000)}k`
          : null,
      remote: true,
      seniority: guessSeniority(title),
      employment_type: sanitizeJobText(j.type) || null,
    });
    if (out.length >= CAP) break;
  }
  return out;
}

// ── Working Nomads ──────────────────────────────────────────────────────────

export async function fetchWorkingNomadsJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const data = await withTimeout(
    resilientJson<AnyJson[]>("https://www.workingnomads.com/api/exposed_jobs/").catch(() => null),
    12_000,
    null,
  );
  if (!Array.isArray(data)) return [];
  const out: RawJobPosting[] = [];
  for (const j of data) {
    const title = sanitizeJobText(j.title);
    const url2 = String(j.url || "");
    if (!title || !url2) continue;
    if (!freshEnough(j.posted_at)) continue;
    if (q && !titleGate(title, q)) continue;
    const desc = sanitizeJobText(j.description).slice(0, 800);
    out.push({
      title,
      company: sanitizeJobText(j.company_name),
      location: sanitizeJobText(j.location) || null,
      url: url2,
      source: "source-workingnomads",
      board_id: "workingnomads",
      posted_at: j.posted_at || null,
      description: desc || null,
      salary: null,
      remote: true,
      seniority: guessSeniority(title),
      employment_type: sanitizeJobText(j.job_type) || null,
    });
    if (out.length >= CAP) break;
  }
  return out;
}

// ── Himalayas ───────────────────────────────────────────────────────────────

export async function fetchHimalayasJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const out: RawJobPosting[] = [];
  // 3 pages × 20 (API caps page size at 20; recency-ordered feed).
  for (let page = 0; page < 3; page++) {
    const data = await withTimeout(
      resilientJson<{ jobs?: AnyJson[] }>(
        `https://himalayas.app/jobs/api?limit=20&offset=${page * 20}`,
      ).catch(() => null),
      12_000,
      null,
    );
    const jobs: AnyJson[] = data?.jobs ?? [];
    if (!jobs.length) break;
    for (const j of jobs) {
      const title = sanitizeJobText(j.title);
      const url2 = String(j.applicationLink || j.guid || "");
      if (!title || !url2) continue;
      const posted = j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null;
      if (!epochFresh(j.pubDate)) continue;
      if (q && !titleGate(title, q)) continue;
      const loc = sanitizeJobText((j.locationRestrictions || []).join(", "));
      const desc = sanitizeJobText(j.description || j.excerpt).slice(0, 800);
      out.push({
        title,
        company: sanitizeJobText(j.companyName),
        location: loc || null,
        url: url2,
        source: "source-himalayas",
        board_id: "himalayas",
        posted_at: posted,
        description: desc || null,
        salary:
          j.minSalary && j.maxSalary
            ? `${j.minSalary.toLocaleString()}–${j.maxSalary.toLocaleString()}${
                j.currency ? ` ${j.currency}` : ""
              }`
            : null,
        remote: true,
        seniority: sanitizeJobText((j.seniority || [])[0])?.toLowerCase() || guessSeniority(title),
        employment_type: sanitizeJobText(j.employmentType) || null,
      });
    }
    // Feed is recency-ordered; stop once we're past the freshness window.
    const oldest = jobs[jobs.length - 1]?.pubDate;
    if (oldest && !epochFresh(oldest)) break;
  }
  return out.slice(0, CAP);
}

// ── 4dayweek ────────────────────────────────────────────────────────────────

export async function fetch4DayWeekJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const data = await withTimeout(
    resilientJson<{ jobs?: AnyJson[] }>("https://4dayweek.io/api/jobs?page=1&limit=100").catch(
      () => null,
    ),
    12_000,
    null,
  );
  const out: RawJobPosting[] = [];
  for (const j of data?.jobs ?? []) {
    const title = sanitizeJobText(j.title);
    if (!title || !j.slug) continue;
    if (!epochFresh(j.posted)) continue;
    if (q && !titleGate(title, q)) continue;
    const primary = (j.locations || []).find((l: AnyJson) => l.is_primary) || (j.locations || [])[0];
    const loc = primary
      ? sanitizeJobText([primary.city, primary.country].filter(Boolean).join(", "))
      : "";
    out.push({
      title,
      company: sanitizeJobText(j.company_name),
      location: loc || null,
      url: `https://4dayweek.io/job/${j.slug}`,
      source: "source-4dayweek",
      board_id: "4dayweek",
      posted_at: j.posted ? new Date(j.posted * 1000).toISOString() : null,
      description: sanitizeJobText(j.category).slice(0, 400) || null,
      salary: sanitizeJobText(j.salary)?.slice(0, 200) || null,
      remote: j.work_arrangement === "remote" || j.work_arrangement === "hybrid",
      seniority: sanitizeJobText(j.level)?.toLowerCase() || guessSeniority(title),
    });
    if (out.length >= CAP) break;
  }
  return out;
}

// ── Nodesk (RSS) ────────────────────────────────────────────────────────────

export async function fetchNodeskJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const text = await withTimeout(
    resilientFetch("https://nodesk.co/remote-jobs/index.xml", {
      headers: { Accept: "application/rss+xml" },
    })
      .then((r) => (r?.ok ? r.text() : ""))
      .catch(() => ""),
    12_000,
    "",
  );
  if (!text) return [];
  const out: RawJobPosting[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const title = sanitizeJobText(pickTag(body, "title"));
    const link = pickTag(body, "link");
    if (!title || !link) continue;
    const date = pickTag(body, "pubDate");
    const posted = date ? new Date(date).toISOString() : null;
    if (!freshEnough(posted)) continue;
    if (q && !titleGate(title, q)) continue;
    const desc = sanitizeJobText(pickTag(body, "description")).slice(0, 600);
    out.push({
      title,
      company: sanitizeJobText(pickTag(body, "author")) || "Nodesk",
      location: null,
      url: link,
      source: "source-nodesk",
      board_id: "nodesk",
      posted_at: posted,
      description: desc || null,
      salary: null,
      remote: true,
      seniority: guessSeniority(title),
    });
    if (out.length >= CAP) break;
  }
  return out;
}

// ── The Muse (dedicated: category derived from query, page size raised) ─────

const MUSE_CATEGORY_BY_TOKEN: [RegExp, string][] = [
  [/\bdesign(er)?\b|\bux\b|\bui\b/i, "Design"],
  [/\bmarket(ing|er)\b/i, "Marketing"],
  [/\bdata\b/i, "Data"],
  [/\bproduct\s*manage/i, "Product"],
  [/\bsales\b|\baccount\s*exec/i, "Sales"],
  [/\bdev(elop)?er?\b|\bengineer/i, "Engineering"],
  [/\bhr\b|\bpeople\b|\brecruit/i, "HR"],
];

export async function fetchTheMuseJobs(query: string | undefined): Promise<RawJobPosting[]> {
  const q = query?.trim();
  const category = MUSE_CATEGORY_BY_TOKEN.find(([re]) => re.test(q || ""))?.[1] ?? "Engineering";
  const data = await withTimeout(
    resilientJson<{ results?: AnyJson[] }>(
      `https://www.themuse.com/api/public/jobs?category=${encodeURIComponent(category)}&page=0`,
    ).catch(() => null),
    12_000,
    null,
  );
  const out: RawJobPosting[] = [];
  for (const j of data?.results ?? []) {
    const title = sanitizeJobText(j.name);
    const url2 = String(j.refs?.landing_page || "");
    if (!title || !url2) continue;
    if (!freshEnough(j.publication_date)) continue;
    if (q && !titleGate(title, q)) continue;
    const loc = sanitizeJobText((j.locations || []).map((l: AnyJson) => l.name).join(", "));
    out.push({
      title,
      company: sanitizeJobText(j.company?.name),
      location: loc || null,
      url: url2,
      source: "source-themuse",
      board_id: "themuse",
      posted_at: j.publication_date || null,
      description: sanitizeJobText(j.contents).slice(0, 800) || null,
      salary: null,
      remote: (j.locations || []).some((l: AnyJson) => /remote/i.test(l.name || "")),
      seniority: guessSeniority(title),
      employment_type: sanitizeJobText(j.type) || null,
    });
    if (out.length >= CAP) break;
  }
  return out;
}
