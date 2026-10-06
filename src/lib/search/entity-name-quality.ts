/**
 * Entity-name quality gate (shared).
 *
 * SERP titles and page furniture regularly masquerade as entity names when
 * discovery maps results to candidate rows ("Preferences", "Free Quote",
 * "5,000 A&R Solar Projects Installed"). A junk name is worse than a dropped
 * row: it becomes the subject of its own official-site research
 * ('"Preferences" "Windhoek" contact') and burns the run's browser budget.
 * One predicate, applied where titles become candidate identities.
 */

/** Generic page-section / nav nouns — never an identity on their own. */
const FURNITURE_NAMES = new Set([
  "personal", "business", "enterprise", "corporate", "solutions", "overview",
  "home", "about", "contact", "services", "team", "gallery", "pricing", "blog",
  "menu", "shop", "store", "login", "subscribe", "search", "portfolio",
  "testimonials", "faq", "faqs", "news", "careers", "jobs", "support", "help",
  "privacy", "terms", "disclaimer", "cookies", "accessibility", "products",
  "clients", "partners", "projects", "insights", "resources", "industries",
  "company", "companies", "profile", "account", "settings", "dashboard",
  "categories", "tags", "archive", "featured", "sponsored", "advertisement",
  "downloads", "events", "locations", "brands", "stories", "press", "media",
  "investors", "suppliers", "reviews", "explore", "more", "details",
  "preferences", "accept", "residential", "commercial", "agricultural",
  "residents", "homeowners", "get started", "learn more", "read more",
]);

const NAV_PHRASES = new RegExp(
  "\b(?:click here|learn more|read more|view more|get (?:in touch|matched|started|a quote|quotes)|free quote(?:s)?|contact us|about us|our (?:team|services|work|story)|sign (?:in|up)|log ?in|subscribe|follow us|book (?:now|online)|key insights|related searches|similar (?:searches|services|businesses|profiles)|tag cloud|latest posts|recent posts|vendor spotlights|expert advice|privacy policy|terms of (?:service|use)|all rights reserved|skip to content|back to top|see more|show more|load more|leave a (?:comment|reply)|write a (?:review|comment)|request a (?:quote|callback)|find out more|discover more|get started today)\b",
  "i",
);

/** Metric/stat banners: "5,000 A&R Solar Projects Installed",
 *  "10+ Years of Experience", "98% Customer Satisfaction". */
const STAT_BANNER = /^\s*\d[\d.,]*\s*(?:\+|%|k\b|years?|projects?|customers?|clients?|installs?|installed|homes?|reviews?|satisfied|happy)/i;

export function isJunkEntityName(name: string): boolean {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return true;
  const letters = cleaned.replace(/[^a-zA-Z ]/g, "").trim();
  if (FURNITURE_NAMES.has(letters.toLowerCase())) return true;
  if (NAV_PHRASES.test(cleaned)) return true;
  if (STAT_BANNER.test(cleaned)) return true;
  return false;
}
