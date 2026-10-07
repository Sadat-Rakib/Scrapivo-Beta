/**
 * M7 — Capability-based source advertising.
 *
 * Providers declare what they can do; the planner matches SearchSpec
 * requirements to capabilities. Never: if query contains X → search Y.
 */
import type { SpecEntity } from "@/lib/search/search-spec";
import type { EvidenceType } from "@/lib/search/evidence";

/** Free-first cost ladder (L0 cheapest → L7 paid). */
export type CostTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const COST_TIER_LABELS: Record<CostTier, string> = {
  0: "indexed/internal DB",
  1: "free structured/public data",
  2: "direct HTTP",
  3: "HTML/parser",
  4: "sitemap/RSS/JSON-LD/OpenGraph",
  5: "browser automation",
  6: "agentic browser",
  7: "paid API",
};

export type SourceProviderId =
  | "indexed-db"
  | "osm-local"
  | "company-registry"
  | "searxng"
  | "direct-http"
  | "html-parser"
  | "sitemap-jsonld"
  | "browser-automation"
  | "agentic-browser"
  | "paid-serp"
  | "jobs-fleet";

export interface SourceCapability {
  id: SourceProviderId;
  label: string;
  entityTypes: SpecEntity[];
  /** Claim types this source can corroborate; empty = general discovery only. */
  claims: EvidenceType[];
  discovery: boolean;
  identityResolution: boolean;
  locationSupport: boolean;
  temporalSupport: boolean;
  costTier: CostTier;
  live: boolean;
  /**
   * Paid / heavy tiers — planner may schedule them only after free/self-hosted
   * primaries are exhausted. Never the silent default.
   */
  escalateOnly?: boolean;
}

/**
 * Built-in provider catalog. Jobs/social adapters finish in M13/M14; they are
 * listed so future adapters cannot invent a bypass — they still must advertise
 * capabilities and re-enter the canonical pipeline.
 */
export const SOURCE_PROVIDER_CATALOG: readonly SourceCapability[] = [
  {
    id: "indexed-db",
    label: "Indexed / internal DB",
    entityTypes: ["person", "company", "business", "investor", "job"],
    claims: [],
    discovery: true,
    identityResolution: true,
    locationSupport: true,
    temporalSupport: false,
    costTier: 0,
    live: false,
  },
  {
    id: "osm-local",
    label: "OpenStreetMap local businesses",
    entityTypes: ["business"],
    claims: ["no_website"],
    discovery: true,
    identityResolution: true,
    locationSupport: true,
    temporalSupport: false,
    costTier: 1,
    live: true,
  },
  {
    id: "company-registry",
    label: "Company / entity registry",
    entityTypes: ["company", "business", "investor"],
    claims: ["funding", "identity"],
    discovery: false,
    identityResolution: true,
    locationSupport: true,
    temporalSupport: true,
    costTier: 1,
    live: false,
  },
  {
    id: "searxng",
    label: "SearXNG (self-hosted web)",
    entityTypes: ["person", "company", "business", "investor", "job"],
    claims: ["hiring", "service_request", "funding", "investment", "social_ask"],
    discovery: true,
    identityResolution: false,
    locationSupport: true,
    temporalSupport: true,
    costTier: 2,
    live: true,
  },
  {
    id: "direct-http",
    label: "Direct HTTP fetch",
    entityTypes: ["company", "business", "person"],
    claims: [],
    discovery: true,
    identityResolution: false,
    locationSupport: false,
    temporalSupport: false,
    costTier: 2,
    live: true,
  },
  {
    id: "html-parser",
    label: "HTML parser",
    entityTypes: ["company", "business", "person", "job"],
    claims: [],
    discovery: true,
    identityResolution: false,
    locationSupport: false,
    temporalSupport: false,
    costTier: 3,
    live: true,
  },
  {
    id: "sitemap-jsonld",
    label: "Sitemap / RSS / JSON-LD / OpenGraph",
    entityTypes: ["company", "business", "job"],
    claims: ["hiring", "funding"],
    discovery: true,
    identityResolution: false,
    locationSupport: false,
    temporalSupport: true,
    costTier: 4,
    live: true,
  },
  {
    id: "browser-automation",
    label: "Browser automation",
    entityTypes: ["company", "business", "person", "job"],
    claims: [],
    discovery: true,
    identityResolution: false,
    locationSupport: false,
    temporalSupport: false,
    costTier: 5,
    live: true,
    escalateOnly: true,
  },
  {
    id: "agentic-browser",
    label: "Agentic browser",
    entityTypes: ["company", "business", "person"],
    claims: ["service_request", "hiring", "social_ask"],
    discovery: true,
    identityResolution: false,
    locationSupport: false,
    temporalSupport: true,
    costTier: 6,
    live: true,
    escalateOnly: true,
  },
  {
    id: "paid-serp",
    label: "Paid SERP API",
    entityTypes: ["person", "company", "business", "investor", "job"],
    claims: ["hiring", "service_request", "funding", "investment", "social_ask"],
    discovery: true,
    identityResolution: false,
    locationSupport: true,
    temporalSupport: true,
    costTier: 7,
    live: true,
    escalateOnly: true,
  },
  {
    id: "jobs-fleet",
    label: "Jobs fleet (M13 finishes contract)",
    entityTypes: ["job"],
    claims: ["hiring"],
    discovery: true,
    identityResolution: false,
    locationSupport: true,
    temporalSupport: true,
    costTier: 1,
    live: true,
  },
];

export function providerById(id: string): SourceCapability | undefined {
  return SOURCE_PROVIDER_CATALOG.find((p) => p.id === id);
}
