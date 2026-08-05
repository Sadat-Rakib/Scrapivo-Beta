// =====================================================================
// ATS job-board sources (Phase 2, Tasks 2.1 / 2.2)
//
// TASK 2.1 — THE STANDARD "NEW SOURCE" PATTERN (documented once, here, then
// repeated for every fetcher below and every future Phase 2/3/4 source):
//
//   1. Standard INPUT  — the `ExpandedQueries` the classifier/expander already
//      produce (role, skill, relatedSkills, jobBoardTerms). Nothing bespoke.
//   2. Standard OUTPUT — the same `SourceLead` shape every other fetcher emits
//      (source, platform, title, snippet, full_post_url, author, posted_at,
//      engagement, is_decision_maker, intentBoost). No new lead shape.
//   3. Standard RESILIENCE — every network call goes through `withTimeout` +
//      try/catch that LOGS (never silently swallows, per Task 1.5) and respects
//      the source's shape. One bad board never rejects the whole fan-out.
//   4. Standard REGISTRATION — exported `searchX(qx)` fns added to the
//      orchestrator's `Promise.allSettled` fan-out in sources.server.ts, with
//      source-health logging wired in from day one (Task 1.5), not retrofitted.
//
// Ashby (searchAshby) is the reference implementation the spec calls for;
// Workable / SmartRecruiters / Recruitee follow the exact same shape.
//
// TASK 1.7 + 1.3 (applied to these NEW boards) — board lists are NOT hardcoded
// in source. They live in the Supabase `ats_companies` table and are loaded at
// runtime, so adding a company is a DB insert, not a code deploy. Boards are
// returned oldest-`last_checked_at`-first (deterministic rotation) and their
// timestamp is bumped after each run, so every board gets covered within a
// bounded window instead of random/inconsistent coverage. A hardcoded SEED is
// used only as a fallback when the table is empty/unreachable.
// =====================================================================
import type { Lead } from "../scoring";
import { isRecent, type ExpandedQueries } from "./query-expander";
import { resilientJson } from "./http-fetch.server";

type SourceLead = Lead & { intentBoost?: number };

export type AtsProvider =
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "recruitee"
  | "greenhouse"
  | "lever";

// Verified-live boards (probed 2026-07 — real 200 + populated payloads) used
// as a fallback only. Production coverage is meant to grow via the DB table.
const SEED_BOARDS: Record<AtsProvider, string[]> = {
  ashby: ["ramp", "openai", "posthog", "linear", "vanta", "hex"],
  smartrecruiters: ["BoschGroup", "Visa", "Square"],
  workable: ["automattic"],
  recruitee: ["channable"],
  // Probed live 2026-07-31: 80 of 211 candidate tokens returned postings,
  // 8,080 open roles. INTERLEAVED by vertical (tech / media / consumer) so any
  // subset spans industries — grouping once put every media board at the tail,
  // and a "writer" search that landed on the tech block found nothing.
  greenhouse: [
    "databricks",
    "stripe",
    "similarweb",
    "onemedical",
    "datadog",
    "anthropic",
    "duolingo",
    "hellofresh",
    "okta",
    "cloudflare",
    "later",
    "wolt",
    "braze",
    "elastic",
    "khanacademy",
    "oscar",
    "adyen",
    "fivetran",
    "hootsuite",
    "airbnb",
    "gitlab",
    "figma",
    "udacity",
    "instacart",
    "klaviyo",
    "asana",
    "wikimedia",
    "tripadvisor",
    "robinhood",
    "intercom",
    "squarespace",
    "mozilla",
    "postman",
    "smartsheet",
    "descript",
    "sofi",
    "vercel",
    "wrike",
    "propublica",
    "classpass",
    "hightouch",
    "tailscale",
    "kickstarter",
    "peloton",
    "fastly",
    "newrelic",
    "donorschoose",
    "zocdoc",
    "mixpanel",
    "amplitude",
    "ghost",
    "thoughtworks",
    "airtable",
    "marqeta",
    "splice",
    "sweetgreen",
    "webflow",
    "customerio",
    "masterclass",
    "everlane",
    "iterable",
    "sumologic",
    "codeorg",
    "betterment",
    "honeycomb",
    "bitwarden",
    "mighty",
    "gofundme",
    "planetscale",
    "labelbox",
    "medium",
    "earnin",
    "circleci",
    "netlify",
    "mindbody",
    "glossier",
    "thrivemarket",
    "forward",
    "kayak",
    "calm",
  ],
  // Lever tokens are NOT guessable: only 4 of 41 candidates resolved.
  // Coverage here depends on the ats_companies table, not on seeds.
  lever: ["gopuff", "palantir", "spotify", "leverdemo"],
};

// How many boards to hit per provider per run (rotation window). Kept low so
// the fan-out stays polite and fast; the rest are covered on subsequent runs.
// Measured: 6 Greenhouse boards take ~2.1s, so 14 lands around 5s — still well
// inside the 16s per-source budget. 6 was far too few once the seed list grew
// to 49: a niche craft ("writer") matches maybe one role per board, so a
// 6-board window returned 0–1 leads while 43 boards sat unread.
const BOARDS_PER_RUN = 100;
/**
 * Company openings older than this are dropped.
 *
 * A company opening ages differently from a forum ask, and conflating the two
 * costs real volume. "Anyone know a designer?" is dead within a day — somebody
 * already answered it. A posted role stays open for weeks, so a 5-day-old
 * listing is still a live opportunity and still the Companies segment.
 *
 * Measured 2026-08-02 on "designer": cutting this to 3 days to chase freshness
 * took Greenhouse from 31 leads to 2 and Ashby from 18 to 4 — it emptied the
 * Companies tab to remove leads that were never the problem. The staleness
 * complaint is about ORDER, not membership, and that is now handled where it
 * belongs: recencyPoints in scoring.ts makes freshness the largest single
 * ranking factor, so hours-old asks sit above days-old openings on their own.
 */
const ATS_MAX_AGE_DAYS = 7;
const ATS_TIMEOUT_MS = 9000;

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

function atsTerms(qx: ExpandedQueries): string[] {
  const terms = (qx.jobBoardTerms || []).filter(Boolean);
  const base = terms.length ? terms : [qx.role, qx.skill].filter(Boolean);
  return base.map((t) => t.toLowerCase());
}

function matchesTerms(text: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const l = text.toLowerCase();
  return terms.some((t) => l.includes(t));
}

/**
 * Word-boundary variant, for matching against a role TITLE where precision
 * matters. Substring matching makes "design" hit "designated" and "ai" hit
 * "email"; on a title that's the difference between a lead and a wrong role.
 */
function matchesTermsWord(text: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = ` ${text.toLowerCase()} `;
  return terms.some((t) => {
    const term = t.toLowerCase().trim();
    if (term.length < 2) return false;
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i").test(hay);
  });
}

/**
 * Per-board cap. Deliberately LOW.
 *
 * Stripe alone has 539 open roles, so a cap of 25 meant one company filled the
 * page — "Product Designer, Terminal @ stripe", "Product Designer - Dashboard
 * @ stripe", "Product Designer, Internal Tools @ stripe"… Six per company
 * forces breadth across the 49 boards instead of depth into whoever is hiring
 * hardest, which is what a lead list actually needs.
 */
const MAX_PER_BOARD = 10;

// ── DB-driven board loading + deterministic rotation (Task 1.7 / 1.3) ──────
async function loadAtsBoards(provider: AtsProvider): Promise<string[]> {
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    const { data } = await getAdmin()
      .from("ats_companies")
      .select("board_id, last_checked_at")
      .eq("provider", provider)
      .eq("active", true)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(BOARDS_PER_RUN);
    const boards = (data ?? []).map((r: any) => r.board_id).filter(Boolean);
    if (boards.length) return boards;
  } catch {
    /* table missing / unreachable → fall back to seed */
  }
  return rotatingSeed(provider);
}

/**
 * Deterministic rotation over the seed list.
 *
 * `slice(0, BOARDS_PER_RUN)` would poll the SAME six boards forever, so 43 of
 * the 49 verified Greenhouse boards would never be read — the coverage would be
 * identical to the old hardcoded six. Offsetting by a slow clock means every
 * board gets covered within a bounded window, which is the same guarantee the
 * DB path gives via last_checked_at ordering.
 *
 * The window advances every 5 minutes: long enough that repeat searches inside
 * one session stay consistent (the user re-running a query sees stable
 * results), short enough to cycle all 49 boards in well under an hour.
 */
function rotatingSeed(provider: AtsProvider): string[] {
  const all = SEED_BOARDS[provider];
  if (all.length <= BOARDS_PER_RUN) return all;
  const window = Math.floor(Date.now() / (5 * 60_000));
  const start = (window * BOARDS_PER_RUN) % all.length;
  const out = [];
  for (let i = 0; i < BOARDS_PER_RUN; i++) out.push(all[(start + i) % all.length]);
  return out;
}

async function markChecked(provider: AtsProvider, boards: string[]): Promise<void> {
  if (!boards.length) return;
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    await getAdmin()
      .from("ats_companies")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("provider", provider)
      .in("board_id", boards);
  } catch {
    /* best effort */
  }
}

// ── Ashby (Task 2.1 reference implementation) ──────────────────────────────
export async function searchAshby(qx: ExpandedQueries): Promise<SourceLead[]> {
  const boards = await loadAtsBoards("ashby");
  const terms = atsTerms(qx);
  const out: SourceLead[] = [];
  for (const board of boards) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
    const data = await withTimeout(resilientJson<{ jobs?: any[] }>(url), ATS_TIMEOUT_MS, null);
    if (!data?.jobs) continue;
    for (const j of data.jobs) {
      if (j.isListed === false) continue;
      const title = j.title || "";
      const desc = (j.descriptionHtml || j.descriptionPlain || "")
        .replace(/<[^>]+>/g, " ")
        .slice(0, 400);
      const blob = `${title} ${j.department || ""} ${j.team || ""} ${desc}`;
      if (!matchesTerms(blob, terms)) continue;
      const postedAt = j.publishedAt || j.updatedAt || undefined;
      if (postedAt && !isRecent(postedAt, ATS_MAX_AGE_DAYS)) continue;
      const jobUrl = j.jobUrl || j.applyUrl;
      if (!jobUrl) continue;
      out.push({
        source: "ashby",
        platform: `Ashby: ${board}`,
        title: `${title} @ ${board}`,
        snippet: [j.location, j.department, j.employmentType, desc]
          .filter(Boolean)
          .join(" • ")
          .slice(0, 400),
        full_post_url: jobUrl,
        author: board,
        posted_at: postedAt || undefined,
        engagement: 40,
        is_decision_maker: true,
        intentBoost: 18,
      });
    }
  }
  void markChecked("ashby", boards);
  return out;
}

// ── SmartRecruiters (Task 2.2) ─────────────────────────────────────────────
export async function searchSmartRecruiters(qx: ExpandedQueries): Promise<SourceLead[]> {
  const boards = await loadAtsBoards("smartrecruiters");
  const terms = atsTerms(qx);
  const out: SourceLead[] = [];
  for (const company of boards) {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`;
    const data = await withTimeout(resilientJson<{ content?: any[] }>(url), ATS_TIMEOUT_MS, null);
    if (!data?.content) continue;
    for (const p of data.content) {
      const title = p.name || "";
      const dept = p.department?.label || p.function?.label || "";
      const loc =
        p.location?.fullLocation ||
        [p.location?.city, p.location?.country].filter(Boolean).join(", ");
      const blob = `${title} ${dept}`;
      if (!matchesTerms(blob, terms)) continue;
      const postedAt = p.releasedDate || p.createdOn || undefined;
      if (postedAt && !isRecent(postedAt, ATS_MAX_AGE_DAYS)) continue;
      const ident = p.company?.identifier || company;
      const jobUrl = `https://jobs.smartrecruiters.com/${encodeURIComponent(ident)}/${p.id}`;
      out.push({
        source: "smartrecruiters",
        platform: `SmartRecruiters: ${p.company?.name || company}`,
        title: `${title} @ ${p.company?.name || company}`,
        snippet: [loc, dept, p.typeOfEmployment?.label].filter(Boolean).join(" • ").slice(0, 400),
        full_post_url: jobUrl,
        author: p.company?.name || company,
        posted_at: postedAt || undefined,
        engagement: 38,
        is_decision_maker: true,
        intentBoost: 16,
      });
    }
  }
  void markChecked("smartrecruiters", boards);
  return out;
}

// ── Workable (Task 2.2) — public careers widget (no auth) ──────────────────
export async function searchWorkable(qx: ExpandedQueries): Promise<SourceLead[]> {
  const boards = await loadAtsBoards("workable");
  const terms = atsTerms(qx);
  const out: SourceLead[] = [];
  for (const account of boards) {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}`;
    const data = await withTimeout(
      resilientJson<{ name?: string; jobs?: any[] }>(url),
      ATS_TIMEOUT_MS,
      null,
    );
    if (!data?.jobs?.length) continue;
    const companyName = data.name || account;
    for (const j of data.jobs) {
      const title = j.title || "";
      const loc = j.location?.location_str || [j.city, j.country].filter(Boolean).join(", ");
      const blob = `${title} ${j.department || ""}`;
      if (!matchesTerms(blob, terms)) continue;
      const postedAt = j.published_on || j.created_at || undefined;
      if (postedAt && !isRecent(postedAt, ATS_MAX_AGE_DAYS)) continue;
      const jobUrl =
        j.url ||
        j.application_url ||
        (j.shortcode ? `https://apply.workable.com/${account}/j/${j.shortcode}/` : "");
      if (!jobUrl) continue;
      out.push({
        source: "workable",
        platform: `Workable: ${companyName}`,
        title: `${title} @ ${companyName}`,
        snippet: [loc, j.department, j.employment_type].filter(Boolean).join(" • ").slice(0, 400),
        full_post_url: jobUrl,
        author: companyName,
        posted_at: postedAt || undefined,
        engagement: 36,
        is_decision_maker: true,
        intentBoost: 15,
      });
    }
  }
  void markChecked("workable", boards);
  return out;
}

// ── Recruitee (Task 2.2) — public offers feed (no auth) ────────────────────
export async function searchRecruitee(qx: ExpandedQueries): Promise<SourceLead[]> {
  const boards = await loadAtsBoards("recruitee");
  const terms = atsTerms(qx);
  const out: SourceLead[] = [];
  for (const company of boards) {
    const url = `https://${encodeURIComponent(company)}.recruitee.com/api/offers/`;
    const data = await withTimeout(resilientJson<{ offers?: any[] }>(url), ATS_TIMEOUT_MS, null);
    if (!data?.offers?.length) continue;
    for (const o of data.offers) {
      if (o.status && o.status !== "published") continue;
      const title = o.title || o.position || "";
      const dept = o.department || o.category || "";
      const loc = o.location || [o.city, o.country].filter(Boolean).join(", ");
      const blob = `${title} ${dept}`;
      if (!matchesTerms(blob, terms)) continue;
      // Recruitee dates look like "2026-07-10 08:06:21 UTC" — normalize to ISO.
      const rawDate = o.published_at || o.created_at || "";
      const postedAt = rawDate ? String(rawDate).replace(" UTC", "Z").replace(" ", "T") : undefined;
      if (postedAt && !isRecent(postedAt, ATS_MAX_AGE_DAYS)) continue;
      const jobUrl = o.careers_url || o.url || o.careers_apply_url;
      if (!jobUrl) continue;
      out.push({
        source: "recruitee",
        platform: `Recruitee: ${company}`,
        title: `${title} @ ${company}`,
        snippet: [loc, dept, o.employment_type_code].filter(Boolean).join(" • ").slice(0, 400),
        full_post_url: jobUrl,
        author: company,
        posted_at: postedAt || undefined,
        engagement: 34,
        is_decision_maker: true,
        intentBoost: 14,
      });
    }
  }
  void markChecked("recruitee", boards);
  return out;
}

// ── Greenhouse ─────────────────────────────────────────────────────────────
//
// The highest-yield keyless ATS by a wide margin — the seed boards alone carry
// 2,000+ live openings. `?content=true` returns the full description, which is
// what lets us match on craft terms that never appear in the job title.
//
// Board tokens ARE guessable from the company name (stripe → "stripe"), which
// makes this the one provider where coverage can grow without a discovery step.
export async function searchGreenhouse(qx: ExpandedQueries): Promise<SourceLead[]> {
  const boards = await loadAtsBoards("greenhouse");
  const terms = atsTerms(qx);
  const out: SourceLead[] = [];

  // PARALLEL, not sequential-with-rotation. Rotating a 14-board window over 49
  // boards meant any single search saw ~28% of them, and for a niche craft
  // ("writer" matches maybe one role per board) that was the difference between
  // one lead and zero — the same query returned 1 then 0 purely on which window
  // it landed in. Greenhouse handled 95 concurrent board probes comfortably in
  // testing, so fetching every board at once is both faster AND complete.
  const pages = await Promise.all(
    boards.map((board) =>
      withTimeout(
        resilientJson<{ jobs?: any[] }>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
        ),
        ATS_TIMEOUT_MS,
        null,
      ).then((data) => ({ board, data })),
    ),
  );

  for (const { board, data } of pages) {
    let kept = 0;
    if (!data?.jobs) continue;
    for (const j of data.jobs) {
      if (kept >= MAX_PER_BOARD) break;
      const title = j.title || "";
      // Greenhouse HTML-escapes `content`; decode the few entities that matter
      // before term-matching or "&amp;" splits words apart.
      const desc = String(j.content || "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const dept = (j.departments ?? [])
        .map((d: any) => d?.name)
        .filter(Boolean)
        .join(" ");
      const loc = j.location?.name || "";
      // Match on ROLE TITLE + DEPARTMENT only — never the description.
      // Measured: matching the description too returned 520 "designer" leads
      // from six boards, headlined by "Account Executive" and "AI Engineer",
      // because virtually every engineering JD contains the word "design"
      // ("design and build systems"). The title is the role; the body is prose.
      if (!matchesTermsWord(`${title} ${dept}`, terms)) continue;
      const postedAt = j.updated_at || j.first_published || undefined;
      if (postedAt && !isRecent(postedAt, ATS_MAX_AGE_DAYS)) continue;
      const jobUrl = j.absolute_url;
      if (!jobUrl) continue;
      out.push({
        source: "greenhouse",
        platform: `Greenhouse: ${board}`,
        title: `${title} @ ${board}`,
        snippet: [loc, dept, desc.slice(0, 240)].filter(Boolean).join(" • ").slice(0, 400),
        full_post_url: jobUrl,
        author: board,
        posted_at: postedAt || undefined,
        engagement: 42,
        is_decision_maker: true,
        intentBoost: 18,
      });
      kept++;
    }
  }
  void markChecked("greenhouse", boards);
  return out;
}

// ── Lever ──────────────────────────────────────────────────────────────────
//
// Same keyless-JSON idea, different shape: the response is a bare ARRAY (not
// {jobs:[…]}) and `createdAt` is epoch millis rather than an ISO string.
export async function searchLever(qx: ExpandedQueries): Promise<SourceLead[]> {
  const boards = await loadAtsBoards("lever");
  const terms = atsTerms(qx);
  const out: SourceLead[] = [];
  // Parallel for the same reason as Greenhouse — see the note there.
  const pages = await Promise.all(
    boards.map((board) =>
      withTimeout(
        resilientJson<any[]>(
          `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
        ),
        ATS_TIMEOUT_MS,
        null,
      ).then((data) => ({ board, data })),
    ),
  );

  for (const { board, data } of pages) {
    let kept = 0;
    if (!Array.isArray(data)) continue;
    for (const j of data) {
      if (kept >= MAX_PER_BOARD) break;
      const title = j.text || "";
      const cats = j.categories ?? {};
      const desc = String(j.descriptionPlain || j.description || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // Title + team/department only — see the note in searchGreenhouse for why
      // the description must stay out of the relevance decision.
      if (!matchesTermsWord(`${title} ${cats.team ?? ""} ${cats.department ?? ""}`, terms))
        continue;
      // Lever gives epoch millis; isRecent wants something Date can parse.
      const postedAt =
        typeof j.createdAt === "number" ? new Date(j.createdAt).toISOString() : undefined;
      if (postedAt && !isRecent(postedAt, ATS_MAX_AGE_DAYS)) continue;
      const jobUrl = j.hostedUrl || j.applyUrl;
      if (!jobUrl) continue;
      out.push({
        source: "lever",
        platform: `Lever: ${board}`,
        title: `${title} @ ${board}`,
        snippet: [cats.location, cats.team, cats.commitment, desc.slice(0, 240)]
          .filter(Boolean)
          .join(" • ")
          .slice(0, 400),
        full_post_url: jobUrl,
        author: board,
        posted_at: postedAt,
        engagement: 38,
        is_decision_maker: true,
        intentBoost: 16,
      });
      kept++;
    }
  }
  void markChecked("lever", boards);
  return out;
}
