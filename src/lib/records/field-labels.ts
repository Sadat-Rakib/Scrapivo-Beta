/**
 * Scrapivo — centralized human-friendly field labels.
 *
 * Raw snake_case implementation keys must never reach the frontend. Every
 * dynamic label rendered in the UI goes through {@link humanLabel}, which
 * consults the curated map first and otherwise applies word-level overrides
 * (so "vc_investment_types" becomes "VC investment types", never
 * "Vc Investment Types").
 */

/** Curated labels for known source-record keys (leaf names). */
export const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  id: "ID",
  type: "Type",
  record_type: "Record type",
  entity_type: "Entity type",
  investor_type: "Investor type",
  investor_types: "Investor types",
  firm_type: "Firm type",
  lp_type: "LP type",
  focus: "Focus",
  aum: "AUM",
  founded: "Founded",
  employees: "Employees",
  website: "Website",
  email: "Email",
  phone: "Phone",
  address: "Address",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  target_sectors: "Target sectors",
  target_subsectors: "Target subsectors",
  target_regions: "Target regions",
  active_regions: "Active regions",
  offices: "Offices",
  countries: "Countries",
  cities: "Cities",
  us_states: "U.S. states",
  asset_classes: "Asset classes",
  vc_investment_types: "VC investment types",
  stated_investment_range: "Stated investment range",
  profile_summary: "Profile summary",
  source_file: "Source file",
  information_completeness_score: "Information completeness",
  image_url: "Image",
  title: "Title",
  current_role: "Current role",
  role: "Role",
  firm_name: "Firm",
  firm: "Firm website",
  location: "Location",
  locations: "Locations",
  investment_profile: "Investment profile",
  investment_range: "Investment range",
  investment_location: "Investment locations",
  sweet_spot: "Sweet spot",
  stages: "Stages",
  sectors: "Sectors",
  min: "Min",
  max: "Max",
  raw: "Raw",
  range_min: "Range min",
  range_max: "Range max",
  check_min_usd: "Check min (USD)",
  check_max_usd: "Check max (USD)",
  verification_status: "Verification status",
  record_status: "Record status",
  bio: "Bio",
  thesis: "Thesis",
  investment_thesis: "Investment thesis",
  description: "Description",
  links: "Links",
  profile: "Profile",
  // Normalized job fields
  board_id: "Board",
  posted_at: "Posted",
  updated_at: "Updated",
  fetched_at: "Fetched",
  employment_type: "Employment type",
  department: "Department",
  benefits: "Benefits",
  salary: "Compensation",
  seniority: "Seniority",
  remote: "Remote",
  url: "Application URL",
  source: "Source",
  source_url: "Source URL",
  company: "Company",
  // Business fields
  category: "Category",
  hours: "Hours",
  rating: "Rating",
  review_count: "Reviews",
  opportunity_tags: "Opportunity signals",
  website_status: "Website status",
  email_verified: "Email verified",
  verify_note: "Email verification note",
  sample_url: "Listing URL",
  evidence: "Evidence",
  domain: "Domain",
};

/** Word-level overrides for keys not in the curated map. */
const WORD_OVERRIDES: Record<string, string> = {
  vc: "VC",
  lp: "LP",
  us: "U.S.",
  url: "URL",
  aum: "AUM",
  linkedin: "LinkedIn",
  twitter: "Twitter",
  ai: "AI",
  ceo: "CEO",
  cto: "CTO",
  hr: "HR",
  seo: "SEO",
  b2b: "B2B",
  b2c: "B2C",
  saas: "SaaS",
};

/**
 * Human-friendly label for a (possibly dotted) source key.
 * `investment_profile.sweet_spot` → "Sweet spot";
 * `vc_investment_types` → "VC investment types".
 */
export function humanLabel(key: string): string {
  const leaf = key.split(".").pop() ?? key;
  if (FIELD_LABELS[leaf]) return FIELD_LABELS[leaf];
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return leaf
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (WORD_OVERRIDES[lower]) return WORD_OVERRIDES[lower];
      if (i > 0) return lower; // sentence-style casing: "Target sectors"
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Internal parser/ingest metadata that must stay out of the ordinary UI.
 * These values are still available to provenance sections, badges, image
 * rendering, and the dev-mode audit — they just never render as raw rows.
 * Verification/ingest internals (email_verified, website_status, verify_note,
 * sample_url/listing_url, fetched_at) surface only through curated UI
 * elements (links, status chips), never as key/value rows.
 */
export const INTERNAL_HIDDEN_KEYS = new Set([
  "id",
  "key",
  "record_type",
  "source_file",
  "image_url",
  "information_completeness_score",
  "score",
  "entity_id",
  "_ranking",
  "_matchMetadata",
  "verify_note",
  "email_verified",
  "website_status",
  "sample_url",
  "listing_url",
  "fetched_at",
]);

/** True when a dotted populated-field key is internal metadata. */
export function isInternalKey(key: string): boolean {
  const leaf = key.split(".").pop() ?? key;
  return INTERNAL_HIDDEN_KEYS.has(leaf) || INTERNAL_HIDDEN_KEYS.has(key);
}
