#!/usr/bin/env node
/**
 * Test different Foursquare API authentication methods
 */

// Service API Key from Foursquare Developer Console
const API_KEY = "5YDK1N4IJGIG2LSEWZPOMUIP44IHZUEYQZK23WCNUOQDVBHD";

const testLocation = {
  name: "Dentist in New York",
  query: "dentist",
  lat: 40.7128,
  lon: -74.006,
};

async function testAuth() {
  console.log("Testing Foursquare Places API v2025 Authentication\n");
  console.log("=".repeat(60));

  // Method 1: Places API v2025-06-17 with ll parameter
  console.log("\n1️⃣  Testing: Places API v2025-06-17 (ll parameter)");
  const url1 = `https://places-api.foursquare.com/places/search?ll=${testLocation.lat},${testLocation.lon}&query=${encodeURIComponent(testLocation.query)}&limit=5`;
  try {
    const res1 = await fetch(url1, {
      headers: {
        Accept: "application/json",
        Authorization: API_KEY,
        "X-Places-Api-Version": "2025-06-17",
      },
    });
    console.log(`   Status: ${res1.status} ${res1.statusText}`);
    if (res1.ok) {
      const data = await res1.json();
      console.log(`   ✅ SUCCESS! Got ${data.places?.length || data.results?.length || 0} results`);
      if (data.places && data.places.length > 0) {
        console.log(`\n   Sample result:`);
        console.log(`   - ${data.places[0].name}`);
        console.log(`   - ${data.places[0].location?.formatted_address || 'No address'}`);
      }
      return true;
    } else {
      const text = await res1.text();
      console.log(`   ❌ Failed: ${text.substring(0, 150)}`);
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  // Method 2: Try with near parameter instead of ll
  console.log("\n2️⃣  Testing: Places API v2025-06-17 (near parameter)");
  const url2 = `https://places-api.foursquare.com/places/search?near=New York, NY&query=${encodeURIComponent(testLocation.query)}&limit=5`;
  try {
    const res2 = await fetch(url2, {
      headers: {
        Accept: "application/json",
        Authorization: API_KEY,
        "X-Places-Api-Version": "2025-06-17",
      },
    });
    console.log(`   Status: ${res2.status} ${res2.statusText}`);
    if (res2.ok) {
      const data = await res2.json();
      console.log(`   ✅ SUCCESS! Got ${data.places?.length || data.results?.length || 0} results`);
      if (data.places && data.places.length > 0) {
        console.log(`\n   Sample result:`);
        console.log(`   - ${data.places[0].name}`);
        console.log(`   - ${data.places[0].location?.formatted_address || 'No address'}`);
      }
      return true;
    } else {
      const text = await res2.text();
      console.log(`   ❌ Failed: ${text.substring(0, 150)}`);
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  // Method 3: Try with geocode parameter
  console.log("\n3️⃣  Testing: Places API v2025-06-17 (geocode parameter)");
  const url3 = `https://places-api.foursquare.com/places/search?geocode=${testLocation.lat},${testLocation.lon}&query=${encodeURIComponent(testLocation.query)}&limit=5`;
  try {
    const res3 = await fetch(url3, {
      headers: {
        Accept: "application/json",
        Authorization: API_KEY,
        "X-Places-Api-Version": "2025-06-17",
      },
    });
    console.log(`   Status: ${res3.status} ${res3.statusText}`);
    if (res3.ok) {
      const data = await res3.json();
      console.log(`   ✅ SUCCESS! Got ${data.places?.length || data.results?.length || 0} results`);
      if (data.places && data.places.length > 0) {
        console.log(`\n   Sample result:`);
        console.log(`   - ${data.places[0].name}`);
        console.log(`   - ${data.places[0].location?.formatted_address || 'No address'}`);
      }
      return true;
    } else {
      const text = await res3.text();
      console.log(`   ❌ Failed: ${text.substring(0, 150)}`);
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("❌ All authentication methods failed!");
  console.log("\n💡 The API key might be invalid or the project might not");
  console.log("   have Places API enabled. Check your Foursquare project settings.");
  return false;
}

testAuth().catch(console.error);

