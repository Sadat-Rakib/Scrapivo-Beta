/**
 * Completeness gate (Phase A): required fields by entity before a row may
 * appear on the first page. Incomplete rows go to enrichment — never onto
 * the grid as fake-complete, and never LLM-filled.
 */
import type { SpecEntity } from "./search-spec";

export type CompletenessKind = "person" | "company" | "business" | "investor" | "job";

export type CompletenessRow = {
  kind: CompletenessKind;
  title?: string | null;
  detail?: string | null;
  email?: string | null;
  phone?: string | null;
  url?: string | null;
  location?: string | null;
  country?: string | null;
  category?: string | null;
  industry?: string | null;
  why_match?: string | null;
  /** When the hunt is "no website", missing url is the opportunity, not a gap. */
  opportunity?: string | null;
};

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.trim() !== "?";

/** Human-readable list of what's still missing (for enrich queue / UI). */
export function missingRequiredFields(row: CompletenessRow): string[] {
  const miss: string[] = [];
  if (!has(row.title)) miss.push("name");
  switch (row.kind) {
    case "person":
      // People need a reachable channel OR profile URL before first-page show.
      if (!has(row.email) && !has(row.phone) && !has(row.url)) miss.push("contact");
      break;
    case "company":
    case "business": {
      // Enrich-before-show: name alone is not enough. Need a contact channel,
      // a site, or an explicit no-website opportunity (url absence is the hit).
      const noSiteOk = row.opportunity === "no_website" && !has(row.url);
      if (!has(row.email) && !has(row.phone) && !has(row.url) && !noSiteOk) {
        miss.push("contact_or_site");
      }
      break;
    }
    case "investor":
      if (!has(row.email) && !has(row.url)) miss.push("contact");
      break;
    case "job":
      if (!has(row.url) && !has(row.email)) miss.push("apply_or_contact");
      break;
  }
  return miss;
}

export function rowIsComplete(row: CompletenessRow): boolean {
  return missingRequiredFields(row).length === 0;
}

/** Map SearchSpec entity → completeness kind (unknown → person as safe default). */
export function completenessKindFor(entity: SpecEntity): CompletenessKind {
  if (entity === "company" || entity === "business" || entity === "investor" || entity === "job") {
    return entity;
  }
  return "person";
}
