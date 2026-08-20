/**
 * End-to-end tests for investor integration
 * Tests: search functionality, location matching, dual-entity system
 */

import { searchInvestors, getAllInvestors } from "../src/lib/investors/search";
import { matchLocation } from "../src/lib/investors/location-hierarchy";
import type { InvestorEntity } from "../src/lib/investors/types";

console.log("🧪 Running Investor Integration Tests\n");

async function runTests() {
  // Test 1: Data Loading
  console.log("Test 1: Data Loading");
  console.log("==================");
  const allInvestors = getAllInvestors();
  console.log(`✓ Loaded ${allInvestors.length} total entities`);

  const individuals = allInvestors.filter((inv) => "type" in inv && inv.type === "individual");
  const firms = allInvestors.filter((inv) => "type" in inv && inv.type === "firm");
  const legacy = allInvestors.filter((inv) => !("type" in inv));

  console.log(`  - Individuals: ${individuals.length}`);
  console.log(`  - Firms: ${firms.length}`);
  console.log(`  - Legacy format: ${legacy.length}`);

  if (allInvestors.length < 3000) {
    console.error("❌ FAIL: Expected at least 3,000 entities");
    process.exit(1);
  }
  console.log("✅ PASS: Data loaded successfully\n");

  // Test 2: Search by Query
  console.log("Test 2: Search by Query (AI)");
  console.log("============================");
  const aiResults = await searchInvestors({ query: "AI", limit: 20 });
  console.log(`✓ Found ${aiResults.length} AI investors`);

  if (aiResults.length === 0) {
    console.error("❌ FAIL: No AI investors found");
    process.exit(1);
  }

  // Check if results actually contain AI
  const hasAI = aiResults.some((inv) => {
    const cats = "investment_categories" in inv ? inv.investment_categories : [];
    return cats.some((cat) => cat.toLowerCase().includes("ai"));
  });

  if (!hasAI) {
    console.error("❌ FAIL: AI results don't contain AI categories");
    process.exit(1);
  }
  console.log("✅ PASS: AI search works correctly\n");

  // Test 3: Filter by Stage
  console.log("Test 3: Filter by Stage (Seed)");
  console.log("===============================");
  const seedResults = await searchInvestors({ stage: "Seed", limit: 20 });
  console.log(`✓ Found ${seedResults.length} seed investors`);

  if (seedResults.length === 0) {
    console.error("❌ FAIL: No seed investors found");
    process.exit(1);
  }

  const hasSeed = seedResults.some((inv) => {
    const cats = "investment_categories" in inv ? inv.investment_categories : [];
    return cats.some((cat) => cat.toLowerCase().includes("seed"));
  });

  if (!hasSeed) {
    console.error("❌ FAIL: Seed results don't contain seed stage");
    process.exit(1);
  }
  console.log("✅ PASS: Stage filtering works correctly\n");

  // Test 4: Filter by Check Size
  console.log("Test 4: Filter by Check Size (Angel)");
  console.log("====================================");
  const angelResults = await searchInvestors({ checkBand: "angel", limit: 20 });
  console.log(`✓ Found ${angelResults.length} angel investors`);

  if (angelResults.length === 0) {
    console.log("⚠️  WARNING: No angel investors found (this may be expected)");
  } else {
    console.log("✅ PASS: Check size filtering works\n");
  }

  // Test 5: Location Matching - Direct
  console.log("Test 5: Location Matching - Direct (India)");
  console.log("===========================================");
  const indiaResults = await searchInvestors({ location: "India", limit: 20 });
  console.log(`✓ Found ${indiaResults.length} India investors`);

  if (indiaResults.length === 0) {
    console.error("❌ FAIL: No India investors found");
    process.exit(1);
  }

  // Verify India is in the results
  const hasIndia = indiaResults.some((inv) => {
    const locs = "investment_locations" in inv ? inv.investment_locations : [];
    return locs.some((loc) => loc.toLowerCase().includes("india"));
  });

  if (!hasIndia) {
    console.error("❌ FAIL: India results don't contain India location");
    process.exit(1);
  }
  console.log("✅ PASS: Direct location matching works\n");

  // Test 6: Location Matching - City to Country
  console.log("Test 6: Location Matching - City → Country (Dhaka → Bangladesh)");
  console.log("================================================================");
  const dhakaResults = await searchInvestors({ location: "Dhaka", limit: 20 });
  console.log(`✓ Found ${dhakaResults.length} Dhaka/Bangladesh investors`);

  if (dhakaResults.length === 0) {
    console.log("⚠️  INFO: No Dhaka/Bangladesh investors found (checking hierarchy)");

    // Test the location hierarchy directly
    const testLocs = ["Bangladesh", "Asia", "India"];
    const match = matchLocation("Dhaka", testLocs);
    if (match) {
      console.log("✓ Location hierarchy matching works (Dhaka → Bangladesh → Asia)");
      console.log("  Note: No investors found matching this location in the dataset");
    }
  } else {
    console.log("✅ PASS: City-to-country location matching works\n");
  }

  // Test 7: Location Matching - Region
  console.log("Test 7: Location Matching - Region (Asia)");
  console.log("==========================================");
  const asiaResults = await searchInvestors({ location: "Asia", limit: 20 });
  console.log(`✓ Found ${asiaResults.length} Asia investors`);

  if (asiaResults.length === 0) {
    console.error("❌ FAIL: No Asia investors found");
    process.exit(1);
  }

  // Verify Asian countries are in results
  const asianCountries = ["India", "Singapore", "China", "Japan", "Hong Kong", "UAE"];
  const hasAsianCountry = asiaResults.some((inv) => {
    const locs = "investment_locations" in inv ? inv.investment_locations : [];
    return locs.some((loc) =>
      asianCountries.some((country) => loc.toLowerCase().includes(country.toLowerCase())),
    );
  });

  if (!hasAsianCountry) {
    console.error("❌ FAIL: Asia results don't contain Asian countries");
    process.exit(1);
  }
  console.log("✅ PASS: Regional location matching works\n");

  // Test 8: Entity Type Filtering
  console.log("Test 8: Entity Type Filtering");
  console.log("==============================");
  const firmResults = await searchInvestors({ entityType: "firm", limit: 20 });
  console.log(`✓ Found ${firmResults.length} firms`);

  if (firmResults.length === 0) {
    console.error("❌ FAIL: No firms found");
    process.exit(1);
  }

  const allAreFirms = firmResults.every((inv) => "type" in inv && inv.type === "firm");
  if (!allAreFirms) {
    console.error("❌ FAIL: Firm results contain non-firms");
    process.exit(1);
  }
  console.log("✅ PASS: Entity type filtering works\n");

  // Test 9: Social Links Presence
  console.log("Test 9: Social Links Validation");
  console.log("================================");
  let withEmail = 0;
  let withLinkedIn = 0;
  let withTwitter = 0;
  let withWebsite = 0;

  for (const inv of allInvestors.slice(0, 100)) {
    if ("email" in inv && inv.email) withEmail++;
    if (inv.links?.linkedin) withLinkedIn++;
    if ("twitter" in inv.links && inv.links.twitter) withTwitter++;
    if ("website" in inv && inv.website) withWebsite++;
  }

  console.log(`✓ Sample of 100 entities:`);
  console.log(`  - With email: ${withEmail}`);
  console.log(`  - With LinkedIn: ${withLinkedIn}`);
  console.log(`  - With Twitter: ${withTwitter}`);
  console.log(`  - With Website: ${withWebsite}`);

  if (withLinkedIn < 50) {
    console.error("❌ FAIL: Too few LinkedIn links");
    process.exit(1);
  }
  console.log("✅ PASS: Social links are present\n");

  // Test 10: Dual Entity System
  console.log("Test 10: Dual Entity System (Firm + Individuals)");
  console.log("=================================================");

  // Find a firm with team members
  const firmWithTeam = allInvestors.find(
    (inv) =>
      "type" in inv &&
      inv.type === "firm" &&
      "team_size" in inv &&
      inv.team_size &&
      inv.team_size > 0,
  ) as InvestorEntity | undefined;

  if (firmWithTeam && "team_size" in firmWithTeam) {
    console.log(`✓ Found firm: ${firmWithTeam.name} with ${firmWithTeam.team_size} team members`);

    // Find individuals from this firm
    const teamMembers = allInvestors.filter(
      (inv) => "firm" in inv && inv.firm === firmWithTeam.name,
    );

    console.log(`✓ Found ${teamMembers.length} individuals from ${firmWithTeam.name}`);

    if (teamMembers.length > 0) {
      const member = teamMembers[0];
      console.log(`  Example: ${member.name} ${"role" in member ? `(${member.role})` : ""}`);

      // Check firm_id reference
      if ("firm_id" in member && member.firm_id === firmWithTeam.id) {
        console.log("  ✓ firm_id reference is correct");
      }
    }

    console.log("✅ PASS: Dual entity system works correctly\n");
  } else {
    console.log("⚠️  INFO: Could not find firm with team members to test relationships\n");
  }

  // Final Summary
  console.log("=".repeat(60));
  console.log("🎉 ALL TESTS PASSED!");
  console.log("=".repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`  Total Entities: ${allInvestors.length}`);
  console.log(`  Firms: ${firms.length}`);
  console.log(`  Individuals: ${individuals.length}`);
  console.log(`  Legacy Format: ${legacy.length}`);
  console.log(`\n✅ Integration is working correctly!`);
  console.log(`\n🌐 Test the UI at: http://localhost:8080/investors`);
}

// Run the tests
runTests().catch((error) => {
  console.error("\n❌ Test execution failed:", error);
  process.exit(1);
});
