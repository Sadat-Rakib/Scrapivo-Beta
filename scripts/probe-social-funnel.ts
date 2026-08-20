/**
 * Why do the social / community sources return zero?
 *
 * "0 leads, no error" has three very different causes and the audit cannot
 * tell them apart: the API is dead, the API answers but we ask the wrong
 * thing, or the API answers well and our own gates throw it all away. This
 * probes each API directly, then replays the gates one at a time so the
 * surviving count is visible at every step.
 *
 *   npx tsx scripts/probe-social-funnel.ts "designer"
 */
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv();

const CRAFT = process.argv[2] ?? "designer";
const UA = "Scrapivo/1.0 (+opportunity discovery; contact via site)";

async function probe(
  label: string,
  url: string,
  count: (body: any) => number,
): Promise<{ label: string; status: string; items: number }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { label, status: `HTTP ${res.status}`, items: 0 };
    const body = await res.json();
    return { label, status: "ok", items: count(body) };
  } catch (e) {
    return { label, status: `ERR ${(e as Error).message.slice(0, 40)}`, items: 0 };
  }
}

const rows: Array<{ label: string; status: string; items: number }> = [];

console.log(`\n=== RAW API REACHABILITY (craft="${CRAFT}") ===\n`);

// Bluesky — the code says 403 for anonymous callers. Verify, don't assume.
rows.push(
  await probe(
    "bluesky/searchPosts",
    `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(
      `need a ${CRAFT}`,
    )}&limit=20&sort=latest`,
    (b) => b?.posts?.length ?? 0,
  ),
);

for (const host of [
  "lemmy.world",
  "lemmy.ml",
  "programming.dev",
  "sh.itjust.works",
  "beehaw.org",
]) {
  rows.push(
    await probe(
      `lemmy/${host}`,
      `https://${host}/api/v3/search?q=${encodeURIComponent(CRAFT)}&type_=Posts&sort=New&limit=30`,
      (b) => b?.posts?.length ?? 0,
    ),
  );
}

for (const host of [
  "mastodon.social",
  "mstdn.social",
  "fosstodon.org",
  "mas.to",
  "techhub.social",
]) {
  for (const tag of ["forhire", "needhelp"]) {
    rows.push(
      await probe(
        `mastodon/${host}#${tag}`,
        `https://${host}/api/v1/timelines/tag/${tag}?limit=40`,
        (b) => (Array.isArray(b) ? b.length : 0),
      ),
    );
  }
}

rows.push(
  await probe("devto", `https://dev.to/api/articles?per_page=30&tag=forhire`, (b) =>
    Array.isArray(b) ? b.length : 0,
  ),
);
rows.push(
  await probe("lobsters", "https://lobste.rs/newest.json", (b) =>
    Array.isArray(b) ? b.length : 0,
  ),
);
rows.push(
  await probe(
    "hn/algolia",
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(CRAFT)}&tags=comment&hitsPerPage=30`,
    (b) => b?.hits?.length ?? 0,
  ),
);

for (const r of rows) {
  const flag = r.status !== "ok" ? "  <-- UNREACHABLE" : r.items === 0 ? "  <-- empty" : "";
  console.log(
    `  ${r.label.padEnd(34)} ${r.status.padEnd(12)} ${String(r.items).padStart(4)} items${flag}`,
  );
}

const reachable = rows.filter((r) => r.status === "ok" && r.items > 0);
console.log(
  `\n${reachable.length}/${rows.length} endpoints returned data. ` +
    `${rows.filter((r) => r.status !== "ok").length} unreachable.`,
);

// ── Now the gates, on real Mastodon + Lemmy payloads ────────────────────────
console.log(`\n=== WHERE OUR OWN GATES DROP THEM ===\n`);
const { classifyDemand, craftVariants, matchesCraft } =
  await import("../src/lib/search/demand-classifier");
const terms = craftVariants(CRAFT);
console.log(`craftVariants("${CRAFT}") -> ${JSON.stringify(terms)}\n`);

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function gateReport(label: string, texts: string[]) {
  let afterCraft = 0;
  let afterDemand = 0;
  const rejectReasons: Record<string, number> = {};
  for (const t of texts) {
    if (terms.length && !matchesCraft(t, terms)) continue;
    afterCraft++;
    const v = classifyDemand({ title: t, body: "" });
    if (v.rejectedAs) {
      rejectReasons[v.rejectedAs] = (rejectReasons[v.rejectedAs] ?? 0) + 1;
      continue;
    }
    afterDemand++;
  }
  const why = Object.entries(rejectReasons)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  console.log(
    `  ${label.padEnd(22)} ${String(texts.length).padStart(4)} fetched -> ` +
      `${String(afterCraft).padStart(3)} match craft -> ${String(afterDemand).padStart(3)} pass demand` +
      (why ? `   (${why})` : ""),
  );
}

// Mastodon: pull one busy instance/tag and run the real gates over it.
for (const tag of ["forhire", "needhelp", "hiring", "freelance", "commissions"]) {
  try {
    const res = await fetch(`https://mastodon.social/api/v1/timelines/tag/${tag}?limit=40`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const list = res.ok ? ((await res.json()) as any[]) : [];
    await gateReport(
      `mastodon #${tag}`,
      list.map((s) => stripHtml(s.content || "")),
    );
  } catch (e) {
    console.log(`  mastodon #${tag}  ERR ${(e as Error).message.slice(0, 40)}`);
  }
}

// Lemmy: same treatment.
for (const host of ["lemmy.world", "programming.dev"]) {
  try {
    const res = await fetch(
      `https://${host}/api/v3/search?q=${encodeURIComponent(CRAFT)}&type_=Posts&sort=New&limit=30`,
      {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body = res.ok ? ((await res.json()) as any) : { posts: [] };
    await gateReport(
      `lemmy ${host}`,
      (body.posts ?? []).map((p: any) => p.post?.name ?? ""),
    );
  } catch (e) {
    console.log(`  lemmy ${host}  ERR ${(e as Error).message.slice(0, 40)}`);
  }
}
