/**
 * Runs every FREE source independently and reports leads + wall time.
 *
 * Discover fans out to ~40 sources and reports one number per source, which
 * hides whether a zero means "this source is broken", "it was starved of
 * budget" or "it genuinely had nothing". Running them in isolation, off the
 * shared budget, separates those cases.
 *
 *   npx tsx scripts/audit-free-sources.ts "designer"
 */
import { readFileSync } from "node:fs";

// tsx does not read .env the way Vite does, and a missing SEARXNG_URL would
// make every dork-backed source look broken for the wrong reason.
function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const QUERY = process.argv[2] ?? "designer";
const SOURCE_BUDGET_MS = 28_000;

type Row = {
  name: string;
  leads: number;
  ms: number;
  error?: string;
  /** Age buckets, so "relevant but ancient" is visible per source. */
  ages?: Record<AgeBucket, number>;
};

type AgeBucket = "<1h" | "<24h" | "1-3d" | "3-7d" | "7-30d" | ">30d" | "undated";
const BUCKETS: AgeBucket[] = ["<1h", "<24h", "1-3d", "3-7d", "7-30d", ">30d", "undated"];

function bucketOf(postedAt: unknown): AgeBucket {
  if (typeof postedAt !== "string" || !postedAt) return "undated";
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return "undated";
  const h = (Date.now() - t) / 3_600_000;
  if (h < 1) return "<1h";
  if (h < 24) return "<24h";
  if (h < 72) return "1-3d";
  if (h < 168) return "3-7d";
  if (h < 720) return "7-30d";
  return ">30d";
}

function tallyAges(leads: ReadonlyArray<{ posted_at?: unknown }>): Record<AgeBucket, number> {
  const t = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<AgeBucket, number>;
  for (const l of leads) t[bucketOf(l.posted_at)]++;
  return t;
}

async function main() {
  const { expandQuery } = await import("../src/lib/search/query-expander");
  const qx = expandQuery(QUERY);

  const sources = await import("../src/lib/search/sources.server");
  const freelance = await import("../src/lib/search/freelance-sources.server");
  const community = await import("../src/lib/search/community-sources.server");
  const fediverse = await import("../src/lib/search/fediverse-sources.server");
  const startup = await import("../src/lib/search/startup-sources.server");
  const gov = await import("../src/lib/search/gov-sources.server");
  const ats = await import("../src/lib/search/ats-sources.server");
  const { searchRedditRss } = await import("../src/lib/search/reddit-rss.server");
  const { searchSocialDorks } = await import("../src/lib/search/social-dorks.server");
  const { withSearxngBudget } = await import("../src/lib/search/searxng.server");

  type Entry = [string, () => Promise<{ length: number }>];
  const entries: Entry[] = [
    // ── native APIs / feeds: no search engine involved ──
    ["redditrss", () => searchRedditRss(qx).then((r) => r.leads)],
    ["hn", () => sources.searchHackerNews(qx)],
    ["bluesky", () => sources.searchBluesky(qx)],
    ["mastodon", () => fediverse.searchMastodon(qx)],
    ["lemmy", () => fediverse.searchLemmy(qx)],
    ["devto", () => sources.searchDevTo(qx)],
    ["lobsters", () => sources.searchLobsters(qx)],
    ["indiehackers", () => sources.searchIndieHackers(qx)],
    ["hashnode", () => sources.searchHashnode(qx)],
    ["discourse", () => community.searchDiscourse(qx)],
    ["producthunt", () => community.searchProductHunt(qx)],
    ["tenders", () => community.searchPublicTenders(qx)],
    // ── freelance marketplaces ──
    ["freelancer", () => freelance.searchFreelancer(qx)],
    ["remoteokapi", () => freelance.searchRemoteOkApi(qx)],
    ["workingnomads", () => freelance.searchWorkingNomads(qx)],
    // ── public sector ──
    ["usajobs", () => sources.searchUSAJobs(qx)],
    ["samgov", () => sources.searchSamGov(qx)],
    ["secedgar", () => gov.searchSecEdgar(qx)],
    // ── job boards / ATS ──
    ["wwr", () => sources.searchWeWorkRemotely(qx)],
    ["remotive", () => sources.searchRemotive(qx)],
    ["jobicy", () => sources.searchJobicy(qx)],
    ["arbeitnow", () => sources.searchArbeitnow(qx)],
    ["themuse", () => sources.searchTheMuse(qx)],
    ["greenhouse", () => ats.searchGreenhouse(qx)],
    ["ashby", () => ats.searchAshby(qx)],
    ["lever", () => ats.searchLever(qx)],
    ["smartrecruiters", () => ats.searchSmartRecruiters(qx)],
    ["workable", () => ats.searchWorkable(qx)],
    ["recruitee", () => ats.searchRecruitee(qx)],
    // ── startup / misc ──
    ["workatastartup", () => startup.searchWorkAtAStartup(qx)],
    ["startupsgallery", () => startup.searchStartupsGallery(qx)],
    ["githubhiring", () => startup.searchGitHubHiringLists(qx)],
    // ── dork-backed (needs healthy search engines) ──
    ["socialdorks", () => searchSocialDorks(qx)],
    ["webboolean", () => sources.searchWebBoolean(qx)],
  ];

  const only = process.argv[3]?.split(",").map((s) => s.trim());
  const selected = only ? entries.filter(([n]) => only.includes(n)) : entries;

  console.log(`query "${QUERY}" -> skill="${qx.skill}" role="${qx.role}"`);
  console.log(`running ${selected.length} free sources independently\n`);

  const rows: Row[] = [];
  // Each source gets its own budget scope, exactly like a real run gives the
  // whole fan-out one. Sequential so a slow source cannot be blamed on
  // contention with the others.
  for (const [name, run] of selected) {
    const started = Date.now();
    try {
      const leads = (await withSearxngBudget(() => run())) as unknown as Array<{
        posted_at?: unknown;
      }>;
      rows.push({
        name,
        leads: leads.length,
        ms: Date.now() - started,
        ages: tallyAges(leads),
      });
    } catch (e) {
      rows.push({
        name,
        leads: 0,
        ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const r = rows.at(-1)!;
    const flag = r.error ? "ERROR" : r.ms > SOURCE_BUDGET_MS ? "TOO SLOW" : "";
    const age = r.ages
      ? BUCKETS.filter((b) => r.ages![b] > 0)
          .map((b) => `${b}:${r.ages![b]}`)
          .join(" ")
      : "";
    console.log(
      `${r.name.padEnd(16)} ${String(r.leads).padStart(4)} leads  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${flag}${r.error ? ` ${r.error.slice(0, 70)}` : ""}  ${age}`,
    );
  }

  const working = rows.filter((r) => r.leads > 0);
  const empty = rows.filter((r) => r.leads === 0 && !r.error);
  const broken = rows.filter((r) => r.error);
  const slow = rows.filter((r) => r.ms > SOURCE_BUDGET_MS);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`producing leads : ${working.length}  (${rows.reduce((n, r) => n + r.leads, 0)} total)`);
  console.log(`returning zero  : ${empty.length}  ${empty.map((r) => r.name).join(", ")}`);
  if (broken.length) console.log(`throwing        : ${broken.length}  ${broken.map((r) => r.name).join(", ")}`);
  if (slow.length) console.log(`over budget     : ${slow.length}  ${slow.map((r) => r.name).join(", ")}`);

  console.log("\ntop producers:");
  for (const r of [...working].sort((a, b) => b.leads - a.leads).slice(0, 12)) {
    console.log(`  ${String(r.leads).padStart(4)}  ${r.name} (${(r.ms / 1000).toFixed(1)}s)`);
  }

  // The thing the user is actually complaining about: relevant, but ancient.
  const totals = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<AgeBucket, number>;
  for (const r of rows) for (const b of BUCKETS) totals[b] += r.ages?.[b] ?? 0;
  const all = BUCKETS.reduce((n, b) => n + totals[b], 0) || 1;
  console.log("\nAGE DISTRIBUTION across every source:");
  for (const b of BUCKETS) {
    const n = totals[b];
    const pct = Math.round((n / all) * 100);
    console.log(`  ${b.padEnd(8)} ${String(n).padStart(4)}  ${"#".repeat(Math.round(pct / 2))} ${pct}%`);
  }

  const stale = rows
    .filter((r) => (r.ages?.["7-30d"] ?? 0) + (r.ages?.[">30d"] ?? 0) + (r.ages?.["3-7d"] ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.ages!["3-7d"] + b.ages!["7-30d"] + b.ages![">30d"]) -
        (a.ages!["3-7d"] + a.ages!["7-30d"] + a.ages![">30d"]),
    );
  if (stale.length) {
    console.log("\nsources shipping leads older than 3 days:");
    for (const r of stale) {
      console.log(
        `  ${r.name.padEnd(16)} 3-7d:${r.ages!["3-7d"]}  7-30d:${r.ages!["7-30d"]}  >30d:${r.ages![">30d"]}  undated:${r.ages!.undated}`,
      );
    }
  }
}

void main();
