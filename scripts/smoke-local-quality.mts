/**
 * Smoke: local place disambiguation + geocode preference (no API keys required for unit checks).
 */
import {
  disambiguatePlaceQuery,
  isJunkLocalListing,
  isRealBusinessWebsite,
  matchesLocalCraft,
} from "../src/lib/search/place-disambiguate.server.ts";

const checks: Array<[string, boolean]> = [
  [disambiguatePlaceQuery("Toronto") === "Toronto, Canada", true],
  [disambiguatePlaceQuery("Toronto, ON") === "Toronto, ON", true],
  [isRealBusinessWebsite("https://www.geoapify.com/place?id=abc") === false, true],
  [isRealBusinessWebsite("https://foursquare.com/v/123") === false, true],
  [isRealBusinessWebsite("https://joesplumbing.ca") === true, true],
  [isJunkLocalListing("Toronto Post Office", "plumbers") === true, true],
  [isJunkLocalListing("Joe's Plumbing", "plumbers") === false, true],
  [matchesLocalCraft("Toronto Fire Department", "plumbers") === false, true],
  [matchesLocalCraft("ABC Plumbing", "plumbers") === true, true],
];

let failed = 0;
for (const [ok, expect] of checks) {
  if (ok !== expect) {
    failed++;
    console.error("FAIL", ok, expect);
  }
}
console.log(failed === 0 ? "place-disambiguate OK" : `FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
