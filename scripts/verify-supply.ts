/**
 * Times the two sources that were losing their results and reports what they
 * return, so "Discover showed 3 leads" can be attributed to supply rather than
 * guessed at.
 *
 * Reddit RSS was finishing AFTER the 28s source budget and having all of its
 * leads discarded; the social dorks depend on engines that may be suspended.
 *
 *   npx tsx scripts/verify-supply.ts [craft]
 */
import { readFileSync } from "node:fs";
import type { ExpandedQueries } from "../src/lib/search/query-expander";

// The app reads .env through Vite; a bare tsx script does not, and SEARXNG_URL
// being unset would make this report "no social" for the wrong reason.
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const CRAFT = process.argv[2] ?? "designer";

const SOURCE_BUDGET_MS = 28_000;

function makeQx(skill: string): ExpandedQueries {
  return {
    raw: skill,
    skill,
    role: skill,
    queryType: "skill" as ExpandedQueries["queryType"],
    relatedSkills: [],
    buyerIntentQueries: [],
    buyerPhrases: [],
    jobBoardQueries: [],
    jobBoardTerms: [],
    socialQueries: [],
    redditBuyerQueries: [],
    booleanWebQueries: [],
    customerPhrases: [],
    subreddits: [],
    negativePhrases: [],
    negativeSignals: [],
  };
}

async function timed<T>(
  label: string,
  p: Promise<T>,
): Promise<{ label: string; ms: number; value: T }> {
  const started = Date.now();
  const value = await p;
  return { label, ms: Date.now() - started, value };
}

async function main() {
  const qx = makeQx(CRAFT);
  const { withSearxngBudget, searxngBudgetState } =
    await import("../src/lib/search/searxng.server");
  const { searchRedditRss } = await import("../src/lib/search/reddit-rss.server");
  const { searchSocialDorks } = await import("../src/lib/search/social-dorks.server");

  console.log(`craft: "${CRAFT}"   source budget: ${SOURCE_BUDGET_MS / 1000}s`);
  console.log(`SEARXNG_URL=${process.env.SEARXNG_URL ?? "(unset)"}\n`);

  // Probe one dork on its own so a zero from the social layer can be blamed on
  // the right thing: no budget, no engines, or no on-target rows.
  const { searchSearxng } = await import("../src/lib/search/searxng.server");
  const probeDork = `site:linkedin.com/posts "looking for a ${CRAFT}"`;
  const probeStart = Date.now();
  const probe = await withSearxngBudget(() => searchSearxng([probeDork], 1, "", "linkedin"));
  console.log(
    `probe dork -> ${probe.length} on-target rows in ${((Date.now() - probeStart) / 1000).toFixed(1)}s\n`,
  );

  await withSearxngBudget(async () => {
    const [reddit, social] = await Promise.all([
      timed(
        "reddit-rss",
        searchRedditRss(qx).then((r) => r.leads),
      ),
      timed("socialdorks", searchSocialDorks(qx)),
    ]);

    for (const r of [reddit, social]) {
      const late = r.ms > SOURCE_BUDGET_MS;
      const verdict = late ? "TOO LATE — discarded by the orchestrator" : "within budget";
      console.log(
        `${r.label.padEnd(12)} ${String(r.value.length).padStart(3)} leads in ${(r.ms / 1000).toFixed(1)}s  ${verdict}`,
      );
    }

    const byPlatform = new Map<string, number>();
    for (const l of social.value) {
      const p = l.platform ?? "?";
      byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
    }
    if (byPlatform.size) {
      console.log("\nsocial by platform:");
      for (const [p, n] of byPlatform) console.log(`  ${p}: ${n}`);
    }

    const b = searxngBudgetState();
    console.log(
      `\nbudget: social ${b.social.used}/${b.social.limit}, other ${b.other.used}/${b.other.limit}, ${b.cached} cached`,
    );
  });
}

void main();
