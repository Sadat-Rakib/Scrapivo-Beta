/**
 * Merge transformed AI-ready investors with existing investors.json
 * Handles deduplication and conflict resolution
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Types
interface OldInvestor {
  name: string;
  firm: string;
  role: string;
  sweet_spot?: {
    sweet_spot: string;
    range_min: string;
    range_max: string;
    raw: string;
  };
  investment_locations: string[];
  investment_categories: string[];
  links: {
    linkedin?: string | null;
    twitter?: string | null;
    website?: string | null;
  };
}

interface NewEntity {
  id: string;
  type: "individual" | "firm";
  name: string;
  firm?: string;
  firm_id?: string;
  role?: string;
  entity_type: string;
  email?: string;
  website?: string;
  links: Record<string, string>;
  location: string;
  investment_locations: string[];
  investment_categories: string[];
  sweet_spot?: {
    sweet_spot: string;
    range_min: string;
    range_max: string;
    raw: string;
  };
  thesis?: string;
  founded_year?: number;
  total_investments?: number;
  team_size?: number;
  verification_status?: string;
  source: string;
}

interface MergedEntity extends NewEntity {
  source: string;
}

// Utilities
function normalizeString(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeLinkedIn(url?: string | null): string {
  if (!url) return "";
  return url
    .toLowerCase()
    .replace(/\/$/, "")
    .replace(/^https?:\/\/(www\.)?/, "");
}

function isDuplicateIndividual(a: NewEntity, b: NewEntity | OldInvestor): boolean {
  // Match by name + firm
  const aName = normalizeString(a.name);
  const aFirm = normalizeString(a.firm || "");
  const bName = normalizeString(b.name);
  const bFirm = normalizeString(b.firm || "");

  if (aName === bName && aFirm === bFirm) return true;

  // Match by LinkedIn
  const aLinkedIn = normalizeLinkedIn(a.links?.linkedin);
  const bLinkedIn = normalizeLinkedIn("links" in b ? b.links?.linkedin : null);

  if (aLinkedIn && bLinkedIn && aLinkedIn === bLinkedIn) return true;

  // Match by email (if available)
  if ("email" in a && "email" in b && a.email && b.email) {
    if (normalizeString(a.email) === normalizeString(b.email)) return true;
  }

  return false;
}

function isDuplicateFirm(a: NewEntity, b: NewEntity): boolean {
  // Match by firm name
  const aName = normalizeString(a.name);
  const bName = normalizeString(b.name);

  if (aName === bName) return true;

  // Match by website domain
  const extractDomain = (url?: string) => {
    if (!url) return "";
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      return domain;
    } catch {
      return "";
    }
  };

  const aDomain = extractDomain(a.website);
  const bDomain = extractDomain(b.website);

  if (aDomain && bDomain && aDomain === bDomain) return true;

  // Match by LinkedIn company URL
  const aLinkedIn = normalizeLinkedIn(a.links?.linkedin);
  const bLinkedIn = normalizeLinkedIn(b.links?.linkedin);

  if (aLinkedIn && bLinkedIn && aLinkedIn === bLinkedIn) return true;

  return false;
}

function mergeLinks(
  a: Record<string, string>,
  b: Record<string, string | null | undefined>,
): Record<string, string> {
  const merged: Record<string, string> = { ...a };

  for (const [key, value] of Object.entries(b)) {
    if (value && typeof value === "string" && value.trim()) {
      if (!merged[key]) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function mergeArrays<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])];
}

function convertOldToNew(old: OldInvestor): NewEntity {
  return {
    id: `individual-old-${normalizeString(old.name)}-${normalizeString(old.firm)}`.substring(0, 64),
    type: "individual",
    name: old.name,
    firm: old.firm,
    role: old.role || "Investor",
    entity_type: inferEntityType(old.role),
    links: {
      linkedin: old.links.linkedin || undefined,
      twitter: old.links.twitter || undefined,
      website: old.links.website || undefined,
    },
    location: (old.investment_locations && old.investment_locations[0]) || "Unknown",
    investment_locations: old.investment_locations || [],
    investment_categories: old.investment_categories || [],
    sweet_spot: old.sweet_spot,
    source: "original",
  } as NewEntity;
}

function inferEntityType(role?: string): "vc" | "angel" | "scout" | "investor" {
  if (!role) return "investor";

  const title = role.toLowerCase();

  if (/\bangel\b/.test(title)) return "angel";
  if (/\bscout\b/.test(title)) return "scout";
  if (/\b(partner|principal|associate|director|vp|vice president|managing|gp)\b/.test(title))
    return "vc";

  return "investor";
}

// Main merge logic
function mergeData(
  oldData: { investors: OldInvestor[] },
  newData: { firms: number; individuals: number; entities: NewEntity[] },
): {
  entities: MergedEntity[];
  stats: {
    old_total: number;
    new_total: number;
    duplicates_found: number;
    merged_total: number;
    firms: number;
    individuals: number;
  };
} {
  console.log("🔄 Starting merge process...\n");

  const oldInvestors = oldData.investors || [];
  const newEntities = newData.entities || [];

  console.log(`📊 Old data: ${oldInvestors.length} investors`);
  console.log(
    `📊 New data: ${newEntities.length} entities (${newData.firms} firms + ${newData.individuals} individuals)\n`,
  );

  // Convert old format to new format
  const convertedOld: MergedEntity[] = oldInvestors.map(convertOldToNew);

  // Separate new data into firms and individuals
  const newFirms = newEntities.filter((e) => e.type === "firm");
  const newIndividuals = newEntities.filter((e) => e.type === "individual");

  // Deduplicate individuals
  const mergedIndividuals: MergedEntity[] = [];
  const seenIndividuals = new Set<string>();
  let individualDuplicates = 0;

  for (const newIndiv of newIndividuals) {
    let isDupe = false;

    // Check against already added new individuals
    for (const existing of mergedIndividuals) {
      if (existing.type === "individual" && isDuplicateIndividual(newIndiv, existing)) {
        isDupe = true;
        individualDuplicates++;

        // Merge data into existing
        existing.links = mergeLinks(existing.links, newIndiv.links);
        existing.investment_locations = mergeArrays(
          existing.investment_locations,
          newIndiv.investment_locations,
        );
        existing.investment_categories = mergeArrays(
          existing.investment_categories,
          newIndiv.investment_categories,
        );

        // Prefer newer email if available
        if (newIndiv.email && !existing.email) {
          existing.email = newIndiv.email;
        }

        break;
      }
    }

    // Check against converted old data
    if (!isDupe) {
      for (const oldIndiv of convertedOld) {
        if (isDuplicateIndividual(newIndiv, oldIndiv)) {
          isDupe = true;
          individualDuplicates++;

          // Merge old into new (prefer new data)
          const merged: MergedEntity = {
            ...newIndiv,
            links: mergeLinks(newIndiv.links, oldIndiv.links),
            investment_locations: mergeArrays(
              newIndiv.investment_locations,
              oldIndiv.investment_locations,
            ),
            investment_categories: mergeArrays(
              newIndiv.investment_categories,
              oldIndiv.investment_categories,
            ),
            source: "merged",
          };

          mergedIndividuals.push(merged);
          seenIndividuals.add(
            `${normalizeString(oldIndiv.name)}-${normalizeString(oldIndiv.firm)}`,
          );
          break;
        }
      }
    }

    if (!isDupe) {
      mergedIndividuals.push(newIndiv);
    }
  }

  // Add old individuals that weren't found in new data
  for (const oldIndiv of convertedOld) {
    const key = `${normalizeString(oldIndiv.name)}-${normalizeString(oldIndiv.firm)}`;
    if (!seenIndividuals.has(key)) {
      mergedIndividuals.push(oldIndiv);
    }
  }

  // Deduplicate firms
  const mergedFirms: MergedEntity[] = [];
  let firmDuplicates = 0;

  for (const newFirm of newFirms) {
    let isDupe = false;

    for (const existing of mergedFirms) {
      if (existing.type === "firm" && isDuplicateFirm(newFirm, existing)) {
        isDupe = true;
        firmDuplicates++;

        // Merge data
        existing.links = mergeLinks(existing.links, newFirm.links);
        existing.investment_locations = mergeArrays(
          existing.investment_locations,
          newFirm.investment_locations,
        );
        existing.investment_categories = mergeArrays(
          existing.investment_categories,
          newFirm.investment_categories,
        );

        break;
      }
    }

    if (!isDupe) {
      mergedFirms.push(newFirm);
    }
  }

  const allEntities = [...mergedFirms, ...mergedIndividuals];

  console.log(`✅ Deduplication complete:`);
  console.log(`   - Individual duplicates found: ${individualDuplicates}`);
  console.log(`   - Firm duplicates found: ${firmDuplicates}`);
  console.log(`   - Total duplicates: ${individualDuplicates + firmDuplicates}\n`);

  return {
    entities: allEntities,
    stats: {
      old_total: oldInvestors.length,
      new_total: newEntities.length,
      duplicates_found: individualDuplicates + firmDuplicates,
      merged_total: allEntities.length,
      firms: mergedFirms.length,
      individuals: mergedIndividuals.length,
    },
  };
}

// Main execution
async function main() {
  console.log("🚀 Starting merge process...\n");

  const rootDir = path.join(__dirname, "..");
  const oldPath = path.join(rootDir, "data", "investors.json");
  const newPath = path.join(rootDir, "data", "investors_ai_transformed.json");
  const outputPath = path.join(rootDir, "data", "investors_merged.json");
  const backupPath = path.join(rootDir, "data", "investors_original_backup.json");

  // Backup original file
  console.log("💾 Creating backup of original data...");
  fs.copyFileSync(oldPath, backupPath);
  console.log(`   ✅ Backup saved to: ${backupPath}\n`);

  // Read input files
  console.log("📖 Reading input files...");
  const oldData = JSON.parse(fs.readFileSync(oldPath, "utf-8"));
  const newData = JSON.parse(fs.readFileSync(newPath, "utf-8"));

  // Merge
  const { entities, stats } = mergeData(oldData, newData);

  // Create output structure
  const output = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    total_entities: entities.length,
    firms: stats.firms,
    individuals: stats.individuals,
    merge_stats: stats,
    investors: entities, // Keep 'investors' key for backward compatibility
  };

  // Write output
  console.log("💾 Writing merged data...");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n✅ Merge complete!`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`\n📊 Final Statistics:`);
  console.log(`   - Total entities: ${stats.merged_total}`);
  console.log(`   - Firms: ${stats.firms}`);
  console.log(`   - Individuals: ${stats.individuals}`);
  console.log(`   - Original data: ${stats.old_total}`);
  console.log(`   - New data: ${stats.new_total}`);
  console.log(`   - Duplicates removed: ${stats.duplicates_found}`);
}

main().catch((error) => {
  console.error("❌ Error during merge:", error);
  process.exit(1);
});
