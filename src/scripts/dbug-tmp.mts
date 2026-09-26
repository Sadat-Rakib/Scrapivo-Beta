import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
console.log("SEARXNG_URL set:", !!process.env.SEARXNG_URL);
const { searchSearxng } = await import("@/lib/search/searxng.server");
for (const [q, n, tr, bucket] of [
  ["plumber Austin", 1, "day", "default"],
  ["plumber Austin", 1, "month", "default"],
  ["plumber Austin", 1, "month", "intent"],
] as const) {
  const r = await searchSearxng([q], n, tr as never, bucket);
  console.log(JSON.stringify({ q, tr, bucket }), "->", r.length, "results");
}
void fs;
