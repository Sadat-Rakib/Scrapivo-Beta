/**
 * Workday CXS jobs source — free public JSON endpoint per tenant.
 *   POST https://{tenant}.{host}/wday/cxs/{tenant}/{site}/jobs
 * Only VERIFIED tenant/site pairs from data/workday_tenants.json are hit;
 * grow the list with scripts/probe-workday-tenants.mts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerJobSource } from "./registry";
import { guessSeniority, looksRemote } from "./filters";
import type { RawJobPosting } from "./types";
import { sanitizeJobText } from "./hygiene";

type WorkdayEndpoint = { tenant: string; host: string; site: string };
type WdPosting = {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
};

const CAP = Number(process.env.WORKDAY_CAP ?? 80);
/** Endpoints hit per query. The tenant file now holds 1,000+ verified pairs —
 *  sampling a rotating window keeps per-query fan-out bounded while every
 *  endpoint still gets covered across runs (same guarantee as the ATS
 *  boards' last_checked_at rotation). */
const ENDPOINTS_PER_RUN = Number(process.env.WORKDAY_ENDPOINTS_PER_RUN ?? 24);
let endpoints: WorkdayEndpoint[] | null = null;

function loadEndpoints(): WorkdayEndpoint[] {
  if (endpoints) return endpoints;
  try {
    const file = JSON.parse(readFileSync(resolve("data/workday_tenants.json"), "utf8")) as {
      verified?: WorkdayEndpoint[];
    };
    endpoints = (file.verified ?? []).filter((e) => e.tenant && e.host && e.site);
  } catch {
    endpoints = [];
  }
  return endpoints;
}

/** Deterministic rotation over the tenant list — a 5-minute window, like the
 *  ATS boards' seed rotation, so repeat searches stay consistent within a
 *  session while the full catalog cycles over time. */
function sampleEndpoints(all: WorkdayEndpoint[]): WorkdayEndpoint[] {
  if (all.length <= ENDPOINTS_PER_RUN) return all;
  const window = Math.floor(Date.now() / (5 * 60_000));
  const start = (window * ENDPOINTS_PER_RUN) % all.length;
  const out: WorkdayEndpoint[] = [];
  for (let i = 0; i < ENDPOINTS_PER_RUN; i++) out.push(all[(start + i) % all.length]);
  return out;
}

/** "Posted 3 Days Ago" | "Posted Today" | "Posted 30+ Days Ago" → age days. */
function postedOnToAgeDays(s: string): number | null {
  const m = /posted\s+(today|yesterday|\d+\+?\s+days?\s+ago)/i.exec(s || "");
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t === "today") return 0;
  if (t === "yesterday") return 1;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchEndpoint(ep: WorkdayEndpoint, query: string): Promise<RawJobPosting[]> {
  const base = `https://${ep.tenant}.${ep.host}`;
  const url = `${base}/wday/cxs/${ep.tenant}/${ep.site}/jobs`;
  const out: RawJobPosting[] = [];
  // Workday CXS hard-caps `limit` at 20 — anything higher 400s. Paginate.
  const PAGE = 20;
  for (let offset = 0; offset < CAP; offset += PAGE) {
    let data: { jobPostings?: WdPosting[]; total?: number } | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Scrapivo/1.0 (jobs search; contact: support@scrapivo.app)",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE,
          offset,
          searchText: query ?? "",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) break;
      data = (await res.json().catch(() => null)) as { jobPostings?: WdPosting[] } | null;
    } catch {
      break;
    }
    const postings = data?.jobPostings ?? [];
    for (const p of postings) {
      const title = sanitizeJobText(p.title);
      if (!title || !p.externalPath) continue;
      const url2 = p.externalPath.startsWith("http")
        ? p.externalPath
        : `${base}${p.externalPath.startsWith("/") ? "" : "/"}${p.externalPath}`;
      const loc = sanitizeJobText(p.locationsText);
      const ageDays = postedOnToAgeDays(p.postedOn ?? "");
      out.push({
        title,
        company: ep.tenant.charAt(0).toUpperCase() + ep.tenant.slice(1),
        location: loc || null,
        url: url2,
        source: "source-ats-workday",
        board_id: `${ep.tenant}/${ep.site}`,
        posted_at:
          ageDays != null ? new Date(Date.now() - ageDays * 86_400_000).toISOString() : null,
        description: null,
        salary: null,
        remote: looksRemote(loc, title, ""),
        seniority: guessSeniority(title),
      });
    }
    if (postings.length < PAGE) break;
  }
  return out;
}

let registered = false;
export function ensureWorkdayAdapterRegistered(): void {
  if (registered) return;
  registered = true;
  registerJobSource({
    id: "source-ats-workday",
    label: "Workday",
    fetch: async (filters) => {
      const all = loadEndpoints();
      if (!all.length) return [];
      const eps = sampleEndpoints(all);
      const batches = await Promise.all(eps.map((ep) => fetchEndpoint(ep, filters.query ?? "")));
      return batches.flat().slice(0, CAP);
    },
  });
}
