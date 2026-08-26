/**
 * Import merged_max_completeness_people_firms.json into data/investors_merged.json
 * - Converts people → individual records, firms → firm records
 * - Dedupes against existing by LinkedIn URL (case-insensitive slug match)
 * - Only adds NEW unique records; never touches existing ones
 * Usage: npx tsx scripts/import-new-investors.mts
 */
import { readFileSync, writeFileSync, copyFileSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const DATA = resolve("data/investors_merged.json");
const SOURCE = resolve("../merged_max_completeness_people_firms.json");

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function linkedinSlug(url: string): string {
  if (!url) return "";
  const m = /linkedin\.com\/(in|pub)\/([^/?#\s]+)/i.exec(url);
  return m ? m[1] + "/" + m[2].toLowerCase().replace(/[^a-z0-9%_.-]/gi, "") : "";
}

function domainOf(u: string): string {
  if (!u) return "";
  try {
    const h = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
    return h.length > 3 ? h : "";
  } catch { return ""; }
}

function hashId(prefix: string, basis: string): string {
  const h = createHash("sha1").update(basis).digest("hex").slice(0, 16);
  return `${prefix}-${h}`;
}

// ── load existing ──────────────────────────────────────────────────────────
const file = JSON.parse(readFileSync(DATA, "utf8")) as { investors: Rec[] };
const existing = file.investors;
const existingSlugs = new Set<string>();
const existingDomains = new Set<string>();
const existingNames = new Set<string>();

for (const r of existing) {
  const links = (r.links ?? {}) as Rec;
  const slug = linkedinSlug(str(links.linkedin));
  if (slug) existingSlugs.add(slug);
  const dom = domainOf(str(r.website) || str(links.website));
  if (dom) existingDomains.add(dom);
  const n = str(r.name).toLowerCase();
  if (n) existingNames.add(n);
}
console.log(`[import] existing: ${existing.length} rows, ${existingSlugs.size} linkedin slugs`);

// ── load source ────────────────────────────────────────────────────────────
const src = JSON.parse(readFileSync(SOURCE, "utf8")) as { people: Rec[]; firms: Rec[] };
console.log(`[import] source: ${src.people.length} people, ${src.firms.length} firms`);

// ── convert people ─────────────────────────────────────────────────────────
let addedPeople = 0, skippedDup = 0;

for (const p of src.people) {
  const first = str(p.first_name), last = str(p.last_name);
  if (!first || !last || last === "Name") continue; // skip template row
  const fullName = `${first} ${last}`;
  const norm = fullName.toLowerCase();
  const liUrl = str(p.linkedin_url);
  const slug = linkedinSlug(liUrl);

  // Dedupe: skip if LinkedIn slug already exists OR exact name+domain combo exists
  if (slug && existingSlugs.has(slug)) { skippedDup++; continue; }
  if (!slug && existingNames.has(norm)) { skippedDup++; continue; }

  const website = str(p.websites?.[0]) || "";
  const twitter = str(p.twitter_urls?.[0]) || "";
  const email = str(p.emails?.[0]) || "";
  const city = str(p.city), state = str(p.state), country = str(p.country);
  const locationParts = [city, state, country].filter(Boolean);
  const locationStr = locationParts.join(", ");
  const company = str(p.company_name) || "";
  const title = str(p.title) || "investor";
  const categories = (p.investment_categories_niches as string[] | null)?.filter(Boolean) ?? [];
  const bio = str(p.bio_summary) || "";

  // Determine entity_type from title
  let entityType = "vc";
  if (/angel/i.test(title)) entityType = "angel";
  else if (/scout/i.test(title)) entityType = "scout";
  else if (/advisor|board|mentor|professor|chairman|trustee/i.test(title)) entityType = "investor";
  else if (/founder|ceo|co-founder|president|executive/i.test(title)) entityType = "vc";

  const id = hashId("individual", `${norm}|${company}|${liUrl}`);

  const rec: Rec = {
    id,
    type: "individual",
    name: fullName,
    entity_type: entityType,
    firm: company,
    role: title,
    website: website || undefined,
    links: {
      linkedin: liUrl || null,
      twitter: twitter || null,
      website: website || null,
      firm: company || null,
    },
    email: email || undefined,
    location: locationStr,
    investment_locations: [country].filter(Boolean),
    investment_categories: categories.map(c => `Invest (${c})`),
    sweet_spot: undefined,
    verification_status: "active",
    source: "merged_max_completeness_import",
    information_completeness_score: 3 + (website ? 1 : 0) + (liUrl ? 1 : 0) + (email ? 1 : 0) + (categories.length ? 1 : 0) + (bio ? 1 : 0),
  };

  if (bio) rec.bio = bio;

  existing.push(rec);
  if (slug) existingSlugs.add(slug);
  existingNames.add(norm);
  addedPeople++;
}

console.log(`[import] people: added=${addedPeople}, skipped_dupe=${skippedDup}`);

// ── convert firms ──────────────────────────────────────────────────────────
let addedFirms = 0;
const VC_PATTERNS = /venture|capital|partners|ventures|fund|invest|equity|capital|holdings|group|labs?|incubator|accelerator|angels?|seed/i;

for (const f of src.firms) {
  const name = str(f.name);
  if (!name) continue;
  const norm = name.toLowerCase();

  // Skip if already in DB by name
  if (existingNames.has(norm)) continue;

  const websites = (f.urls as any)?.websites as string[] | undefined ?? [];
  const linkedins = (f.urls as any)?.linkedin as string[] | undefined ?? [];
  const twitters = (f.urls as any)?.twitter as string[] | undefined ?? [];
  const categories = (f.categories as string[] | null)?.filter(Boolean) ?? [];
  const places = (f.places as string[] | null)?.filter(Boolean) ?? [];
  const bio = str(f.bio_summary) || "";
  const logo = str(f.logo) || "";
  const isCandidate = Boolean((f.verification as any)?.investment_firm_candidate);

  // Only import firms that look like investment firms or have VC-ish names
  if (!isCandidate && !VC_PATTERNS.test(name) && !categories.some(c => /investment|venture capital|private equity/i.test(c))) continue;

  const id = hashId("firm", `${norm}`);
  const website = websites[0] || "";
  const linkedin = linkedins[0] || "";
  const twitter = twitters[0] || "";

  const rec: Rec = {
    id,
    type: "firm",
    name,
    entity_type: "venture_capital_firm",
    website: website || undefined,
    links: {
      linkedin: linkedin || null,
      twitter: twitter || null,
      website: website || null,
    },
    location: places.join(", ") || undefined,
    investment_locations: places.filter(p => p.length > 2),
    investment_categories: categories.map(c => `Invest (${c})`),
    verification_status: isCandidate ? "needs_review" : "active",
    source: "merged_max_completeness_import",
    information_completeness_score: 2 + (website ? 1 : 0) + (linkedin ? 1 : 0) + (categories.length ? 1 : 0) + (bio ? 1 : 0) + (logo ? 2 : 0),
  };

  if (bio) rec.bio = bio;
  if (logo) rec.image_url = logo;
  if ((f.verification as any)?.logo_source_url) rec.links.logo_source_url = (f.verification as any).logo_source_url;

  existing.push(rec);
  existingNames.add(norm);
  addedFirms++;
}

console.log(`[import] firms: added=${addedFirms}`);
console.log(`[import] total after merge: ${existing.length}`);

// ── persist ────────────────────────────────────────────────────────────────
copyFileSync(DATA, DATA + ".pre-import.bak.json");
file.investors = existing;
const json = JSON.stringify(file, null, 2);
JSON.parse(json); // strict gate

const { unlinkSync } = await import("node:fs");
if (existsSync(DATA + ".tmp")) unlinkSync(DATA + ".tmp");
writeFileSync(DATA + ".tmp", json);
try { renameSync(DATA + ".tmp", DATA); }
catch { copyFileSync(DATA + ".tmp", DATA); unlinkSync(DATA + ".tmp"); }

console.log(`[import] wrote ${DATA}: ${existing.length} total entities`);
