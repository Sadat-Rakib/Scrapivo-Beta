/**
 * H14 — website-absence rule ("website not found after verification").
 *
 * The claim "website not found after verification" may ONLY be concluded when
 * ALL four components hold, each backed by recorded Evidence:
 *   (a) structured listing(s) for the business lack a website field,
 *   (b) an exact identity search was performed,
 *   (c) an official-domain search was performed,
 *   (d) no credible first-party site was discovered.
 *
 * Absence of a website field alone is NOT sufficient. This module never
 * searches — callers collect the evidence pieces and this function decides,
 * preserving the exact claim wording (never simplified).
 */
import type { Evidence, EvidenceSourceType } from "./evidence";
import { makeEvidence } from "./evidence";

export const WEBSITE_NOT_FOUND_AFTER_VERIFICATION =
  "website not found after verification";

export type AbsenceComponentKey =
  | "structured_listing_absence"
  | "exact_identity_search"
  | "official_domain_search"
  | "no_first_party_site";

export const ABSENCE_COMPONENT_KEYS: AbsenceComponentKey[] = [
  "structured_listing_absence",
  "exact_identity_search",
  "official_domain_search",
  "no_first_party_site",
];

export interface WebsiteAbsenceInputs {
  /** (a) Structured listing(s) for the business that lack a website field. */
  structured_listing_absence: Evidence[];
  /** (b) Exact identity search(es) performed (quoted name [+ location]). */
  exact_identity_search: Evidence[];
  /** (c) Official-domain / official-site search(es) performed. */
  official_domain_search: Evidence[];
  /** (d) Checks that found no credible first-party site. */
  no_first_party_site: Evidence[];
}

export interface WebsiteAbsenceResult {
  /** True only when all four components carry evidence. */
  ok: boolean;
  /** Components that are missing (empty evidence arrays). */
  missing: AbsenceComponentKey[];
  /** The subject-bound no_website claim — null unless ok. */
  claim: Evidence | null;
  /** Per-component evidence, recorded even when the claim is refused. */
  components: WebsiteAbsenceInputs;
  /** Flattened component evidence (for attaching to candidate evidence). */
  evidence: Evidence[];
}

function validEvidence(list: Evidence[] | undefined): Evidence[] {
  return (list ?? []).filter((e) => !!e && typeof e.source_url === "string" && e.source_url.trim().length > 0);
}

function sourceTypeFor(url: string): EvidenceSourceType {
  if (url.startsWith("overture:")) return "db";
  if (url.startsWith("osm:")) return "osm";
  return "web";
}

/**
 * Decide the no_website claim from collected evidence pieces.
 * Pure: no network, no side effects. Each component's evidence is echoed back
 * so diagnostics can show exactly which checks were performed (or skipped).
 */
export function verifyWebsiteAbsence(
  inputs: Partial<WebsiteAbsenceInputs>,
  args: { subject?: string; observedAt?: string } = {},
): WebsiteAbsenceResult {
  const components = {
    structured_listing_absence: validEvidence(inputs.structured_listing_absence),
    exact_identity_search: validEvidence(inputs.exact_identity_search),
    official_domain_search: validEvidence(inputs.official_domain_search),
    no_first_party_site: validEvidence(inputs.no_first_party_site),
  } satisfies WebsiteAbsenceInputs;

  const missing = ABSENCE_COMPONENT_KEYS.filter((key) => components[key].length === 0);
  const flattened = ABSENCE_COMPONENT_KEYS.flatMap((key) => components[key]);
  const observedAt = args.observedAt ?? new Date().toISOString();

  if (missing.length) {
    return { ok: false, missing, claim: null, components, evidence: flattened };
  }

  // Primary provenance: the structured listing that lacks the website field;
  // fall back to the exact identity search record; last resort entity: URI
  // (structural no_website claims may use an entity: URI).
  const structured = components.structured_listing_absence[0]!;
  const identity = components.exact_identity_search[0]!;
  const sourceUrl = structured.source_url || identity.source_url || `entity:${args.subject ?? "unknown"}`;

  const claim = makeEvidence({
    source_url: sourceUrl,
    source_type: sourceTypeFor(sourceUrl),
    evidence_type: "no_website",
    supports: "opportunity",
    subject: args.subject,
    excerpt:
      `${WEBSITE_NOT_FOUND_AFTER_VERIFICATION}: structured listing has no website field; ` +
      `exact identity search and official-domain search performed; no credible first-party site discovered.`,
    observed_at: observedAt,
    confidence: 0.7,
    extraction_method: sourceUrl.startsWith("overture:")
      ? "structured_absence_plus_exact_web_check"
      : sourceUrl.startsWith("osm:")
        ? "osm_absence_plus_exact_web_check"
        : "absence_verified_four_component_check",
    claim_parameters: {
      structured_listing_absence: "present",
      exact_identity_search: "present",
      official_domain_search: "present",
      no_first_party_site: "present",
      structured_listing_source: structured.source_url,
      exact_identity_query_count: components.exact_identity_search.length,
      official_domain_query_count: components.official_domain_search.length,
      first_party_site_found: false,
    },
  });

  return { ok: true, missing: [], claim, components, evidence: [...flattened, claim] };
}
