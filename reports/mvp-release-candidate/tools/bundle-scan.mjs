// Client bundle gate (run after `npm run build`): the static output must not ship
// server-only browser code, worker routes or any .env secret value.
// Prints counts and key NAMES only, never values.
//   node reports/mvp-release-candidate/tools/bundle-scan.mjs
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const root = ".vercel/output/static";
const files = [];
const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js|css|html|json|map)$/.test(name)) files.push(p); } };
walk(root);
const patterns = [
  /playwright-core|chromium-bidi|launchPersistentContext|chromium\.launch/,
  /\/browser\/sessions|startEgressProxy|createSessionManager/,
  /BROWSER_WORKER_TOKEN|SCRAPIVO_BROWSER_WORKER_URL|RESEARCH_WORKER_TOKEN/,
  /SUPABASE_SERVICE_ROLE|service_role/,
  /city_country_map|loadCityCountryMap/,
];
const patternHits = patterns.map((re) => files.filter((f) => re.test(readFileSync(f, "utf8"))).length);
const secrets = [];
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && /(KEY|TOKEN|SECRET|PASSWORD)/.test(m[1]) && !/^VITE_|PUBLISHABLE|ANON/.test(m[1]) && m[2].length >= 12) secrets.push([m[1], m[2]]);
  }
}
const secretHits = secrets.filter(([, value]) => files.some((f) => readFileSync(f, "utf8").includes(value))).map(([key]) => key);
console.log(JSON.stringify({ files: files.length, patternHits, secretsChecked: secrets.length, secretHitKeys: secretHits }));
