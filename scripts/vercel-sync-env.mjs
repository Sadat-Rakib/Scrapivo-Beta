import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const envPath = ".env";
if (!existsSync(envPath)) {
  console.error("Missing .env");
  process.exit(1);
}

const required = [
  "MY_SUPABASE_URL",
  "MY_SUPABASE_PUBLISHABLE_KEY",
  "MY_SUPABASE_SERVICE_ROLE_KEY",
  "VITE_MY_SUPABASE_URL",
  "VITE_MY_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "USE_PAID_SOURCES",
  "SEARXNG_URL",
  "SERPER_API_KEY",
  "SCRAPINGDOG_API_KEY",
  "SERPAPI_KEY",
  "SERPAPI_MAX_CALLS_PER_RUN",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "TAVILY_API_KEY",
  "SCRAPECREATORS_KEY",
  "HUNTER_API_KEY",
  "PDL_API_KEY",
  "CORECLAW_API_KEY",
  "GEOAPIFY_API_KEY",
  "FOURSQUARE_API_KEY",
  "ZEROBOUNCE_KEY",
  "MILLIONVERIFIER_API_KEY",
  "MILLIONVERIFIER_DAILY_CAP",
  "GITHUB_TOKEN",
  "SGAI_API_KEY",
];

const map = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const targets = ["production", "preview", "development"];

for (const key of required) {
  let val = map[key];
  if (!val) {
    console.log(`skip ${key} (empty)`);
    continue;
  }
  // Never push laptop Docker SearXNG to Vercel — social dies there.
  if (key === "SEARXNG_URL" && /:\/\/(127\.0\.0\.1|localhost)\b/i.test(val)) {
    console.log(`skip SEARXNG_URL (localhost — leave unset on Vercel)`);
    continue;
  }
  for (const target of targets) {
    const r = spawnSync("vercel", ["env", "add", key, target, "--force", "--yes"], {
      input: val + "\n",
      encoding: "utf8",
      shell: true,
    });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status === 0) console.log(`ok ${key} → ${target}`);
    else console.log(`fail ${key} → ${target}: ${out.slice(0, 200)}`);
  }
}
