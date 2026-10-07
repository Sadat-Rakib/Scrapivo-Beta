import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchSpec } from "./search-spec";
import type { Qualification } from "./qualify";
import { queryRequiredFields } from "./canonical-contract";
import { missingRequiredFields } from "./completeness";

export type ResearchNeed = "identity" | "role" | "company" | "industry" | "location" | "website" | "profile" | "contact" | "social" | "signal" | "topic" | "no_website_verification";
export type ResearchStatus = "discovered" | "researching" | "ready_for_qualification" | "verified" | "exhausted" | "rejected";

/**
 * Fields the ask wants, from hard requirements AND soft enrichment wishes.
 * "get linkedin website email whatever you can actually verify" demotes its
 * channels to enrichment_requirements — they must still be hunted here, they
 * just no longer gate delivery.
 */
const requested = (spec: SearchSpec, field: string) =>
  spec.criteria.some((criterion) => criterion.field === field) ||
  (field !== "opportunity" &&
    !!spec.understanding?.enrichment_requirements?.some((item) => {
      const want = item.value.toLowerCase().replace(/[^a-z]/g, "");
      return want === field ||
        (want === "site" && field === "website") ||
        (want === "ig" && field === "social") ||
        (want === "instagram" && (field === "social" || field === "profile")) ||
        (want === "linkedin" && field === "profile");
    }));

/**
 * A contact need is satisfied only by a genuinely observed channel: an email
 * or phone on the row, or a contact page whose provenance is verified. A bare
 * or merely discovered contact_page_url is a guess, never a satisfied need.
 */
const contactSatisfied = (row: SpecRow) => !!row.email || !!row.phone || (!!row.contact_page_url &&
  (row.field_provenance?.contact_page_url as Record<string, unknown> | undefined)?.verification_status === "verified");

/** The next browser action follows the current qualification result and the user's required fields. */
export function computeResearchNeeds(row: SpecRow, spec: SearchSpec, qualification: Qualification): ResearchNeed[] {
  const destination = row.kind === "person" ? row.profile_url ?? row.website_url : row.kind === "job" ? row.apply_url : row.website_url;
  const incomplete = missingRequiredFields({ ...row, url: destination ?? null });
  const wantsPublicContact = /public contact details?/i.test(spec.raw_query) && !contactSatisfied(row);
  const required = queryRequiredFields(spec);
  const missingRequested = required.some((field) =>
    (field === "email" && !row.email) || (field === "phone" && !row.phone) ||
    (field === "contact" && !contactSatisfied(row)) ||
    (field === "website" && !row.website_url) ||
    (field === "socials" && !row.evidence?.some((item) => item.source_type === "social" && !!item.source_url)));
  if (qualification.disposition === "qualified" && incomplete.length === 0 && !wantsPublicContact && !missingRequested) return [];
  if (qualification.reject_code === "ENTITY_TYPE_MISMATCH" || qualification.reject_code === "LOCATION_MISMATCH") return [];
  const needs: ResearchNeed[] = [];
  const add = (need: ResearchNeed) => { if (!needs.includes(need)) needs.push(need); };
  if (!row.entity_resolved || qualification.reject_code === "ENTITY_UNRESOLVED" || qualification.reject_code === "PROVISIONAL_ENTITY" || qualification.reject_code === "IDENTITY_AMBIGUOUS") add("identity");
  if (row.kind === "person" || requested(spec, "role")) {
    if (!row.role || ["EMPLOYMENT_UNPROVEN", "CURRENTNESS_MISMATCH", "ASSOCIATED_COMPANY_UNRESOLVED"].includes(qualification.reject_code ?? "")) add("role");
    if (!row.company) add("company");
  }
  if (requested(spec, "industry") && !row.industry || requested(spec, "category") && !row.category) add("industry");
  if (requested(spec, "location") && !row.location) add("location");
  if (row.kind === "person") { if (!row.profile_url && !row.website_url) add("profile"); }
  else if (row.kind === "job") { if (!row.apply_url) add("website"); }
  else if (!row.website_url && !requested(spec, "opportunity")) add("website");
  if (requested(spec, "opportunity") && spec.criteria.some((criterion) => criterion.field === "opportunity" && criterion.value === "no_website") && !row.website_url) add("no_website_verification");
  if (required.some((field) => (field === "email" && !row.email) || (field === "phone" && !row.phone) ||
      (field === "contact" && !contactSatisfied(row))) || wantsPublicContact ||
      (requested(spec, "email") && !row.email)) add("contact");
  if ((required.includes("website") || requested(spec, "website")) && !row.website_url) add("website");
  if ((required.includes("socials") || requested(spec, "socials")) &&
      !row.evidence?.some((item) => item.source_type === "social" && !!item.source_url)) add("social");
  if (requested(spec, "linkedin") && !row.profile_url && !row.website_url) add("profile");
  if (requested(spec, "content_topic") && qualification.reject_code === "NO_CLAIM_EVIDENCE") add("topic");
  if (spec.signal_required && ["NO_CLAIM_EVIDENCE", "CLAIM_NOT_SUBJECT_BOUND"].includes(qualification.reject_code ?? "")) add("signal");
  if (qualification.reject_code === "MISSING_QUERY_REQUIRED") for (const field of required) {
    if ((field === "email" && !row.email) || (field === "phone" && !row.phone) || (field === "contact" && !contactSatisfied(row))) add("contact");
    else if (field === "url") add(row.kind === "person" ? "profile" : "website");
  }
  if (qualification.reject_code === "NO_CLAIM_EVIDENCE" && needs.length === 0 && requested(spec, "opportunity")) add("no_website_verification");
  return needs;
}

export function researchStatus(qualification: Qualification, needs: ResearchNeed[], exhausted = false): ResearchStatus {
  if (qualification.disposition === "qualified" && needs.length === 0) return "verified";
  if (["ENTITY_TYPE_MISMATCH", "LOCATION_MISMATCH"].includes(qualification.reject_code ?? "")) return "rejected";
  if (qualification.reject_code === "CLAIM_PARAMETER_MISMATCH" && qualification.disposition === "dropped") return "rejected";
  if (exhausted || needs.length === 0) return "exhausted";
  return "researching";
}
