import { resilientFetch, resilientJson } from "@/lib/search/http-fetch.server";
import { loadAtsBoards, type AtsProvider } from "@/lib/search/ats-sources.server";
import { registerJobSource } from "./registry";
import { catalogBoardsFor, seedBoardStatus, tenantBoardsFor } from "./tenants";
import { guessSeniority, looksRemote } from "./filters";
import { sanitizeJobText } from "./hygiene";
import type { JobSearchFilters, RawJobPosting } from "./types";

/** ATS JSON payloads have provider-specific shapes; adapters validate the
 *  fields they actually consume. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;

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

/** Providers a jobs board pool can draw from: the six `AtsProvider` families
 *  (search/ owns that union) plus the three documented-feed families from the
 *  beta pass — Personio XML, Teamtailor RSS, Gem JSON. */
type BoardProvider = AtsProvider | "personio" | "teamtailor" | "gem";

/** A board slug must be a plain DNS label before it is ever interpolated into
 *  a request host — anything else (paths, spaces, URLs) never leaves here. */
const BOARD_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Per-provider board caps — sized from the curated catalog so a search
 *  covers hundreds of boards without hammering any single ATS API. */
export const JOB_BOARD_CAPS: Record<BoardProvider, number> = {
  greenhouse: 220,
  ashby: 90,
  lever: 90,
  smartrecruiters: 60,
  workable: 40,
  recruitee: 40,
  personio: 40,
  teamtailor: 40,
  gem: 40,
};

/** Wall-clock budget shared by every ATS fan-out. Vercel kills functions that
 *  stream hundreds of board fetches; stopping between batches returns real
 *  partials instead of nothing. Tune with JOBS_ATS_BUDGET_MS. */
const ATS_BUDGET_MS = Number(process.env.JOBS_ATS_BUDGET_MS ?? 18_000);

/** Run async work over boards in small batches so hundreds of parallel
 *  requests never fire at once (politeness + 429 avoidance). Stops launching
 *  new batches once the wall-clock budget is spent — earlier batches'
 *  results are still returned, so slow sources degrade to partials. */
async function mapInBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
  staggerMs = 25,
): Promise<R[]> {
  const started = Date.now();
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    if (i > 0 && Date.now() - started > ATS_BUDGET_MS) break;
    const batch = items.slice(i, i + size);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
    if (i + size < items.length && staggerMs > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
  }
  return out;
}

/** Candidate board pool for one ATS family: DB-managed boards + the curated
 *  catalog + tenants, extended with the board-directory seeds (tenants.ts).
 *  Seed rows are discovery hints only — live-verified rows lead the pool so
 *  the larger catalog/tenant lists cannot crowd them out behind the cap;
 *  `unverified` rows are backfill only, trailing every curated source. They
 *  are verified lazily by the provider fetch itself (the documented public
 *  endpoint answering with postings is the verification; a dead board simply
 *  yields nothing and is never surfaced anywhere as a live employer). */
export async function pooledBoardsFor(provider: BoardProvider): Promise<string[]> {
  const fromDb = await loadAtsBoards(provider as AtsProvider).catch(() => [] as string[]);
  const extra = tenantBoardsFor(provider);
  const catalog = catalogBoardsFor(provider);
  const seedStatus = seedBoardStatus(provider);
  const seedLive: string[] = [];
  const seedBackfill: string[] = [];
  for (const [slug, s] of seedStatus) (s === "live" ? seedLive : seedBackfill).push(slug);
  const merged = [...new Set([...seedLive, ...fromDb, ...catalog, ...extra, ...seedBackfill])].filter(
    (b) => b && b !== "netflix" && b !== "notion",
  );
  return merged.slice(0, JOB_BOARD_CAPS[provider] ?? 60);
}

// ---------------------------------------------------------------------------
// Personio / Teamtailor / Gem — documented public feed families (beta pass).
// Endpoints + limits mirror the Source Intelligence Registry
// (src/lib/sources/registry.ts): personio {board}.jobs.personio.de|com/xml,
// teamtailor {board}.teamtailor.com|na.teamtailor.com/jobs.rss paged until a
// page holds fewer than 100 items, gem api.gem.com/job_board/v0/{board}/job_posts/.
// No parser dep: the two XML shapes are read with a small CDATA-aware tag
// scanner. Missing facts stay null — never defaulted, never invented.
// ---------------------------------------------------------------------------

/** One GET, no retries — a failed board must never turn into a hammer.
 *  Returns the status (+ body only for 2xx), null on network error/timeout. */
async function fetchFeed(url: string): Promise<{ status: number; body: string } | null> {
  try {
    const res = await withTimeout(resilientFetch(url, { retries: 0 }), 9000, null);
    if (!res) return null;
    return { status: res.status, body: res.ok ? await res.text() : "" };
  } catch {
    return null;
  }
}

/** Provider timestamps: date-only values get a stable noon-UTC stamp (the date
 *  is the fact; a made-up midnight or the crawl time is not). */
function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function xmlTag(block: string, tag: string): string | null {
  const [first] = xmlBlocks(block, tag);
  if (first === undefined) return null;
  return first.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function parsePersonioXml(xml: string, board: string): RawJobPosting[] {
  const out: RawJobPosting[] = [];
  for (const pos of xmlBlocks(xml, "position")) {
    const title = sanitizeJobText(xmlTag(pos, "name") ?? "");
    if (!title) continue; // renamed/missing title → skip, never invent
    const id = xmlTag(pos, "id");
    const detail = xmlTag(pos, "detailUrl") ?? xmlTag(pos, "url");
    const url =
      detail && /^https?:\/\//i.test(detail)
        ? detail
        : id
          ? `https://${board}.jobs.personio.de/job/${encodeURIComponent(id)}`
          : null;
    if (!url) continue; // no id and no detail link → unusable listing
    const office = sanitizeJobText(xmlTag(pos, "office") ?? "");
    const desc =
      xmlBlocks(pos, "jobDescription")
        .map((jd) =>
          [sanitizeJobText(xmlTag(jd, "name") ?? ""), sanitizeJobText(xmlTag(jd, "value") ?? "")]
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean)
        .join(" ") || null;
    out.push({
      title,
      company: sanitizeJobText(xmlTag(pos, "subcompany") ?? "") || board,
      location: office || null,
      url,
      source: "source-ats-personio",
      board_id: board,
      posted_at: toIsoDate(xmlTag(pos, "createdAt")),
      description: desc,
      salary: null,
      remote: looksRemote(office, title, desc),
      seniority: guessSeniority(title),
      department: sanitizeJobText(xmlTag(pos, "department") ?? "") || null,
      employment_type: sanitizeJobText(xmlTag(pos, "employmentType") ?? "") || null,
    });
  }
  return out;
}

async function fetchPersonio(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("personio");
  const out: RawJobPosting[] = [];
  await mapInBatches(boards, 10, async (board) => {
    if (!BOARD_SLUG_RE.test(board)) return;
    // Documented XML feed exists on two TLDs; the first TLD that answers with
    // a body wins so no board is ever fetched twice.
    for (const tld of ["de", "com"] as const) {
      const res = await fetchFeed(`https://${board}.jobs.personio.${tld}/xml`);
      if (!res) return; // network error / timeout → isolated skip
      if (res.status === 200 && res.body) {
        out.push(...parsePersonioXml(res.body, board));
        return;
      }
      // 404/5xx on this TLD → the board may live on the other one.
    }
  });
  return out;
}

const TEAMTAILOR_PAGE_SIZE = 100;
const TEAMTAILOR_MAX_PAGES = 10;

function parseTeamtailorRss(xml: string, board: string): RawJobPosting[] {
  const out: RawJobPosting[] = [];
  for (const item of xmlBlocks(xml, "item")) {
    const title = sanitizeJobText(xmlTag(item, "title") ?? "");
    const link = xmlTag(item, "link");
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const location =
      sanitizeJobText(xmlTag(item, "tt:location") ?? xmlTag(item, "city") ?? "") || null;
    const desc = sanitizeJobText(xmlTag(item, "description") ?? "") || null;
    out.push({
      title,
      company: sanitizeJobText(xmlTag(item, "company_name") ?? "") || board,
      location,
      url: link,
      source: "source-ats-teamtailor",
      board_id: board,
      posted_at: toIsoDate(xmlTag(item, "pubDate")),
      description: desc,
      salary: null,
      remote: looksRemote(location ?? "", title, desc),
      seniority: guessSeniority(title),
    });
  }
  return out;
}

async function fetchTeamtailor(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("teamtailor");
  const out: RawJobPosting[] = [];
  await mapInBatches(boards, 10, async (board) => {
    if (!BOARD_SLUG_RE.test(board)) return;
    let host = `${board}.teamtailor.com`;
    let mirrorTried = false;
    const collected: RawJobPosting[] = [];
    let offset = 0;
    for (let page = 0; page < TEAMTAILOR_MAX_PAGES; page++) {
      const res = await fetchFeed(
        `https://${host}/jobs.rss?per_page=${TEAMTAILOR_PAGE_SIZE}&offset=${offset}`,
      );
      if (!res) break;
      if (res.status === 404 && !mirrorTried) {
        // EU-hosted board not found → the same board may live on the .na mirror.
        mirrorTried = true;
        host = `${board}.na.teamtailor.com`;
        continue;
      }
      if (res.status !== 200 || !res.body) break; // 5xx etc. → isolated failure
      collected.push(...parseTeamtailorRss(res.body, board));
      // Pages carry up to per_page items; a short page is the last one.
      if (xmlBlocks(res.body, "item").length < TEAMTAILOR_PAGE_SIZE) break;
      offset += TEAMTAILOR_PAGE_SIZE;
    }
    out.push(...collected);
  });
  return out;
}

const GEM_MAX_PAGES = 10;

function parseGemPosts(posts: AnyJson[], board: string): RawJobPosting[] {
  const out: RawJobPosting[] = [];
  for (const p of posts) {
    if (!p || typeof p !== "object") continue;
    const j = p as AnyJson;
    const title = sanitizeJobText(String(j.title ?? j.name ?? ""));
    if (!title) continue;
    const companyRaw =
      j.company_name ?? (j.company && typeof j.company === "object" ? j.company.name : j.company);
    const company = sanitizeJobText(String(companyRaw ?? "")) || board;
    const location =
      sanitizeJobText(
        typeof j.location === "string"
          ? j.location
          : Array.isArray(j.locations)
            ? j.locations.filter((l: unknown) => typeof l === "string").join(", ")
            : "",
      ) || null;
    const url = [j.url, j.apply_url, j.public_url].find(
      (u) => typeof u === "string" && /^https?:\/\//i.test(u),
    );
    if (!url) continue; // no absolute apply link → unusable post
    const desc = sanitizeJobText(typeof j.description === "string" ? j.description : "") || null;
    const statedRemote =
      typeof j.remote === "boolean"
        ? j.remote
        : typeof j.is_remote === "boolean"
          ? j.is_remote
          : null;
    out.push({
      title,
      company,
      location,
      url,
      source: "source-ats-gem",
      board_id: board,
      posted_at: toIsoDate(j.created_at ?? j.first_published),
      description: desc,
      salary: null,
      remote: statedRemote ?? looksRemote(location ?? "", title, desc),
      seniority: guessSeniority(title),
      employment_type:
        sanitizeJobText(typeof j.employment_type === "string" ? j.employment_type : "") || null,
    });
  }
  return out;
}

async function fetchGem(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("gem");
  const out: RawJobPosting[] = [];
  await mapInBatches(boards, 10, async (board) => {
    if (!BOARD_SLUG_RE.test(board)) return;
    const base = `https://api.gem.com/job_board/v0/${encodeURIComponent(board)}/job_posts/`;
    let url: string | null = base;
    for (let page = 0; page < GEM_MAX_PAGES && url; page++) {
      const data: AnyJson | null = await withTimeout(resilientJson<AnyJson>(url), 9000, null);
      if (data === null) return; // 5xx / parse failure → isolated skip
      if (Array.isArray(data)) {
        out.push(...parseGemPosts(data, board));
        return; // bare array = single page, stop
      }
      const posts = data.job_posts;
      if (!Array.isArray(posts)) return; // renamed/unknown schema → nothing, no throw
      out.push(...parseGemPosts(posts, board));
      url = typeof data.next_page === "number" ? `${base}?page=${data.next_page}` : null;
    }
  });
  return out;
}

async function fetchGreenhouse(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("greenhouse");
  const out: RawJobPosting[] = [];
  const pages = await mapInBatches(boards, 24, async (board) => {
    const data = await withTimeout(
      resilientJson<{ jobs?: AnyJson[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
      ).catch(() => null),
      9000,
      null,
    );
    return { board, data };
  });
  for (const { board, data } of pages) {
    for (const j of data?.jobs || []) {
      const title = sanitizeJobText(j.title);
      if (!title) continue;
      const loc = sanitizeJobText(j.location?.name);
      const desc = sanitizeJobText(j.content).slice(0, 800);
      const url = j.absolute_url as string | undefined;
      if (!url) continue;
      out.push({
        title,
        company: sanitizeJobText(j.company_name || board),
        location: loc || null,
        url,
        source: "source-ats-greenhouse",
        board_id: board,
        posted_at: j.first_published || j.updated_at || null,
        updated_at: j.updated_at || null,
        description: desc,
        salary: null,
        remote: looksRemote(loc, title, desc),
        seniority: guessSeniority(title),
        department: sanitizeJobText(j.departments?.[0]?.name) || null,
      });
    }
  }
  return out;
}

async function fetchLever(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("lever");
  const out: RawJobPosting[] = [];
  const pages = await mapInBatches(boards, 24, async (board) => {
    const data = await withTimeout(
      resilientJson<AnyJson[]>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
      ).catch(() => null),
      9000,
      null,
    );
    return { board, data };
  });
  for (const { board, data } of pages) {
    if (!Array.isArray(data)) continue;
    for (const j of data) {
      const title = sanitizeJobText(j.text || j.title);
      if (!title) continue;
      const loc = sanitizeJobText(
        Array.isArray(j.categories?.location)
          ? j.categories.location.join(", ")
          : j.categories?.location || j.location,
      );
      const url = String(j.hostedUrl || j.applyUrl || "");
      if (!url) continue;
      const created = typeof j.createdAt === "number" ? new Date(j.createdAt).toISOString() : null;
      const desc = sanitizeJobText(j.descriptionPlain || j.description).slice(0, 800) || null;
      out.push({
        title,
        company: sanitizeJobText(j.categories?.company || board),
        location: loc || null,
        url,
        source: "source-ats-lever",
        board_id: board,
        posted_at: created,
        description: desc,
        salary: null,
        remote: looksRemote(loc, title, desc) || Boolean(j.workplaceType === "remote"),
        seniority: guessSeniority(title),
        department: sanitizeJobText(j.categories?.department || j.categories?.team) || null,
        employment_type: sanitizeJobText(j.categories?.commitment) || null,
      });
    }
  }
  return out;
}

async function fetchAshby(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("ashby");
  const out: RawJobPosting[] = [];
  const pages = await mapInBatches(boards, 24, async (board) => {
    const data = await withTimeout(
      resilientJson<{ jobs?: AnyJson[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
      ).catch(() => null),
      9000,
      null,
    );
    return { board, data };
  });
  for (const { board, data } of pages) {
    for (const j of data?.jobs || []) {
      const title = sanitizeJobText(j.title);
      if (!title) continue;
      const loc = sanitizeJobText(j.location || j.address?.postalAddress);
      const url = String(j.jobUrl || j.applyUrl || "");
      if (!url) continue;
      const salary = sanitizeJobText(
        j.compensation?.summaryPlainText || j.compensation?.summaryHtml,
      );
      const desc = sanitizeJobText(j.descriptionPlain || j.description).slice(0, 800) || null;
      out.push({
        title,
        company: sanitizeJobText(board),
        location: loc || null,
        url,
        source: "source-ats-ashby",
        board_id: board,
        posted_at: j.publishedAt || j.updatedAt || null,
        updated_at: j.updatedAt || null,
        description: desc,
        salary: salary ? salary.slice(0, 200) : null,
        remote: looksRemote(loc, title, desc) || Boolean(j.isRemote),
        seniority: guessSeniority(title),
        department: sanitizeJobText(j.department) || null,
        employment_type: sanitizeJobText(j.employmentType) || null,
      });
    }
  }
  return out;
}

async function fetchSmartRecruiters(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("smartrecruiters");
  const out: RawJobPosting[] = [];
  const pages = await mapInBatches(boards, 10, async (company) => {
    const data = await withTimeout(
      resilientJson<{ content?: AnyJson[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`,
      ).catch(() => null),
      9000,
      null,
    );
    return { company, data };
  });
  for (const { company, data } of pages) {
    for (const p of data?.content || []) {
      const title = String(p.name || "");
      if (!title) continue;
      const loc =
        p.location?.fullLocation ||
        [p.location?.city, p.location?.country].filter(Boolean).join(", ");
      const ident = p.company?.identifier || company;
      const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(ident)}/${p.id}`;
      out.push({
        title,
        company: String(p.company?.name || company),
        location: loc || null,
        url,
        source: "source-ats-smartrecruiters",
        board_id: company,
        posted_at: p.releasedDate || p.createdOn || null,
        description: null,
        salary: null,
        remote: looksRemote(loc, title),
        seniority: guessSeniority(title),
        department: typeof p.department === "string" ? p.department : null,
        employment_type: typeof p.typeOfEmployment === "string" ? p.typeOfEmployment : null,
      });
    }
  }
  return out;
}

async function fetchWorkable(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("workable");
  const out: RawJobPosting[] = [];
  const pages = await mapInBatches(boards, 10, async (account) => {
    const data = await withTimeout(
      resilientJson<{ jobs?: AnyJson[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}`,
      ).catch(() => null),
      9000,
      null,
    );
    return { account, data };
  });
  for (const { account, data } of pages) {
    for (const j of data?.jobs || []) {
      const title = String(j.title || "");
      if (!title || !j.url) continue;
      const loc = [j.city, j.country].filter(Boolean).join(", ");
      out.push({
        title,
        company: account,
        location: loc || null,
        url: String(j.url),
        source: "source-ats-workable",
        board_id: account,
        posted_at: j.published_on || j.created_at || null,
        description: String(j.shortcode || "").slice(0, 400) || null,
        salary: null,
        remote: looksRemote(loc, title) || Boolean(j.telecommuting),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

async function fetchRecruitee(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await pooledBoardsFor("recruitee");
  const out: RawJobPosting[] = [];
  const pages = await mapInBatches(boards, 10, async (company) => {
    const data = await withTimeout(
      resilientJson<{ offers?: AnyJson[] }>(
        `https://${encodeURIComponent(company)}.recruitee.com/api/offers`,
      ).catch(() => null),
      9000,
      null,
    );
    return { company, data };
  });
  for (const { company, data } of pages) {
    for (const o of data?.offers || []) {
      const title = String(o.title || "");
      if (!title) continue;
      const url = String(o.careers_url || o.url || "");
      if (!url) continue;
      const loc = String(o.location || o.city || "");
      out.push({
        title,
        company,
        location: loc || null,
        url,
        source: "source-ats-recruitee",
        board_id: company,
        posted_at: o.published_at || o.created_at || null,
        description:
          String(o.description || "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 800) || null,
        salary: null,
        remote: looksRemote(loc, title) || Boolean(o.remote),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

let registered = false;
export function ensureJobAdaptersRegistered(): void {
  if (registered) return;
  registered = true;
  registerJobSource({ id: "source-ats-greenhouse", label: "Greenhouse", fetch: fetchGreenhouse });
  registerJobSource({ id: "source-ats-lever", label: "Lever", fetch: fetchLever });
  registerJobSource({ id: "source-ats-ashby", label: "Ashby", fetch: fetchAshby });
  registerJobSource({
    id: "source-ats-smartrecruiters",
    label: "SmartRecruiters",
    fetch: fetchSmartRecruiters,
  });
  registerJobSource({ id: "source-ats-workable", label: "Workable", fetch: fetchWorkable });
  registerJobSource({ id: "source-ats-recruitee", label: "Recruitee", fetch: fetchRecruitee });
  registerJobSource({ id: "source-ats-personio", label: "Personio", fetch: fetchPersonio });
  registerJobSource({ id: "source-ats-teamtailor", label: "Teamtailor", fetch: fetchTeamtailor });
  registerJobSource({ id: "source-ats-gem", label: "Gem", fetch: fetchGem });
}
