/**
 * Evidence schema + evidence-backed why-match (Phase 1B).
 * Hard invariant: no evidence → no evidence-backed why-match.
 */
export type EvidenceSourceType =
  | "web"
  | "osm"
  | "job"
  | "social"
  | "news"
  | "registry"
  | "db"
  | "other";

export type EvidenceType =
  | "hiring"
  | "service_request"
  | "no_website"
  | "funding"
  | "social_ask"
  | "contact"
  | "identity"
  | "other";

export type EvidenceSupports =
  | "requested_role"
  | "requested_service"
  | "requested_product"
  | "opportunity"
  | "intent"
  | "identity"
  | "other";

export interface Evidence {
  source_url: string;
  source_type: EvidenceSourceType;
  excerpt: string | null;
  observed_at: string;
  evidence_type: EvidenceType;
  supports: EvidenceSupports;
  confidence: number;
  /** How the observation was made (structural opportunity must set this). */
  extraction_method?: string;
  /**
   * Entity this claim is ABOUT (subject binding).
   * Required for qualification under signal_required — see canonical-contract.
   */
  subject?: string;
  claim_parameters?: Record<string, string | number | boolean | null>;
  /** When the claimed event occurred (temporal Spec); not discovery time. */
  event_at?: string | null;
  /** Unique id of this evidence record (never a browser session id). */
  id?: string;
  /** How the observation was acquired (browser research stamps this). */
  provenance?: EvidenceProvenance;
}

export interface EvidenceProvenance {
  acquisition: "browser" | "http" | "structured" | "provider";
  /** URL the browser was asked to open; `source_url` is the final URL. */
  requested_url?: string | null;
  search_run_id?: string | null;
  browser_session_id?: string | null;
}

export interface FieldProvenance {
  field: string;
  value: unknown;
  source: string;
  source_type: EvidenceSourceType;
  source_url: string | null;
  observed_at: string;
  extraction_method: string;
  confidence: number;
  verification_status: "discovered" | "normalized" | "verified" | "rejected";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeEvidence(partial: Omit<Evidence, "observed_at" | "confidence"> & {
  observed_at?: string;
  confidence?: number;
}): Evidence {
  return {
    ...partial,
    confidence: partial.confidence ?? 0.7,
    // Must land after spread so an explicit `undefined` (e.g. social hits
    // without created_utc) does not wipe the default crawl timestamp.
    observed_at: partial.observed_at ?? nowIso(),
  };
}

/**
 * Structural opportunity evidence MUST identify observation + source.
 * Forbidden: infer no_website merely because search returned nothing.
 */
export function structuralNoWebsiteEvidence(args: {
  source_url: string;
  source_type: EvidenceSourceType;
  extraction_method: string;
  observation: string;
  confidence?: number;
  subject?: string;
}): Evidence {
  return makeEvidence({
    source_url: args.source_url,
    source_type: args.source_type,
    excerpt: args.observation,
    evidence_type: "no_website",
    supports: "opportunity",
    extraction_method: args.extraction_method,
    confidence: Math.min(0.75, args.confidence ?? 0.7),
    subject: args.subject,
  });
}

/** Build why_match from evidence only. Returns null when none. */
export function whyMatchFromEvidence(evidence: Evidence[] | null | undefined): string | null {
  if (!evidence?.length) return null;
  const primary = evidence[0];
  const clip = (s: string | null, n = 120) =>
    s ? (s.length > n ? `${s.slice(0, n).trim()}…` : s.trim()) : null;
  const excerpt = clip(primary.excerpt);
  const host = (() => {
    try {
      return new URL(primary.source_url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  switch (primary.evidence_type) {
    case "hiring":
      return excerpt
        ? `Hiring signal · “${excerpt}”${host ? ` · ${host}` : ""}`
        : host
          ? `Hiring evidence · ${host}`
          : "Hiring evidence on file";
    case "service_request":
      return excerpt
        ? `Service need · “${excerpt}”${host ? ` · ${host}` : ""}`
        : "Service-need evidence on file";
    case "no_website":
      return excerpt
        ? `Website not found after verification · ${excerpt}`
        : "Website not found after verification";
    case "funding":
      return excerpt
        ? `Funding · “${excerpt}”${host ? ` · ${host}` : ""}`
        : host
          ? `Funding evidence · ${host}`
          : "Funding evidence on file";
    case "social_ask":
      return excerpt
        ? `Social ask · “${excerpt}”${host ? ` · ${host}` : ""}`
        : "Social demand evidence on file";
    case "contact":
      return excerpt
        ? `Contact details observed · “${excerpt}”${host ? ` · ${host}` : ""}`
        : "Contact details harvested from site";
    case "identity":
      // E2E-C12: a stored record restating who someone is provenance, not a
      // reason. Returning it as the why-match made every delivered row claim
      // "evidence" that was just the row's own fields echoed back. Return null
      // so callers fall through to the criteria-based why_match.
      return null;
    default:
      return excerpt ? excerpt : host ? `Evidence · ${host}` : null;
  }
}

/**
 * @deprecated Legacy any-of type check. Qualification must use
 * claim-aligned + subject-bound gates in `canonical-contract` / `qualify`.
 * Kept for scoreIntent / diagnostics only.
 */
export function hasQualifyingEvidence(evidence: Evidence[] | null | undefined): boolean {
  if (!evidence?.length) return false;
  return evidence.some((e) =>
    ["hiring", "service_request", "no_website", "funding", "social_ask"].includes(e.evidence_type),
  );
}
