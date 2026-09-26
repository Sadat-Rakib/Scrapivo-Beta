/**
 * M14 — Author ↔ company relationship for social claims.
 *
 * An employee casually posting does NOT create a company-level buying signal.
 * Company subject binding requires: proven employment + ask on company's behalf.
 */
import type { Evidence } from "@/lib/search/evidence";
import type { QualificationRejectCode } from "@/lib/search/canonical-contract";
import { employmentFromEvidence } from "@/lib/search/person-employment";
import type { SocialNeedDetection } from "@/lib/search/social-need";

export type SocialCompanyBinding =
  | {
      ok: true;
      subject_entity_id: string;
      subject_kind: "person" | "company";
      organization_entity_id: string | null;
    }
  | { ok: false; reject_code: QualificationRejectCode; reason: string };

/**
 * Decide who the social_ask ClaimEvidence is about.
 * Default: the resolved author (person).
 * Company subject only when company_behalf + proven employment to that org.
 */
export function bindSocialClaimSubject(args: {
  author_entity_id: string;
  need: SocialNeedDetection;
  evidence: Evidence[];
  /** When qualifying the company instead of the person. */
  prefer_company_subject?: boolean;
}): SocialCompanyBinding {
  const { author_entity_id, need, evidence } = args;
  const orgName = need.claim_parameters.organization_name?.trim() || null;
  const onBehalf = need.claim_parameters.company_behalf === "true";

  if (!args.prefer_company_subject && !onBehalf) {
    // Personal ask — even if author works at Acme, subject stays the person.
    return {
      ok: true,
      subject_entity_id: author_entity_id,
      subject_kind: "person",
      organization_entity_id: null,
    };
  }

  if (!onBehalf || !orgName) {
    return {
      ok: false,
      reject_code: "CLAIM_NOT_SUBJECT_BOUND",
      reason:
        "company-level social claim requires first-person org voice (we at …) plus org name",
    };
  }

  let lastFail: SocialCompanyBinding | null = null;
  for (const ev of evidence) {
    const emp = employmentFromEvidence({
      person_entity_id: author_entity_id,
      evidence: ev,
      organization_name: orgName,
    });
    if (!emp.ok) {
      lastFail = {
        ok: false,
        reject_code: emp.reject_code,
        reason: emp.reason,
      };
      continue;
    }
    const orgId = emp.employment.organization_entity_id;
    const nameMatch =
      !orgName ||
      (emp.employment.organization_name ?? "")
        .toLowerCase()
        .includes(orgName.toLowerCase()) ||
      orgName.toLowerCase().includes(
        (emp.employment.organization_name ?? "").toLowerCase(),
      );
    if (!nameMatch && orgName) {
      // Still allow if org id present — name on claim may differ slightly.
      // Prefer explicit organization_name alignment when both set.
      const params =
        ("claim_parameters" in ev && ev.claim_parameters) ||
        ({} as Record<string, unknown>);
      const named =
        (typeof params.organization_name === "string" &&
          params.organization_name) ||
        "";
      if (
        named &&
        !named.toLowerCase().includes(orgName.toLowerCase()) &&
        !orgName.toLowerCase().includes(named.toLowerCase())
      ) {
        lastFail = {
          ok: false,
          reject_code: "CLAIM_PARAMETER_MISMATCH",
          reason: `employment org ${named} ≠ ask behalf ${orgName}`,
        };
        continue;
      }
    }
    return {
      ok: true,
      subject_entity_id: orgId,
      subject_kind: "company",
      organization_entity_id: orgId,
    };
  }

  return (
    lastFail ?? {
      ok: false,
      reject_code: "EMPLOYMENT_UNPROVEN",
      reason: `author ask on behalf of ${orgName} without proven employment relationship`,
    }
  );
}
