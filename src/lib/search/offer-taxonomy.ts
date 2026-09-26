/**
 * Offering taxonomy (Phase 1.4): understands WHAT the seller sells and turns
 * it into real retrieval criteria — never cosmetic labels.
 *
 * Honesty rule: a row filter is attached ONLY when the data actually carries
 * the signal (today: website presence via url). Every other offering is
 * recognized (mode=selling, offer recorded, intent-bound) with NO row filter
 * and an explicit note — we never fake precision the rows can't support.
 *
 * Follow-ups build the ICP one question at a time (site preference for web
 * offers, channel for marketing). Each answer maps to stated criteria.
 */

import type { ClarifyQuestion } from "@/lib/search/clarifier";

export interface OfferingDef {
  id: string;
  label: string;
  match: RegExp;
  /** Follow-up asked once, after the offer is known. */
  followUp?: (target: string, offeringLabel?: string) => ClarifyQuestion;
}

export const SITE_QUESTION_ID = "entity_site";
export const CHANNEL_QUESTION_ID = "entity_channel";

function siteFollowUp(target: string, offeringLabel = "website"): ClarifyQuestion {
  return {
    id: SITE_QUESTION_ID,
    question: `For your ${offeringLabel} offer — target ${target} with or without an existing site?`,
    options: [
      {
        id: "without",
        label: "Without a website",
        hint: "No site at all — build from scratch",
        recommended: true,
      },
      { id: "with", label: "With a website", hint: "Already have one — redesign/rebuild angle" },
      { id: "any", label: "Either", hint: "Don't filter on this" },
    ],
    allowOther: false,
  };
}

function channelFollowUp(): ClarifyQuestion {
  return {
    id: CHANNEL_QUESTION_ID,
    question: "Which marketing channel are you pitching?",
    options: [
      { id: "seo", label: "SEO", hint: "Rank higher on Google" },
      { id: "social", label: "Social media", hint: "Instagram/Facebook/TikTok management" },
      { id: "ads", label: "Paid ads", hint: "Google/Meta ads management" },
      { id: "any", label: "Any", hint: "Full-service pitch" },
    ],
    allowOther: true,
  };
}

export const OFFERINGS: OfferingDef[] = [
  {
    id: "websites",
    label: "Website design / development",
    match: /\b(websites?|web\s?design|web\s?dev(elopment)?|landing\s?pages?|redesign|rebuilds?)\b/i,
    followUp: siteFollowUp,
  },
  {
    id: "marketing",
    label: "Marketing services",
    // NOTE: no row filter — presence signals can't measure marketing need.
    // The channel answer tailors the pitch (intent layer), not retrieval.
    match:
      /\b(marketing|seo|social\s?media|paid\s?ads|facebook\s?ads|google\s?ads|content\s?marketing|email\s?marketing|lead\s?gen(?:eration)?)\b/i,
    followUp: () => channelFollowUp(),
  },
  {
    id: "sales",
    label: "Sales services",
    match:
      /\b(sales\s?(training|coaching|consulting|outsourcing)?|cold\s?(calling|email|outreach)|appointment\s?setting|closers?)\b/i,
  },
  {
    id: "design",
    label: "Design / branding",
    match: /\b(branding|logo|graphic\s?design|ui\/?ux|brand\s?identity)\b/i,
    // Redesign angle reuses the site question ("with" → stale-site proxy).
    followUp: (target: string) => siteFollowUp(target, "design"),
  },
  {
    id: "copywriting",
    label: "Copywriting / content",
    match: /\b(copywriting|copywriter|content\s?writing|blog\s?writing)\b/i,
  },
  {
    id: "software",
    label: "Software / CRM / automation",
    match: /\b(crm|automation|software|saas\s?setup|ai\s?agents?|chatbots?|systems?)\b/i,
  },
  {
    id: "bookkeeping",
    label: "Bookkeeping / accounting",
    match: /\b(bookkeeping|accounting|tax\s?(prep|filing)|payroll)\b/i,
  },
  {
    id: "cleaning",
    label: "Cleaning services",
    match: /\b(cleaning|janitorial|pressure\s?washing)\b/i,
  },
  {
    id: "photo-video",
    label: "Photography / videography",
    match: /\b(photo(graphy|grapher)?|videography|videographer|drone\s?(photo|video)?)\b/i,
  },
];

/** Offering mentioned in free text (query or offer answer). Null = unknown. */
export function inferOfferingId(text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const o of OFFERINGS) {
    if (o.match.test(t)) return o.id;
  }
  return null;
}

export function offeringById(id: string): OfferingDef | null {
  return OFFERINGS.find((o) => o.id === id) ?? null;
}

/**
 * Opportunity values (retrieval filters, business/company only):
 * - no_website: drop rows with a site (exact null check, both engines).
 * - stale_site: keep rows WITH a site but no email AND no phone (thin web
 *   presence proxy for redesign/outdated-site angles). Tail-only by design:
 *   phone nullness differs between raw DB values and checked display values,
 *   so engine pushdown would silently diverge counts.
 * Applies a site-preference answer to stated criteria.
 * 'without' → opportunity=no_website (the only presence filter the rows
 * support). 'with' → site=with (redesign angle, no row filter — validation
 * ignores unknown opportunity values by design). 'any'/empty → nothing.
 */
export function siteAnswerToCriteria(value: string): { field: string; value: string } | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "without" || v === "no_website") return { field: "opportunity", value: "no_website" };
  if (v === "with" || v === "has_website") return { field: "site", value: "with" };
  return null;
}
