/**
 * Transform investors_active_ai_ready.json into dual-entity format
 * Creates: 1 firm entity + N individual entities per VC firm
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Types
interface AIReadyFirm {
  name: string;
  entity_type: string;
  website?: string;
  linkedin?: string;
  founded_year?: number;
  total_investments?: number;
  exits?: number;
  thesis?: string;
  contacts: Array<{
    email?: string;
    first_name?: string;
    last_name?: string;
    company_name: string;
    job_title?: string;
    linkedin?: string;
    location?: string;
  }>;
  links?: {
    official_website?: string;
    linkedin?: string;
    twitter?: string;
  };
  location?: {
    headquarters?: {
      city?: string[] | string;
      country?: string;
    };
    investment_countries?: string[];
  };
  investment?: {
    stages_raw?: string[];
    stages_normalized?: string[];
    industries_raw?: string[];
    check_size?: {
      minimum?: { amount?: number; raw?: string };
      maximum?: { amount?: number; raw?: string };
    };
  };
  verification?: {
    active_status?: string;
  };
}

interface TransformedFirm {
  id: string;
  type: "firm";
  name: string;
  entity_type: string;
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
  team_size: number;
  verification_status?: string;
  source: string;
}

interface TransformedIndividual {
  id: string;
  type: "individual";
  name: string;
  firm: string;
  firm_id: string;
  role: string;
  entity_type: "vc" | "angel" | "scout" | "investor";
  email?: string;
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
  verification_status?: string;
  source: string;
}

// Utilities
function generateId(type: "firm" | "individual", name: string, firm?: string): string {
  const input = type === "firm" ? name : `${name}-${firm}`;
  const hash = crypto.createHash("md5").update(input.toLowerCase()).digest("hex").substring(0, 16);
  return `${type}-${hash}`;
}

function buildLinks(data: any): Record<string, string> {
  const links: Record<string, string> = {};

  if (data.linkedin?.trim()) links.linkedin = data.linkedin.trim();
  if (data.twitter?.trim()) links.twitter = data.twitter.trim();
  if (data.website?.trim()) links.website = data.website.trim();

  return links;
}

function normalizeStage(stage: string): string {
  const map: Record<string, string> = {
    pre_seed: "Pre-seed",
    seed: "Seed",
    series_a: "Series A",
    series_b: "Series B",
    series_c: "Series C",
    growth: "Growth",
    late_stage: "Late Stage",
    early_revenue: "Early Revenue",
    prototype: "Prototype",
    idea_or_patent: "Idea/Patent",
    scaling: "Scaling",
  };

  return map[stage.toLowerCase()] || stage;
}

function buildInvestmentCategories(firm: AIReadyFirm): string[] {
  const categories: string[] = [];
  const stages = firm.investment?.stages_normalized || [];
  const industries = firm.investment?.industries_raw || [];

  if (stages.length === 0 || industries.length === 0) {
    // Fallback: add stages and industries separately
    stages.forEach((s) => categories.push(normalizeStage(s)));
    industries.forEach((i) => categories.push(i));
    return [...new Set(categories)];
  }

  // Create cross-product: "{Stage} ({Industry})"
  for (const stage of stages) {
    for (const industry of industries) {
      categories.push(`${normalizeStage(stage)} (${industry})`);
    }
  }

  return [...new Set(categories)];
}

function buildCheckSize(firm: AIReadyFirm): TransformedFirm["sweet_spot"] | undefined {
  const checkSize = firm.investment?.check_size;
  if (!checkSize) return undefined;

  const min = checkSize.minimum?.amount;
  const max = checkSize.maximum?.amount;

  if (!min && !max) return undefined;

  const formatUSD = (amount?: number): string => {
    if (!amount) return "$0";
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
    return `$${amount}`;
  };

  const minStr = formatUSD(min);
  const maxStr = formatUSD(max);
  const sweetSpot = formatUSD(min && max ? (min + max) / 2 : min || max);

  return {
    sweet_spot: sweetSpot,
    range_min: minStr,
    range_max: maxStr,
    raw: `${minStr} - ${maxStr}`,
  };
}

function buildLocation(firm: AIReadyFirm): string {
  const hq = firm.location?.headquarters;
  if (!hq) return "Unknown";

  const city = Array.isArray(hq.city) ? hq.city[0] : hq.city;
  const country = hq.country;

  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  if (city) return city;

  return "Unknown";
}

function inferEntityType(jobTitle: string): "vc" | "angel" | "scout" | "investor" {
  const title = jobTitle.toLowerCase();

  if (/\bangel\b/.test(title)) return "angel";
  if (/\bscout\b/.test(title)) return "scout";
  if (/\b(partner|principal|associate|director|vp|vice president|managing|gp)\b/.test(title))
    return "vc";

  return "investor";
}

// Main transformation
function transformAIReadyData(aiReadyFirms: AIReadyFirm[]): {
  firms: TransformedFirm[];
  individuals: TransformedIndividual[];
} {
  const firms: TransformedFirm[] = [];
  const individuals: TransformedIndividual[] = [];

  let firmCount = 0;
  let individualCount = 0;

  for (const aiFirm of aiReadyFirms) {
    if (!aiFirm.name?.trim()) {
      console.warn("⚠️  Skipping firm with no name");
      continue;
    }

    firmCount++;

    // Create firm entity
    const firmId = generateId("firm", aiFirm.name);
    const firmWebsite = aiFirm.website || aiFirm.links?.official_website;
    const firmLinkedIn = aiFirm.linkedin || aiFirm.links?.linkedin;
    const firmLocation = buildLocation(aiFirm);
    const investmentLocations = aiFirm.location?.investment_countries || [];
    const investmentCategories = buildInvestmentCategories(aiFirm);
    const checkSize = buildCheckSize(aiFirm);

    const firmEntity: TransformedFirm = {
      id: firmId,
      type: "firm",
      name: aiFirm.name,
      entity_type: aiFirm.entity_type || "venture_capital_firm",
      website: firmWebsite,
      links: buildLinks({
        linkedin: firmLinkedIn,
        twitter: aiFirm.links?.twitter,
        website: firmWebsite,
      }),
      location: firmLocation,
      investment_locations: investmentLocations,
      investment_categories: investmentCategories,
      sweet_spot: checkSize,
      thesis: aiFirm.thesis?.trim() || undefined,
      founded_year: aiFirm.founded_year,
      total_investments: aiFirm.total_investments,
      team_size: aiFirm.contacts?.length || 0,
      verification_status: aiFirm.verification?.active_status,
      source: "ai_ready",
    };

    firms.push(firmEntity);

    // Create individual entities from contacts
    for (const contact of aiFirm.contacts || []) {
      const firstName = contact.first_name?.trim() || "";
      const lastName = contact.last_name?.trim() || "";
      const fullName = `${firstName} ${lastName}`.trim();

      if (!fullName) {
        console.warn(`⚠️  Skipping contact with no name in ${aiFirm.name}`);
        continue;
      }

      individualCount++;

      const individualId = generateId("individual", fullName, aiFirm.name);
      const jobTitle = contact.job_title || "Investor";

      const individualEntity: TransformedIndividual = {
        id: individualId,
        type: "individual",
        name: fullName,
        firm: aiFirm.name,
        firm_id: firmId,
        role: jobTitle,
        entity_type: inferEntityType(jobTitle),
        email: contact.email?.trim() || undefined,
        links: buildLinks({
          linkedin: contact.linkedin,
          firm: firmWebsite,
        }),
        location: contact.location || firmLocation,
        investment_locations: investmentLocations,
        investment_categories: investmentCategories,
        sweet_spot: checkSize,
        verification_status: aiFirm.verification?.active_status,
        source: "ai_ready",
      };

      individuals.push(individualEntity);
    }
  }

  console.log(`✅ Transformed ${firmCount} firms`);
  console.log(`✅ Transformed ${individualCount} individuals`);

  return { firms, individuals };
}

// Main execution
async function main() {
  console.log("🚀 Starting transformation...\n");

  const rootDir = path.join(__dirname, "..");
  const inputPath = path.join(rootDir, "investors_active_ai_ready_fixed.json");
  const outputPath = path.join(rootDir, "data", "investors_ai_transformed.json");

  // Read input with robust parsing
  console.log("📖 Reading input file...");
  const rawData = fs.readFileSync(inputPath, "utf-8");

  let aiReadyFirms: AIReadyFirm[] = [];

  // Try multiple parsing strategies
  try {
    // Strategy 1: Parse as-is
    const parsed = JSON.parse(rawData);
    if (Array.isArray(parsed)) {
      aiReadyFirms = parsed;
    } else if (parsed.investors) {
      aiReadyFirms = parsed.investors;
    } else {
      aiReadyFirms = [parsed];
    }
  } catch (e1) {
    try {
      // Strategy 2: Add opening bracket
      const parsed = JSON.parse("[" + rawData.trim());
      aiReadyFirms = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e2) {
      try {
        // Strategy 3: Add opening bracket and ensure closing
        const trimmed = rawData.trim();
        const withBracket = trimmed.endsWith("]") ? "[" + trimmed : "[" + trimmed + "]";
        const parsed = JSON.parse(withBracket);
        aiReadyFirms = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e3) {
        console.error("❌ All parsing strategies failed");
        console.error("Error 1:", e1.message);
        console.error("Error 2:", e2.message);
        console.error("Error 3:", e3.message);
        throw e3;
      }
    }
  }

  console.log(`📊 Found ${aiReadyFirms.length} firms in input\n`);

  // Transform
  const { firms, individuals } = transformAIReadyData(aiReadyFirms);

  // Combine into unified structure
  const output = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    total_entities: firms.length + individuals.length,
    firms: firms.length,
    individuals: individuals.length,
    entities: [...firms, ...individuals],
  };

  // Write output
  console.log("\n💾 Writing output file...");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n✅ Transformation complete!`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`📊 Total entities: ${output.total_entities}`);
  console.log(`   - Firms: ${output.firms}`);
  console.log(`   - Individuals: ${output.individuals}`);
}

main().catch((error) => {
  console.error("❌ Error during transformation:", error);
  process.exit(1);
});
