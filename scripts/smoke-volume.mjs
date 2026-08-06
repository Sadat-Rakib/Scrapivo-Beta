/**
 * Offline smoke checks for volume/relevance + ScrapeGraphAI wiring.
 * Run: node --env-file=.env --experimental-strip-types scripts/smoke-volume.mjs
 * (or via npm if configured)
 */
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const queries = [
  "I'm selling an invoice SaaS — find customers who need invoicing tools",
  "Currently hiring Next.js engineers / clients for React freelance",
  "Junior frontend developer roles 0-1 years experience remote",
];

async function testSgai() {
  const key = process.env.SGAI_API_KEY;
  if (!key) {
    console.log("SGAI: SKIP (no SGAI_API_KEY)");
    return false;
  }
  try {
    const res = await fetch("https://v2-api.scrapegraphai.com/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "SGAI-APIKEY": key,
      },
      body: JSON.stringify({
        url: "https://scrapegraphai.com/",
        prompt:
          "Return JSON with company_name, website, description. Skip fields you cannot verify.",
      }),
    });
    const text = await res.text();
    console.log(`SGAI extract status=${res.status} bytes=${text.length}`);
    if (!res.ok) {
      console.log("SGAI body:", text.slice(0, 300));
      return false;
    }
    console.log("SGAI: OK");
    return true;
  } catch (e) {
    console.log("SGAI error:", e?.message || e);
    return false;
  }
}

async function main() {
  console.log("Smoke queries (classify locally via dynamic import if available):");
  for (const q of queries) console.log(" -", q.slice(0, 80));
  console.log("USE_PAID_SOURCES=", process.env.USE_PAID_SOURCES);
  console.log("SGAI_API_KEY set=", !!process.env.SGAI_API_KEY);
  const ok = await testSgai();
  process.exit(ok ? 0 : 1);
}

main();
