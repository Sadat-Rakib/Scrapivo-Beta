import { readFileSync } from "node:fs";
const env: Record<string, string> = {};
try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.log("no .env");
}
const keys = [
  "SEARXNG_URL",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AWAIT_PERSIST_LIVE",
  "USE_PAID_SOURCES",
  "SERPAPI_KEY",
  "SERPER_API_KEY",
];
for (const k of keys) {
  const v = env[k];
  if (v == null || v === "") console.log(`${k}: ABSENT`);
  else if (k.includes("KEY") || (k.includes("URL") && k !== "SEARXNG_URL"))
    console.log(`${k}: SET len=${v.length}`);
  else console.log(`${k}: ${JSON.stringify(v).slice(0, 100)}`);
}
