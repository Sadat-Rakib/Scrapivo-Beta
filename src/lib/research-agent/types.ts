import type { SearchSpec, SpecEntity } from "@/lib/search/search-spec";
import type { Evidence } from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";

export type CandidateState =
  | "DISCOVERED"
  | "MATCHED"
  | "NEEDS_ENRICHMENT"
  | "ENRICHING"
  | "READY_FOR_VERIFICATION"
  | "VERIFIED"
  | "QUALIFIED"
  | "REJECTED"
  | "UNRESOLVED";

export type OperationalStatus =
  | "ACTIVE"
  | "TEMPORARILY_CLOSED"
  | "PERMANENTLY_CLOSED"
  | "INACTIVE"
  | "UNKNOWN";

export type EvidenceGrade = "A" | "B" | "C" | "D";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface FieldEvidence {
  field: string;
  value: string | number | boolean | null;
  sourceUrl: string;
  sourceType: string;
  observedAt: string;
  publishedAt?: string | null;
  evidenceGrade: EvidenceGrade;
  confidence: number;
  note?: string | null;
}

export type SignalType =
  | "HIRING"
  | "SEEKING_JOB"
  | "SEEKING_SERVICE"
  | "FUNDRAISING"
  | "RECENTLY_FUNDED"
  | "EXPANDING"
  | "PRODUCT_LAUNCH"
  | "RECENT_ACTIVITY"
  | "NO_WEBSITE"
  | "WEAK_WEBSITE"
  | "TECHNOLOGY_USAGE"
  | "ROLE_CHANGE"
  | "USER_DEFINED";

export interface SignalEvidence {
  type: SignalType;
  claim: string;
  sourceUrl: string;
  sourceType: string;
  observedAt: string;
  eventAt?: string | null;
  freshness: "CURRENT" | "RECENT" | "STALE" | "UNKNOWN";
  confidence: number;
  evidenceGrade: EvidenceGrade;
  snippetOrObservation: string;
}

export interface RetrievalPlan {
  spec: SearchSpec;
  entity: SpecEntity;
  role: string | null;
  title: string | null;
  industry: string | null;
  category: string | null;
  niche: string | null;
  company: string | null;
  location: string | null;
  radiusKm: number | null;
  excludedLocations: string[];
  explicitQuantity: boolean;
  targetQuantity: number;
  initialTarget: number;
  requiredFields: string[];
  preferredFields: string[];
  relation: string | null;
  signalRequired: boolean;
  signalTypes: SignalType[];
  freshnessRequired: boolean;
  temporal: string | null;
  technology: string[];
  compoundSubgoals: string[];
  outputRequirements: string[];
}

export interface ResearchCandidate {
  id: string;
  row: SpecRow;
  state: CandidateState;
  origin: "stored" | "live" | "browser";
  evidence: Evidence[];
  fieldEvidence: FieldEvidence[];
  signals: SignalEvidence[];
  operationalStatus: OperationalStatus;
  operationalStatusEvidence: FieldEvidence[];
  missingFields: string[];
  rejectionReason: string | null;
  whyMatch: string | null;
}

export type ResearchPhase =
  | "UNDERSTANDING"
  | "KNOWN_SOURCES"
  | "ENRICHMENT"
  | "LIVE_SEARCH"
  | "BROWSER"
  | "VERIFICATION"
  | "DELIVERY";

export type ResearchEventType =
  | "UNDERSTANDING_READY"
  | "RESEARCH_STARTED"
  | "KNOWN_SOURCE_SEARCH_STARTED"
  | "KNOWN_SOURCE_RESULTS"
  | "ENRICHMENT_STARTED"
  | "FIELD_LOOKUP"
  | "LIVE_SEARCH_STARTED"
  | "SOURCE_SELECTED"
  | "BROWSER_SESSION_STARTED"
  | "NAVIGATING"
  | "PAGE_LOADED"
  | "INSPECTING_PAGE"
  | "CLICKING"
  | "TYPING"
  | "SCROLLING"
  | "OPENING_PROFILE"
  | "OPENING_WEBSITE"
  | "CHECKING_CONTACT"
  | "CONTACT_FOUND"
  | "CHECKING_SIGNAL"
  | "SIGNAL_FOUND"
  | "CHECKING_STATUS"
  | "CANDIDATE_ACCEPTED"
  | "CANDIDATE_REJECTED"
  | "CAPTCHA_DETECTED"
  | "ACCESS_RESTRICTED"
  | "HUMAN_ACTION_REQUIRED"
  | "SOURCE_FAILED"
  | "FALLBACK"
  | "RESULTS_READY"
  | "CANCELLED"
  | "DONE";

export interface ResearchEvent {
  sessionId: string;
  timestamp: string;
  type: ResearchEventType;
  phase: ResearchPhase;
  internal: Record<string, JsonValue>;
  message: string;
  domain?: string | null;
  screenshotRef?: string | null;
  candidateCount?: number;
}

export interface ResearchBudgets {
  maxWallTimeMs: number;
  maxPages: number;
  maxBrowserActions: number;
  maxScrolls: number;
  maxQueryVariants: number;
  maxBrowserReasoningCalls: number;
  maxScreenshots: number;
  maxCandidates: number;
}

export interface ResearchMetrics {
  storedCandidates: number;
  storedReady: number;
  enriched: number;
  liveDiscovered: number;
  browserDiscovered: number;
  browserVerified: number;
  rejected: number;
  duplicates: number;
  finalDelivered: number;
  timeToFirstVerifiedMs: number | null;
  totalLatencyMs: number;
  providerCalls: number;
  browserActions: number;
  pages: number;
  screenshots: number;
  aiCalls: {
    understanding: number;
    stored: 0;
    providers: 0;
    enrichment: number;
    browserReasoning: number;
  };
}

export interface ResearchResult {
  sessionId: string;
  plan: RetrievalPlan;
  candidates: ResearchCandidate[];
  events: ResearchEvent[];
  needsMore: boolean;
  exhausted: boolean;
  cancelled: boolean;
  continuationToken: string | null;
  metrics: ResearchMetrics;
}

export const DEFAULT_RESEARCH_BUDGETS: ResearchBudgets = {
  maxWallTimeMs: 120_000,
  maxPages: 30,
  maxBrowserActions: 80,
  maxScrolls: 12,
  maxQueryVariants: 8,
  maxBrowserReasoningCalls: 3,
  maxScreenshots: 12,
  maxCandidates: 150,
};
