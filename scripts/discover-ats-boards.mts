/**
 * Populate `ats_companies` at scale.
 *
 *   npx tsx scripts/discover-ats-boards.mts            # discover + write to DB
 *   npx tsx scripts/discover-ats-boards.mts --dry      # probe only, no writes
 *   npx tsx scripts/discover-ats-boards.mts --limit 2000
 *
 * WHY A SCRIPT AND NOT A LONGER HARDCODED LIST
 * Hand-listing boards caps coverage at whatever someone typed, and every board
 * has to be re-verified by hand when a company migrates ATS. This derives
 * candidates from a real corpus, probes them, and writes only what answered —
 * so coverage grows by re-running, not by editing source.
 *
 * WHERE CANDIDATES COME FROM
 * SEC EDGAR publishes company_tickers.json: ~10,000 US public companies, free,
 * no key. Slugifying those names produces high-quality candidate tokens, because
 * ATS board tokens are almost always the company name lowercased
 * ("Stripe, Inc." → "stripe"). We already hit EDGAR elsewhere in the app, so
 * this adds no new dependency.
 *
 * Measured hit rate on the first 211 hand-picked candidates: 80 live (38%).
 * Expect lower on the EDGAR tail — many public companies use Workday or
 * Taleo, which have no free public JSON — but the absolute number is what
 * matters, and it scales with the corpus.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── env ─────────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const DRY = process.argv.includes("--dry");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 1500;
/** Parallel probes in flight. Each provider is a different host, so this is
 *  spread across six origins — well within polite limits for any one of them. */
const CONCURRENCY = 40;

const UA = process.env.SEC_EDGAR_USER_AGENT || "Scrapivo/1.0 (contact@scrapivo.app)";

type Provider = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "recruitee";

type Probe = {
  url: (token: string) => string;
  count: (data: unknown) => number;
};

/**
 * One probe per provider. Each returns the number of open roles, which is both
 * the liveness check and a popularity signal worth storing.
 */
const PROBES: Record<Provider, Probe> = {
  greenhouse: {
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    count: (d) => ((d as { jobs?: unknown[] })?.jobs ?? []).length,
  },
  lever: {
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    count: (d) => (Array.isArray(d) ? d.length : 0),
  },
  ashby: {
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    count: (d) => ((d as { jobs?: unknown[] })?.jobs ?? []).length,
  },
  smartrecruiters: {
    url: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=1`,
    count: (d) => ((d as { totalFound?: number })?.totalFound ?? 0),
  },
  workable: {
    url: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`,
    count: (d) => ((d as { jobs?: unknown[] })?.jobs ?? []).length,
  },
  recruitee: {
    url: (t) => `https://${t}.recruitee.com/api/offers/`,
    count: (d) => ((d as { offers?: unknown[] })?.offers ?? []).length,
  },
};

/** "Stripe, Inc." → "stripe". Board tokens drop legal suffixes and punctuation. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|holdings?|group|technologies|technology|labs?|systems)\b/g,
      " ",
    )
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function fetchEdgarCompanies(): Promise<Array<{ name: string; ticker: string }>> {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`EDGAR returned ${res.status}`);
  const data = (await res.json()) as Record<string, { title: string; ticker: string }>;
  return Object.values(data).map((c) => ({ name: c.title, ticker: c.ticker }));
}

type Hit = { provider: Provider; board_id: string; company_name: string; job_count: number };

async function probeOne(provider: Provider, token: string, name: string): Promise<Hit | null> {
  const p = PROBES[provider];
  try {
    const res = await fetch(p.url(token), {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const n = p.count(await res.json());
    // Zero open roles means the board exists but is empty — not worth polling
    // on every search, and it may simply be a name collision.
    if (n <= 0) return null;
    return { provider, board_id: token, company_name: name, job_count: n };
  } catch {
    return null;
  }
}

/** Run tasks with a fixed number in flight — no external dependency needed. */
async function pooled<T>(tasks: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const out: T[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      out.push(await tasks[i]());
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  console.log("Fetching company corpus from SEC EDGAR…");
  const companies = await fetchEdgarCompanies();
  console.log(`  ${companies.length.toLocaleString()} companies`);

  // Dedupe by slug — many tickers map to the same company name.
  const seen = new Set<string>();
  const candidates: Array<{ token: string; name: string }> = [];
  for (const c of companies) {
    const token = slugify(c.name);
    // Sub-3-char tokens collide with unrelated boards ("hp", "gm").
    if (token.length < 3 || seen.has(token)) continue;
    seen.add(token);
    candidates.push({ token, name: c.name });
    if (candidates.length >= LIMIT) break;
  }
  console.log(`  ${candidates.length.toLocaleString()} unique candidate tokens (limit ${LIMIT})\n`);

  const providers = Object.keys(PROBES) as Provider[];
  const tasks = candidates.flatMap((c) =>
    providers.map((provider) => () => probeOne(provider, c.token, c.name)),
  );

  console.log(`Probing ${tasks.length.toLocaleString()} (candidate × provider) combinations…`);
  const t0 = Date.now();
  const results = await pooled(tasks, CONCURRENCY);
  const hits = results.filter((r): r is Hit => r !== null);
  console.log(`  ${hits.length} live boards in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  const byProvider = new Map<Provider, number>();
  for (const h of hits) byProvider.set(h.provider, (byProvider.get(h.provider) ?? 0) + 1);
  for (const [p, n] of [...byProvider].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(18)} ${n}`);
  }

  const top = [...hits].sort((a, b) => b.job_count - a.job_count).slice(0, 10);
  console.log("\nBiggest boards found:");
  for (const h of top) console.log(`  ${String(h.job_count).padStart(5)}  ${h.provider}/${h.board_id}`);

  if (DRY) {
    console.log("\n--dry: no database writes.");
    return;
  }

  // Match admin.server.ts — this project prefixes its Supabase vars with MY_.
  const url = process.env.MY_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.MY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(
      "\nSkipping DB write: set MY_SUPABASE_SERVICE_ROLE_KEY and MY_SUPABASE_URL to persist.\n" +
        "The boards above are valid — re-run with those set to populate ats_companies.",
    );
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  // Only the columns the live table actually has. It predates this script with
  // a leaner shape (provider, board_id, active, last_checked_at, added_by,
  // created_at) — inserting company_name/job_count fails with a schema-cache
  // error. The migration in supabase/migrations adds the richer columns; until
  // it is applied, these three are all that is needed for rotation to work.
  const rows = hits.map((h) => ({
    provider: h.provider,
    board_id: h.board_id,
    active: true,
  }));

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("ats_companies")
      .upsert(chunk, { onConflict: "provider,board_id" });
    if (error) {
      console.error(`  batch ${i / 500 + 1} failed: ${error.message}`);
      continue;
    }
    written += chunk.length;
  }
  console.log(`\nWrote ${written} boards to ats_companies.`);
}

main().catch((e) => {
  console.error("discover-ats-boards failed:", e.message);
  process.exit(1);
});
