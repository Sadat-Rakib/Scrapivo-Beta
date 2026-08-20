// Probe scripts run outside Vite, so process.env is empty and every env-gated
// source (SearXNG above all) silently no-ops. Measurements taken without this
// understate the pipeline badly — SEARXNG_URL undefined made searchSearxng
// return [] instantly, which read as "social returns nothing".
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
} catch {
  /* no .env — fine */
}
