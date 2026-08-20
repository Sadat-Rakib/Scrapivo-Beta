/**
 * Probe slugified company names against public ATS JSON APIs.
 * Keeps only HTTP 200 boards that return jobs.
 *
 * Usage: npx tsx scripts/probe-ats-slugs.mts stripe figma openai
 */
const names = process.argv
  .slice(2)
  .map((s) => s.trim())
  .filter(Boolean);
if (!names.length) {
  console.log("Usage: npx tsx scripts/probe-ats-slugs.mts <company> [company…]");
  process.exit(0);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (Array.isArray(data)) return data.length > 0;
    if (data?.jobs?.length) return true;
    if (data?.content?.length) return true;
    if (data?.offers?.length) return true;
    return false;
  } catch {
    return false;
  }
}

async function main() {
  const out: Array<{ company: string; provider: string; board: string }> = [];
  for (const name of names) {
    const s = slug(name);
    const checks: Array<[string, string]> = [
      ["greenhouse", `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`],
      ["lever", `https://api.lever.co/v0/postings/${s}?mode=json`],
      ["ashby", `https://api.ashbyhq.com/posting-api/job-board/${s}`],
      ["smartrecruiters", `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=10`],
    ];
    for (const [provider, url] of checks) {
      const ok = await probe(url);
      console.log(`${ok ? "OK" : "miss"}  ${name} ${provider} ${s}`);
      if (ok) out.push({ company: name, provider, board: s });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
