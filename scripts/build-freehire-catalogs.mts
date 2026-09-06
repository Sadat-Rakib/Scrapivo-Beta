/**
 * Expand Scrapivo's ATS/company catalogs from the vendored freehire board
 * lists (freehire/sources_normalized.json — 93,379 curated company→board
 * pairs, MIT). Regenerates THREE files in one pass:
 *
 *   data/job_boards_catalog.json   { provider: string[] }   (jobs page adapters)
 *   data/company_ats_tenants.json  AtsTenant[]              (extra tenant boards)
 *   data/workday_tenants.json      { verified: tenant/host/site[] } (Workday CXS)
 *
 * Runtime is bounded downstream regardless of file size:
 *   - ats-adapters.ts caps merged boards at BOARD_CAPS per provider
 *   - workday-adapter.ts samples WORKDAY_ENDPOINTS_PER_RUN endpoints per query
 *
 * Run: npx tsx scripts/build-freehire-catalogs.mts
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";

type Board = {
  company?: string;
  normalized_company?: string;
  company_key?: string;
  provider: string;
  board?: string;
  region?: string;
};

/** Catalog caps (boards per provider for the jobs page). */
const CAPS: Record<string, number> = {
  greenhouse: 600,
  ashby: 250,
  lever: 250,
  smartrecruiters: 150,
  workable: 120,
  recruitee: 120,
};

const TENANT_CAPS: Record<string, number> = {
  greenhouse: 600,
  ashby: 250,
  lever: 250,
  smartrecruiters: 150,
  workable: 120,
  recruitee: 120,
};

const WORKDAY_CAP = 1_200;

/** Board tokens that are clearly not real company boards. */
const JUNK_BOARD_RE =
  /^(test|demo|example|sample|sandbox|staging|default|template|\d{3,}|[a-f0-9]{16,})$/i;

/** Companies that are staffing/agency spam or duplicated mega-lists. */
const JUNK_COMPANY_RE =
  /^(job|career|hiring|recruit|staffing|talent|remote|apply|work|indeed|linkedin|upwork|fiverr|freelancer|toptal|andela|turing|test|demo)/i;

function loadSource(): Board[] {
  const src = resolve(process.cwd(), "freehire/sources_normalized.json");
  if (!existsSync(src)) {
    console.error(`[catalogs] missing ${src} — run from the repo root`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(src, "utf8")) as Board[];
}

function clean(provider: string, b: Board): { board: string; company: string } | null {
  if (b.provider !== provider) return null;
  const board = (b.board || b.company_key || "").trim();
  const company = (b.company || b.normalized_company || "").trim();
  if (!board) return null;
  if (JUNK_BOARD_RE.test(board) || JUNK_COMPANY_RE.test(company)) return null;
  return { board, company };
}

function buildBoardCatalog(all: Board[]): Record<string, string[]> {
  const catalog: Record<string, string[]> = {};
  for (const [provider, cap] of Object.entries(CAPS)) {
    const seen = new Set<string>();
    const boards: string[] = [];
    for (const b of all) {
      const c = clean(provider, b);
      if (!c) continue;
      const key = c.board.toLowerCase();
      if (seen.has(key)) continue;
      // Prefer named companies over numeric/uuid boards.
      if (/^\d+$/.test(c.board) && boards.length < cap / 2) continue;
      seen.add(key);
      boards.push(c.board);
      if (boards.length >= cap) break;
    }
    catalog[provider] = boards;
    console.log(`[catalogs] job_boards ${provider}: ${boards.length} boards`);
  }
  return catalog;
}

function buildTenants(all: Board[]): { company: string; provider: string; board: string }[] {
  const out: { company: string; provider: string; board: string }[] = [];
  for (const [provider, cap] of Object.entries(TENANT_CAPS)) {
    const seen = new Set<string>();
    let n = 0;
    for (const b of all) {
      const c = clean(provider, b);
      if (!c) continue;
      const key = `${provider}:${c.board.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ company: c.company || c.board, provider, board: c.board });
      n++;
      if (n >= cap) break;
    }
    console.log(`[catalogs] tenants ${provider}: ${n}`);
  }
  return out;
}

/**
 * freehire workday rows carry board = "host/site"
 * (e.g. "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite").
 * Scrapivo's Workday CXS adapter needs {tenant, host, site}.
 */
function buildWorkday(all: Board[]): { verified: { tenant: string; host: string; site: string }[] } {
  const seen = new Set<string>();
  const verified: { tenant: string; host: string; site: string }[] = [];
  for (const b of all) {
    if (b.provider !== "workday") continue;
    const board = (b.board || "").trim();
    const dot = board.indexOf(".");
    const slash = board.indexOf("/");
    if (dot <= 0 || slash <= dot + 1 || slash >= board.length - 1) continue;
    const host = board.slice(0, slash);
    const site = board.slice(slash + 1);
    const tenant = host.slice(0, dot);
    const hostDomain = host.slice(dot + 1);
    // Only real Workday CXS hosts (wdN.myworkdayjobs.com family).
    if (!/^wd\d*\.myworkdayjobs\.com$/.test(hostDomain)) continue;
    const key = `${tenant}/${site}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    verified.push({ tenant, host: hostDomain, site });
    if (verified.length >= WORKDAY_CAP) break;
  }
  console.log(`[catalogs] workday tenants: ${verified.length}`);
  return { verified };
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  const prev = `${path}.prev`;
  try {
    renameSync(path, prev);
  } catch {
    /* first run — no previous */
  }
  renameSync(tmp, path);
  console.log(`[catalogs] wrote ${path} (${(content.length / 1024).toFixed(0)} KiB)`);
}

function main() {
  const all = loadSource();
  writeAtomic(
    resolve(process.cwd(), "data/job_boards_catalog.json"),
    JSON.stringify(buildBoardCatalog(all), null, 2),
  );
  writeAtomic(
    resolve(process.cwd(), "data/company_ats_tenants.json"),
    JSON.stringify(buildTenants(all), null, 2),
  );
  writeAtomic(
    resolve(process.cwd(), "data/workday_tenants.json"),
    JSON.stringify(buildWorkday(all), null, 2),
  );
  console.log("[catalogs] done");
}

main();
