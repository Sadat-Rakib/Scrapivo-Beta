/**
 * Scrapivo — Provider Interface Contracts
 *
 * Clean abstractions for all external data providers. Every adapter must
 * implement one of these interfaces. Providers can be swapped via the
 * ProviderRegistry without touching business logic.
 */

import type {
  Company,
  Contact,
  Signal,
  Technology,
  DemandSignalResult,
  ICPConfig,
  ICPScoreBreakdown,
  IntentScoreBreakdown,
  Lead,
  ScoreEvidence,
} from "../domain/types";

// ─── Shared Provider Config ─────────────────────────────────────────────────

export interface ProviderConfig {
  timeout_ms: number;
  max_retries: number;
  backoff_base_ms: number;
  concurrency_limit: number;
  rate_limit_per_minute: number;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  timeout_ms: 15_000,
  max_retries: 2,
  backoff_base_ms: 1_000,
  concurrency_limit: 5,
  rate_limit_per_minute: 30,
};

// ─── Business Discovery Provider ────────────────────────────────────────────

export interface BusinessFilter {
  keyword?: string;
  category?: string;
  city?: string;
  region?: string;
  country?: string;
  radius_km?: number;
  latitude?: number;
  longitude?: number;
  depth?: number;
  limit?: number;
}

export interface NormalizedBusinessResult {
  source: string;
  source_id: string;
  name: string;
  category?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  review_count?: number;
  description?: string;
  raw_data?: unknown;
}

export interface BusinessDiscoveryProvider {
  readonly name: string;
  searchBusinesses(
    query: string,
    location?: string,
    filters?: BusinessFilter,
  ): Promise<NormalizedBusinessResult[]>;
  getBusinessDetails(sourceId: string): Promise<NormalizedBusinessResult | null>;
  healthCheck(): Promise<boolean>;
}

// ─── Technographic Provider ─────────────────────────────────────────────────

export interface TechnologyProfile {
  domain: string;
  technologies: {
    name: string;
    category: string;
    confidence: number;
    first_seen?: string;
    last_seen?: string;
  }[];
  source: string;
  fetched_at: string;
}

export interface TechnographicProvider {
  readonly name: string;
  getCompanyTechnologies(domain: string): Promise<TechnologyProfile | null>;
  searchCompaniesByTech(
    techNames: string[],
    location?: string,
  ): Promise<{ domain: string; name?: string }[]>;
}

// ─── Website Intelligence Provider ──────────────────────────────────────────

export interface WebsiteMetadataResult {
  url: string;
  title?: string;
  description?: string;
  og_image?: string;
  technologies?: string[];
  emails_found?: string[];
  phones_found?: string[];
  schema_org?: Record<string, unknown>;
  security_headers?: Record<string, string>;
  social_links?: Record<string, string>;
  markdown_content?: string;
  source: string;
  fetched_at: string;
}

export interface CompanySignal {
  type: string;
  value: string;
  confidence: number;
  evidence?: string;
}

export interface WebsiteIntelligenceProvider {
  readonly name: string;
  analyzeUrl(url: string): Promise<WebsiteMetadataResult | null>;
  extractCompanySignals(url: string): Promise<CompanySignal[]>;
}

// ─── Email / Contact Intelligence Provider ──────────────────────────────────

export interface PersonRef {
  full_name: string;
  first_name?: string;
  last_name?: string;
  title?: string;
}

export interface CompanyRef {
  name: string;
  domain?: string;
  website?: string;
}

export interface EmailCandidate {
  email: string;
  confidence: number;
  pattern?: string;
  source: string;
}

export interface ContactResult {
  email?: string;
  phone?: string;
  confidence_score: number;
  verification_status: "verified" | "likely" | "possible" | "unverified" | "invalid";
  source: string;
  verified_at?: string;
}

export interface VerificationResult {
  email: string;
  is_valid: boolean;
  confidence: number;
  verification_method: string;
  checked_at: string;
}

export interface EmailIntelligenceProvider {
  readonly name: string;
  discoverEmail(person: PersonRef, company: CompanyRef): Promise<ContactResult | null>;
  verifyEmail(email: string): Promise<VerificationResult>;
  generateCandidates(person: PersonRef, domain: string): Promise<EmailCandidate[]>;
}

// ─── Demand Signal Provider (Delta Engage) ──────────────────────────────────

export interface DemandSignalProvider {
  readonly name: string;
  searchDemandSignals(
    query: string,
    platforms: ("reddit" | "linkedin")[],
  ): Promise<DemandSignalResult[]>;
}

// ─── Event Signal Provider (Future) ─────────────────────────────────────────

export interface EventSignalProvider {
  readonly name: string;
  searchEvents(query: string, location?: string): Promise<Signal[]>;
}

// ─── Prospect Intelligence Service (LeadAce) ───────────────────────────────

export interface OutreachDraft {
  dm?: string;
  email_subject?: string;
  email_body?: string;
  call_script?: string;
  personalization_notes?: string;
}

export interface ProspectIntelligenceService {
  matchICP(company: Partial<Company>, icp: ICPConfig): ICPScoreBreakdown;
  scoreIntent(company: Partial<Company>, signals: Signal[]): IntentScoreBreakdown;
  generatePersonalizedOutreach(lead: Partial<Lead>, icp: ICPConfig): Promise<OutreachDraft>;
}

// ─── Investor Provider ──────────────────────────────────────────────────────

export interface InvestorProvider {
  readonly name: string;
  searchInvestors(
    query: string,
    filters?: Record<string, unknown>,
  ): Promise<{
    firms: Partial<Company>[];
    people: import("../domain/types").Person[];
  }>;
}

// ─── Outreach Provider ──────────────────────────────────────────────────────

export interface OutreachProvider {
  readonly name: string;
  sendOutreach(draft: OutreachDraft, recipient: ContactResult): Promise<{ sent: boolean; error?: string }>;
}
