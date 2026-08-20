/**
 * Scrapivo — Google Maps Provider
 *
 * Implements the BusinessDiscoveryProvider interface using the
 * gosom/google-maps-scraper REST API (Apify alternative).
 */

import type { BusinessDiscoveryProvider, BusinessFilter, NormalizedBusinessResult, ProviderConfig } from "../types";
import { validateExternalUrl, normalizeDomain, normalizePhone } from "../../security/url-validator";

interface GosomConfig {
  apiUrl: string;
  apiKey: string;
}

export class GoogleMapsProvider implements BusinessDiscoveryProvider {
  readonly name = "GoogleMapsScraper";
  private config: ProviderConfig;
  private apiConfig: GosomConfig;

  constructor(apiConfig: GosomConfig, config?: Partial<ProviderConfig>) {
    this.apiConfig = apiConfig;
    this.config = {
      timeout_ms: config?.timeout_ms ?? 30_000,
      max_retries: config?.max_retries ?? 2,
      backoff_base_ms: config?.backoff_base_ms ?? 1_000,
      concurrency_limit: config?.concurrency_limit ?? 3,
      rate_limit_per_minute: config?.rate_limit_per_minute ?? 20,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const url = validateExternalUrl(`${this.apiConfig.apiUrl}/health`);
      if (!url.valid) return false;

      const res = await fetch(url.sanitized_url!, {
        headers: { "x-api-key": this.apiConfig.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async searchBusinesses(
    query: string,
    location?: string,
    filters?: BusinessFilter,
  ): Promise<NormalizedBusinessResult[]> {
    if (!query || !location) {
      throw new Error("Google Maps requires both a query and a location");
    }

    const searchQuery = `${query} in ${location}`;
    const limit = filters?.limit ?? 20;

    const endpoint = validateExternalUrl(`${this.apiConfig.apiUrl}/search`);
    if (!endpoint.valid) throw new Error(endpoint.error);

    const body = {
      queries: [searchQuery],
      limit,
      depth: filters?.depth ?? 1,
      extract_emails: true,
      extract_socials: true,
    };

    try {
      const response = await fetch(endpoint.sanitized_url!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiConfig.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });

      if (!response.ok) {
        throw new Error(`Google Maps API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.normalizeResults(data.results || []);
    } catch (err) {
      console.error(`[${this.name}] search failed:`, err);
      throw err;
    }
  }

  async getBusinessDetails(sourceId: string): Promise<NormalizedBusinessResult | null> {
    const endpoint = validateExternalUrl(`${this.apiConfig.apiUrl}/place/${sourceId}`);
    if (!endpoint.valid) throw new Error(endpoint.error);

    try {
      const response = await fetch(endpoint.sanitized_url!, {
        headers: { "x-api-key": this.apiConfig.apiKey },
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const normalized = this.normalizeResults([data]);
      return normalized.length > 0 ? normalized[0] : null;
    } catch (err) {
      console.error(`[${this.name}] detail fetch failed:`, err);
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeResults(rawResults: any[]): NormalizedBusinessResult[] {
    return rawResults.map((raw) => {
      let email = raw.emails?.[0];
      if (email) email = email.trim().toLowerCase();

      let website = raw.website;
      if (website && !website.startsWith("http")) {
        website = `https://${website}`;
      }

      return {
        source: this.name,
        source_id: raw.place_id || raw.cid || crypto.randomUUID(),
        name: raw.title || raw.name,
        category: raw.category || raw.type,
        address: raw.address || raw.formatted_address,
        city: raw.city,
        country: raw.country,
        phone: raw.phone ? normalizePhone(raw.phone) : undefined,
        email,
        website,
        latitude: raw.latitude || raw.location?.lat,
        longitude: raw.longitude || raw.location?.lng,
        rating: raw.rating,
        review_count: raw.reviews_count || raw.review_count,
        description: raw.description,
        raw_data: raw,
      };
    });
  }
}
