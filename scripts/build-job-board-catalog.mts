/**
 * Build a curated ATS board catalog for the Jobs page from the vendored
 * freehire board lists (freehire/sources_normalized.json — 93k curated boards).
 *
 * Output: data/job_boards_catalog.json — { provider: string[] } with boards
 * capped per provider and junk names filtered, so the /jobs adapters fetch a
 * few hundred high-quality boards instead of ~30 seed boards.
 *
 * Run: npx tsx scripts/build-job-board-catalog.mts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type Board = {
  company?: string;
  normalized_company?: string;
  company_key?: string;
  provider: string;
  board?: string;
  region?: string;
};

const CAPS: Record<string, number> = {
  greenhouse: 220,
  ashby: 90,
  lever: 90,
  smartrecruiters: 60,
  workable: 40,
  recruitee: 40,
};

/** Board tokens that are clearly not real company boards. */
const JUNK_BOARD_RE =
  /^(test|demo|example|sample|sandbox|staging|default|template|\d{3,}|[a-f0-9]{16,})$/i;

/** Companies that are staffing/agency spam or duplicated mega-lists. */
const JUNK_COMPANY_RE =
  /^(job|career|hiring|recruit|staffing|talent|remote|apply|work|indeed|linkedin|upwork|fiverr|freelancer|toptal|andela|turing|test|demo)/i;

function main() {
  const src = resolve(process.cwd(), "freehire/sources_normalized.json");
  if (!existsSync(src)) {
    console.error(`[catalog] missing ${src} — run from the repo root`);
    process.exit(1);
  }
  const all = JSON.parse(readFileSync(src, "utf8")) as Board[];
  const catalog: Record<string, string[]> = {};

  for (const [provider, cap] of Object.entries(CAPS)) {
    const seen = new Set<string>();
    const boards: string[] = [];
    for (const b of all) {
      if (b.provider !== provider) continue;
      const board = (b.board || b.company_key || "").trim();
      const company = (b.company || b.normalized_company || "").trim();
      if (!board) continue;
      const key = board.toLowerCase();
      if (seen.has(key)) continue;
      if (JUNK_BOARD_RE.test(board) || JUNK_COMPANY_RE.test(company)) continue;
      // Prefer named companies over numeric/uuid boards.
      if (/^\d+$/.test(board) && boards.length < cap / 2) continue;
      seen.add(key);
      boards.push(board);
      if (boards.length >= cap) break;
    }
    catalog[provider] = boards;
    console.log(`[catalog] ${provider}: ${boards.length} boards`);
  }

  const out = resolve(process.cwd(), "data/job_boards_catalog.json");
  writeFileSync(out, JSON.stringify(catalog, null, 2));
  console.log(`[catalog] wrote ${out}`);
}

main();
