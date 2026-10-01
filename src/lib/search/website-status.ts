/**
 * Website status for a local-business lead, from evidence only (Task 9).
 *
 * "No website" is a claim that needs proof: a listing without a URL is not
 * evidence that no official site exists. Only a subject-bound `no_website`
 * claim (structured absence plus exact-name web checks) earns "verified".
 * Pure and client-safe.
 */
import { ensureHttpUrl } from "@/lib/search/site-url";

export type WebsiteState = "has_website" | "unreachable" | "no_website_verified" | "no_website_on_record";

export type WebsiteStatusInput = {
  website?: string | null;
  website_status?: string | null;
  opportunity_tags?: readonly string[] | null;
  /** Spec path: claim-bound evidence carried from the qualified lead. */
  claim_evidence?: ReadonlyArray<{ claim_type?: string | null; evidence_text?: string | null; evidence_url?: string | null }> | null;
};

export type WebsiteStatusView = {
  state: WebsiteState;
  label: string;
  /** Short proof for a verified absence, when the evidence has one. */
  proof: string | null;
  tone: "neutral" | "opportunity" | "warning";
};

export function websiteStatus(row: WebsiteStatusInput): WebsiteStatusView {
  const url = row.website ? ensureHttpUrl(row.website) : null;
  if (url) {
    return row.website_status === "unreachable"
      ? { state: "unreachable", label: "Website listed but unreachable", proof: null, tone: "warning" }
      : { state: "has_website", label: "Has a website", proof: null, tone: "neutral" };
  }
  const claim = (row.claim_evidence ?? []).find((item) => item.claim_type === "no_website");
  if (claim) {
    return { state: "no_website_verified", label: "No website (verified)", proof: claim.evidence_text?.slice(0, 200) ?? null, tone: "opportunity" };
  }
  return { state: "no_website_on_record", label: "No website on record (not verified)", proof: null, tone: "neutral" };
}
