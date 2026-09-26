/**
 * Relevance chips + filter-bar state (Phase A3). Every chip is derived from
 * stated criteria + observed row fields — never invented. Rows that cannot
 * prove a claim show no chip for it.
 */
import { inferOfferingId } from "@/lib/search/offer-taxonomy";

export interface TurnFilter {
  mode?: string;
  offer?: string;
  opportunity?: string;
  site?: string;
  channel?: string;
}

export interface RowSignals {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Chips for one business/company row under the turn's stated filter.
 * contactFieldsKnown=false when the row type carries no email/phone fields
 * (CompanyRow): thin-presence claims are then withheld — absence of a field
 * is not evidence of absence of the contact.
 */
export function relevanceChips(
  row: RowSignals,
  filter: TurnFilter | null,
  contactFieldsKnown = true,
): string[] {
  if (!filter || filter.mode !== "selling") return [];
  const offering = inferOfferingId(filter.offer ?? "");
  if (!offering) return [];
  const chips: string[] = [];
  const hasSite = !!row.website;
  if (offering === "websites") {
    if (filter.opportunity === "no_website") {
      if (!hasSite) chips.push("No website", "Matches your offer");
      else chips.push("Has website");
    } else if (filter.site === "with" || hasSite) {
      chips.push(hasSite ? "Has website" : "No website");
    }
    // No site preference stated: no row claims (the bar says "Showing all").
  } else if (offering === "design") {
    if (filter.opportunity === "stale_site") {
      if (hasSite && !row.email && !row.phone && contactFieldsKnown)
        chips.push("Thin web presence", "Matches your offer");
      else if (hasSite) chips.push("Has website");
      else chips.push("No website");
    } else if (filter.opportunity === "no_website") {
      if (!hasSite) chips.push("No website", "Matches your offer");
    } else if (hasSite) {
      chips.push("Has website");
    }
  } else if (offering === "marketing") {
    if (filter.channel) chips.push(`Pitch: ${filter.channel}`);
  } else {
    // Recognized-only offerings: one honest chip naming the offer.
    if (filter.offer?.trim()) chips.push(`For: ${filter.offer.trim().slice(0, 28)}`);
  }
  return chips;
}

/** Filter-bar model for the active turn. Null = nothing to show (no selling). */
export function filterBarModel(filter: TurnFilter | null): {
  visible: boolean;
  modeLabel: string | null;
  offerLabel: string | null;
  filterState: "no-website-on" | "stale-site-on" | "unset" | "off";
  showSiteToggle: boolean;
} {
  const empty = {
    visible: false,
    modeLabel: null,
    offerLabel: null,
    filterState: "off" as const,
    showSiteToggle: false,
  };
  if (!filter || filter.mode !== "selling") return empty;
  const offering = inferOfferingId(filter.offer ?? "");
  const out = {
    visible: true,
    modeLabel: "Selling",
    offerLabel: filter.offer?.trim() || null,
    filterState: "off" as "no-website-on" | "stale-site-on" | "unset" | "off",
    showSiteToggle: false,
  };
  if (filter.opportunity === "no_website") out.filterState = "no-website-on";
  else if (filter.opportunity === "stale_site") out.filterState = "stale-site-on";
  else if (offering === "websites" || offering === "design") {
    out.filterState = "unset";
    out.showSiteToggle = true;
  }
  return out;
}
