/**
 * Scrapivo — Provider Initialization
 *
 * Bootstraps the provider registry with configured instances
 * and establishes the primary -> fallback chains.
 */

import { providerRegistry } from "./registry";
import { GoogleMapsProvider } from "./business/google-maps-provider";
import { FoursquareProvider } from "./business/foursquare-provider";

// Initialize Business Discovery Chain
// 1. Primary: Google Maps (gosom)
const googleMaps = new GoogleMapsProvider({
  apiUrl: process.env.GOOGLE_MAPS_SCRAPER_URL || "http://localhost:8080",
  apiKey: process.env.GOOGLE_MAPS_SCRAPER_KEY || "",
});
providerRegistry.registerBusiness(googleMaps);

// 2. Fallback: Foursquare
const foursquare = new FoursquareProvider(process.env.FOURSQUARE_API_KEY || "");
providerRegistry.registerBusiness(foursquare, true);

// Other providers (Tech, Website, Contacts, etc.) will be registered here.
export { providerRegistry };
