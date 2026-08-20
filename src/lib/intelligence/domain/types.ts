/**
 * Scrapivo — Shared Domain Entities
 *
 * These types are the canonical, unified data model used across ALL Scrapivo
 * systems (Local Businesses, Jobs, Investors, Universal Search, Outreach).
 *
 * Every external provider normalizes into these types. No system should define
 * its own incompatible Company/Contact/Lead model.
 */

// ─── Company ────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  canonical_name: string;
  legal_name?: string;
  domain?: string;
  website?: string;
  description?: string;
  industry?: string;
  categories?: string[];
  employee_count?: number;
  location?: string;
  headquarters?: string;
  country?: string;
  state_province?: string;
  city?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  logo_url?: string;
  social_profiles?: SocialProfiles;
  source_ids: SourceId[];
  source_metadata?: Record<string, unknown>;
  enrichment_status: EnrichmentStatus;
  created_at: string;
  updated_at: string;
  last_enriched_at?: string;
}

export type EnrichmentStatus = "none" | "partial" | "full" | "failed";

export interface SocialProfiles {
  linkedin?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  github?: string;
  crunchbase?: string;
  [key: string]: string | undefined;
}

export interface SourceId {
  source: string;
  source_id: string;
  fetched_at: string;
  expires_at?: string;
  raw_data?: unknown;
}

// ─── Person ─────────────────────────────────────────────────────────────────

export interface Person {
  id: string;
  company_id?: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  department?: string;
  linkedin_url?: string;
  website?: string;
  location?: string;
  source_ids: SourceId[];
  created_at: string;
  updated_at: string;
}

// ─── Contact ────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | "verified"
  | "likely"
  | "possible"
  | "unverified"
  | "invalid";

export interface Contact {
  id: string;
  person_id?: string;
  company_id?: string;
  email?: string;
  phone?: string;
  type: "work" | "personal" | "generic" | "unknown";
  source: string;
  confidence_score: number;
  verification_status: VerificationStatus;
  last_verified_at?: string;
  created_at: string;
  updated_at: string;
}

// ─── Technology ─────────────────────────────────────────────────────────────

export interface Technology {
  id: string;
  name: string;
  category?: string;
  vendor?: string;
  normalized_name: string;
}

export interface CompanyTechnology {
  company_id: string;
  technology_id: string;
  source: string;
  confidence: number;
  first_seen_at: string;
  last_seen_at: string;
}

// ─── Signal ─────────────────────────────────────────────────────────────────

export type SignalType =
  | "job_posting"
  | "hiring_growth"
  | "technology_adoption"
  | "technology_change"
  | "fundraising"
  | "executive_change"
  | "product_launch"
  | "website_change"
  | "event_participation"
  | "reddit_demand"
  | "linkedin_demand"
  | "review_activity"
  | "expansion"
  | "partnership"
  | "acquisition";

export interface Signal {
  id: string;
  company_id: string;
  person_id?: string;
  type: SignalType;
  source: string;
  title: string;
  description?: string;
  evidence_url?: string;
  evidence_text?: string;
  confidence: number;
  detected_at: string;
  expires_at?: string;
  raw_metadata?: Record<string, unknown>;
}

// ─── Lead ───────────────────────────────────────────────────────────────────

export type LeadStatus =
  | "new"
  | "qualified"
  | "contacted"
  | "replied"
  | "won"
  | "lost"
  | "archived";

export interface Lead {
  id: string;
  company_id: string;
  person_id?: string;
  source: string;
  icp_score: number;
  intent_score: number;
  contactability_score: number;
  data_confidence_score: number;
  qualification_score: number;
  overall_score: number;
  status: LeadStatus;
  reason?: string;
  evidence: ScoreEvidence[];
  created_at: string;
  updated_at: string;
}

export interface ScoreEvidence {
  factor: string;
  weight: number;
  description: string;
  source?: string;
}

// ─── ICP ────────────────────────────────────────────────────────────────────

export interface ICPConfig {
  name: string;
  industries?: string[];
  company_size?: { min?: number; max?: number };
  geography?: string[];
  technologies?: string[];
  titles?: string[];
  seniority?: string[];
  funding_stage?: string[];
  revenue_range?: { min?: number; max?: number };
  hiring_signals?: string[];
  keywords?: string[];
  exclusion_rules?: string[];
  custom_rules?: string[];
}

// ─── SearchRun ──────────────────────────────────────────────────────────────

export type SearchRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partially_completed"
  | "failed";

export interface SearchRun {
  id: string;
  query: string;
  filters?: Record<string, unknown>;
  source: string;
  status: SearchRunStatus;
  started_at: string;
  completed_at?: string;
  result_count: number;
  error_count: number;
  metadata?: Record<string, unknown>;
}

// ─── Intent Scoring ─────────────────────────────────────────────────────────

export interface IntentScoreBreakdown {
  total: number;
  factors: ScoreEvidence[];
}

export interface ICPScoreBreakdown {
  total: number;
  factors: ScoreEvidence[];
}

export interface LeadScoreBreakdown {
  icp_fit: number;
  intent: number;
  contactability: number;
  data_confidence: number;
  qualification: number;
  overall: number;
  icp_evidence: ScoreEvidence[];
  intent_evidence: ScoreEvidence[];
}

// ─── DemandSignal ───────────────────────────────────────────────────────────

export type DemandClassification =
  | "buyer"
  | "peer_competitor"
  | "kol"
  | "noise";

export interface DemandSignalResult {
  platform: string;
  author: string;
  author_profile_url?: string;
  company?: string;
  post_url: string;
  post_text: string;
  detected_problem?: string;
  intent_category: DemandClassification;
  confidence: number;
  detected_at: string;
}
