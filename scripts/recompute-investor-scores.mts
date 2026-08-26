/**
 * Recompute information_completeness_score for every investor record so the
 * image-first ranking reflects enriched data. Mirrors search.ts weights.
 *   npx tsx scripts/recompute-investor-scores.mts
 */
import { readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const DATA = resolve("data/investors_merged.json");
type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const file = JSON.parse(readFileSync(DATA, "utf8")) as { investors?: Rec[] };
const rows = file.investors ?? [];
let sum = 0;
let max = 0;
for (const r of rows) {
  const links = (r.links ?? {}) as Rec;
  let s = 0;
  if (str(r.name)) s += 1;
  if (str(r.website) || str(links.website)) s += 1;
  if (str(links.linkedin)) s += 1;
  if (str(links.twitter) || str(links.x)) s += 1;
  if (str(r.email)) s += 1;
  if (str(r.image_url) || str(links.image_url)) s += 2;
  if (str(r.location)) s += 1;
  if (Array.isArray(r.investment_locations) && r.investment_locations.length) s += 1;
  if (Array.isArray(r.investment_categories) && r.investment_categories.length) s += 1;
  if (str((r.sweet_spot as Rec | undefined)?.sweet_spot)) s += 1;
  else if (Number(r.check_sweet_spot_usd ?? 0) > 0) s += 1;
  if (str(r.role) || str(r.title)) s += 1;
  if (str(r.firm) || str(r.firm_name)) s += 1;
  if (str(r.thesis) || str(r.bio)) s += 1;
  (r as Record<string, unknown>).information_completeness_score = s;
  sum += s;
  if (s > max) max = s;
}

copyFileSync(DATA, resolve("data/investors_merged.pre-scores.bak.json"));
const json = JSON.stringify(file, null, 2);
JSON.parse(json);
const tmp = DATA + ".tmp";
writeFileSync(tmp, json);
try {
  renameSync(tmp, DATA);
} catch {
  copyFileSync(tmp, DATA);
  const { rmSync } = await import("node:fs");
  rmSync(tmp, { force: true });
}
console.log(
  `[scores] ${rows.length} records · avg ${(sum / rows.length).toFixed(2)}/${max} · wrote ${DATA}`,
);
