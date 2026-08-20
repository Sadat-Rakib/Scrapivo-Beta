/**
 * Scrapivo — Foursquare Provider
 *
 * Implements the BusinessDiscoveryProvider interface as a fallback
 * for local business discovery.
 */

import type { BusinessDiscoveryProvider, BusinessFilter, NormalizedBusinessResult } from "../types";

export class FoursquareProvider implements BusinessDiscoveryProvider {
  readonly name = "Foursquare";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async healthCheck(): Promise<boolean> {
    return !!this.apiKey;
  }

  async searchBusinesses(
    query: string,
    location?: string,
    filters?: BusinessFilter,
  ): Promise<NormalizedBusinessResult[]> {
    // Mock implementation for the fallback provider chain
    console.log(`[Foursquare] Searching for ${query} in ${location} with limit ${filters?.limit}`);
    return [];
  }

  async getBusinessDetails(sourceId: string): Promise<NormalizedBusinessResult | null> {
    console.log(`[Foursquare] Getting details for ${sourceId}`);
    return null;
  }
}
