/**
 * Import OpenVC-style CSV into investors_merged.json (offline only).
 *
 * Expected columns (flexible headers):
 *   name / firm / investor, website, email, location / hq,
 *   investment_locations / geographies, stages / categories,
 *   check_min, check_max, sectors / thesis
 *
 * Run:
 *   npx tsx scripts/import-investors-csv.mts path/to/export.csv
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  effectiveInvestLocations,
  normalizeInvestorLocationList,
} from "../src/lib/investors/location-hierarchy";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push(row);
  }
  return rows;
}

function col(header: string[], row: string[], ...names: string[]): string {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return (row[i] || "").trim();
  }
  // fuzzy
  for (const n of names) {
    const i = lower.findIndex((h) => h.includes(n.toLowerCase()));
    if (i >= 0) return (row[i] || "").trim();
  }
  return "";
}

function splitList(raw: string): string[] {
  return raw
    .split(/[|;,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function idFor(name: string, website: string): string {
  return createHash("sha1")
    .update(`${name.toLowerCase()}|${website.toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-investors-csv.mts <file.csv>");
  process.exit(1);
}
const abs = resolve(csvPath);
if (!existsSync(abs)) {
  console.error(`File not found: ${abs}`);
  process.exit(1);
}

const mergedPath = resolve("data/investors_merged.json");
const data = JSON.parse(readFileSync(mergedPath, "utf8")) as {
  schema_version: number;
  generated_at: string;
  investors: Array<Record<string, unknown>>;
};

const byId = new Map(data.investors.map((i) => [String(i.id), i]));
const byName = new Map(data.investors.map((i) => [String(i.name || "").toLowerCase(), i]));

const rows = parseCsv(readFileSync(abs, "utf8"));
if (rows.length < 2) {
  console.error("CSV has no data rows");
  process.exit(1);
}
const header = rows[0];
let added = 0;
let updated = 0;

for (const row of rows.slice(1)) {
  const name = col(header, row, "name", "firm", "investor", "company");
  if (!name || name.length < 2) continue;
  const website = col(header, row, "website", "url", "site");
  const email = col(header, row, "email", "contact_email");
  const hq = col(header, row, "location", "hq", "headquarters", "based_in");
  const investRaw = col(header, row, "investment_locations", "geographies", "invests_in", "geo");
  const stagesRaw = col(header, row, "stages", "categories", "investment_categories", "stage");
  const sectorsRaw = col(header, row, "sectors", "thesis", "focus", "industry");
  const checkMin = Number(col(header, row, "check_min", "min_check", "check_size_min") || 0);
  const checkMax = Number(col(header, row, "check_max", "max_check", "check_size_max") || 0);

  const invest = effectiveInvestLocations(normalizeInvestorLocationList(splitList(investRaw)), hq);
  const stages = splitList(stagesRaw);
  const sectors = splitList(sectorsRaw);

  const existing = byName.get(name.toLowerCase());
  if (existing) {
    const prevInvest = (existing.investment_locations as string[]) || [];
    existing.investment_locations = [...new Set([...prevInvest, ...invest])];
    if (hq && !existing.location) existing.location = hq;
    if (website && !existing.website) existing.website = website;
    if (email && !existing.email) existing.email = email;
    if (stages.length) {
      const prev = (existing.investment_categories as string[]) || [];
      existing.investment_categories = [...new Set([...prev, ...stages])];
    }
    if (sectors.length) {
      const prev = (existing.sectors as string[]) || [];
      existing.sectors = [...new Set([...prev, ...sectors])];
    }
    updated += 1;
    continue;
  }

  const id = idFor(name, website || name);
  if (byId.has(id)) continue;
  const rec = {
    id,
    name,
    entity_type: /capital|ventures|partners|fund|vc/i.test(name) ? "firm" : "individual",
    investor_type: "vc",
    website: website || undefined,
    email: email || undefined,
    location: hq || undefined,
    investment_locations: invest,
    investment_categories: stages,
    sectors,
    check_min: checkMin || undefined,
    check_max: checkMax || undefined,
    status: "active",
    source: "csv_import",
  };
  data.investors.push(rec);
  byId.set(id, rec);
  byName.set(name.toLowerCase(), rec);
  added += 1;
}

data.generated_at = new Date().toISOString();
writeFileSync(mergedPath, JSON.stringify(data, null, 2), "utf8");
console.log(JSON.stringify({ added, updated, total: data.investors.length, file: abs }, null, 2));
