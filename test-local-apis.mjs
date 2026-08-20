#!/usr/bin/env node
/**
 * Test Foursquare and Geoapify APIs for local businesses in Tier 3 countries
 */

const FOURSQUARE_API_KEY = "fsq3LVSL34VVW0VVATBSQAZFAPFXSF3CPZCTE1QXYAOIFJIAZBY3";
const GEOAPIFY_API_KEY = "bd87c064492d4b21a4b4902f6c882ee3";

// Test cases for Tier 3 countries
const TEST_CASES = [
  {
    name: "HVAC in Delhi, India",
    query: "hvac service",
    location: "Delhi, India",
    lat: 28.6139,
    lon: 77.209,
  },
  {
    name: "Dentists in Dhaka, Bangladesh",
    query: "dentist",
    location: "Dhaka, Bangladesh",
    lat: 23.8103,
    lon: 90.4125,
  },
  {
    name: "Marketing Agency in Mumbai, India",
    query: "marketing agency",
    location: "Mumbai, India",
    lat: 19.076,
    lon: 72.8777,
  },
  {
    name: "Plumber in Karachi, Pakistan",
    query: "plumber",
    location: "Karachi, Pakistan",
    lat: 24.8607,
    lon: 67.0011,
  },
  {
    name: "Law Firms in Bangkok, Thailand",
    query: "law firm",
    location: "Bangkok, Thailand",
    lat: 13.7563,
    lon: 100.5018,
  },
];

async function testFoursquare(testCase) {
  console.log(`\n🔍 Testing Foursquare: ${testCase.name}`);

  try {
    const url = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(testCase.query)}&ll=${testCase.lat},${testCase.lon}&radius=15000&limit=10`;

    // Try with the key directly (no prefix needed if key already has fsq3)
    let response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: FOURSQUARE_API_KEY,
      },
    });

    if (!response.ok) {
      console.log(`❌ Foursquare API error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log(`Response: ${text.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const results = data?.results || [];

    console.log(`✅ Foursquare returned ${results.length} results`);

    if (results.length > 0) {
      console.log(`\nSample results:`);
      results.slice(0, 3).forEach((place, i) => {
        const loc = place.location || {};
        console.log(`  ${i + 1}. ${place.name}`);
        console.log(`     Address: ${loc.formatted_address || loc.address || "N/A"}`);
        console.log(
          `     Categories: ${(place.categories || []).map((c) => c.name).join(", ") || "N/A"}`,
        );
        if (place.tel) console.log(`     Phone: ${place.tel}`);
        if (place.website) console.log(`     Website: ${place.website}`);
      });
    }

    return results;
  } catch (error) {
    console.log(`❌ Foursquare error: ${error.message}`);
    return null;
  }
}

async function testGeoapify(testCase) {
  console.log(`\n🗺️  Testing Geoapify: ${testCase.name}`);

  try {
    // First geocode the location
    const geocodeUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(testCase.location)}&limit=1&format=json&apiKey=${GEOAPIFY_API_KEY}`;

    const geocodeResponse = await fetch(geocodeUrl);
    if (!geocodeResponse.ok) {
      console.log(`❌ Geoapify Geocode error: ${geocodeResponse.status}`);
      return null;
    }

    const geocodeData = await geocodeResponse.json();
    const geocodeResults = geocodeData?.results || [];

    if (geocodeResults.length === 0) {
      console.log(`❌ Could not geocode location: ${testCase.location}`);
      return null;
    }

    const point = geocodeResults[0];
    console.log(`   Geocoded to: ${point.formatted}`);

    // Now search for places
    const categories = getCategoriesForQuery(testCase.query);
    const filter = `circle:${point.lon},${point.lat},15000`;
    const placesUrl = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(categories)}&filter=${encodeURIComponent(filter)}&limit=10&apiKey=${GEOAPIFY_API_KEY}`;

    const placesResponse = await fetch(placesUrl);
    if (!placesResponse.ok) {
      console.log(`❌ Geoapify Places error: ${placesResponse.status}`);
      const text = await placesResponse.text();
      console.log(`Response: ${text.substring(0, 200)}`);
      return null;
    }

    const placesData = await placesResponse.json();
    const features = placesData?.features || [];

    console.log(`✅ Geoapify returned ${features.length} results`);

    if (features.length > 0) {
      console.log(`\nSample results:`);
      features.slice(0, 3).forEach((feature, i) => {
        const p = feature.properties || {};
        console.log(`  ${i + 1}. ${p.name || p.address_line1 || "Unnamed"}`);
        console.log(`     Address: ${p.formatted || p.address_line1 || "N/A"}`);
        console.log(`     Categories: ${(p.categories || []).join(", ") || "N/A"}`);
        if (p.contact?.phone) console.log(`     Phone: ${p.contact.phone}`);
        if (p.contact?.website) console.log(`     Website: ${p.contact.website}`);
      });
    }

    return features;
  } catch (error) {
    console.log(`❌ Geoapify error: ${error.message}`);
    return null;
  }
}

function getCategoriesForQuery(query) {
  const q = query.toLowerCase();
  if (/hvac|heating|cooling/.test(q)) return "service";
  if (/dentist/.test(q)) return "healthcare";
  if (/marketing|agency/.test(q)) return "office,service,commercial";
  // Fix plumber category - Geoapify doesn't support service.plumbing
  if (/plumb/.test(q)) return "service,commercial";
  if (/law|lawyer|attorney/.test(q)) return "office.lawyer,office";
  return "office,service,commercial";
}

// Run all tests
async function runAllTests() {
  console.log("=".repeat(80));
  console.log("Testing Foursquare & Geoapify APIs for Tier 3 Countries");
  console.log("=".repeat(80));

  const results = {
    total: TEST_CASES.length,
    foursquareSuccesses: 0,
    geoapifySuccesses: 0,
    bothFailed: 0,
    details: [],
  };

  for (const testCase of TEST_CASES) {
    console.log("\n" + "─".repeat(80));
    console.log(`TEST CASE: ${testCase.name}`);
    console.log("─".repeat(80));

    const foursquareResults = await testFoursquare(testCase);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit pause

    const geoapifyResults = await testGeoapify(testCase);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit pause

    // Track results
    const fsSuccess = foursquareResults && foursquareResults.length > 0;
    const geoSuccess = geoapifyResults && geoapifyResults.length > 0;

    if (fsSuccess) results.foursquareSuccesses++;
    if (geoSuccess) results.geoapifySuccesses++;
    if (!fsSuccess && !geoSuccess) results.bothFailed++;

    results.details.push({
      name: testCase.name,
      location: testCase.location,
      foursquare: fsSuccess ? foursquareResults.length : 0,
      geoapify: geoSuccess ? geoapifyResults.length : 0,
      status: fsSuccess || geoSuccess ? "✅ PASS" : "❌ FAIL",
    });

    // Summary
    console.log(`\n📊 Summary for ${testCase.name}:`);
    console.log(
      `   Foursquare: ${foursquareResults ? foursquareResults.length + " results" : "FAILED"}`,
    );
    console.log(`   Geoapify: ${geoapifyResults ? geoapifyResults.length + " results" : "FAILED"}`);
    console.log(`   Overall: ${fsSuccess || geoSuccess ? "✅ PASS (at least one source worked)" : "❌ FAIL (both sources failed)"}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("📈 FINAL RESULTS");
  console.log("=".repeat(80));
  console.log(`Total test cases: ${results.total}`);
  console.log(`Foursquare successes: ${results.foursquareSuccesses}/${results.total}`);
  console.log(`Geoapify successes: ${results.geoapifySuccesses}/${results.total}`);
  console.log(`Both sources failed: ${results.bothFailed}/${results.total}`);
  console.log("");
  console.log("Detailed breakdown:");
  results.details.forEach((d) => {
    console.log(
      `  ${d.status} ${d.name} - FS:${d.foursquare} GEO:${d.geoapify}`,
    );
  });

  console.log("\n" + "=".repeat(80));
  if (results.bothFailed === 0) {
    console.log("✅ ALL TESTS PASSED - Every location has at least one working source!");
  } else {
    console.log(`⚠️  ${results.bothFailed} location(s) failed with both sources`);
  }
  console.log("=".repeat(80));
}

runAllTests().catch(console.error);
