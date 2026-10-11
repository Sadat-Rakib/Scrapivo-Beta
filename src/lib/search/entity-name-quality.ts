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
import { resolveCanonicalLocation } from "@/lib/search/location-resolver";

/** Generic page-section / nav nouns — never an identity on their own. */
const FURNITURE_NAMES = new Set([
  "personal", "business", "enterprise", "corporate", "solutions", "overview",
  "platform", "platform overview",
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
  "students", "student", "faculty", "faculty and staff", "staff", "employees",
  "current employees", "current students", "alumni", "logins", "sign in",
  "my account", "our mission", "our story", "mission & values", "values",
]);

const NAV_PHRASES = new RegExp(
  "\\b(?:click here|learn more|read more|view more|get (?:in touch|matched|started|a quote|quotes)|free quote(?:s)?|contact us|about us|our (?:team|services|work|story)|sign (?:in|up)|log ?in|subscribe|follow us|book (?:now|online)|key insights|related searches|similar (?:searches|services|businesses|profiles)|tag cloud|latest posts|recent posts|vendor spotlights|expert advice|privacy policy|terms of (?:service|use)|all rights reserved|skip to content|back to top|see more|show more|load more|leave a (?:comment|reply)|write a (?:review|comment)|request a (?:quote|callback)|find out more|discover more|get started today)\\b",
  "i",
);

/** Metric/stat banners: "5,000 A&R Solar Projects Installed",
 *  "10+ Years of Experience", "98% Customer Satisfaction". */
const STAT_BANNER = /^\s*\d[\d.,]*\s*(?:\+|%|k\b|years?|projects?|customers?|clients?|installs?|installed|homes?|reviews?|satisfied|happy)/i;

/** Marketing slogan / CTA openers — a banner sentence's first words, never an
 *  identity ("Built for the Northwest", "Request Quote", "Expert Guidance"). */
const SLOGAN_OPENERS =
  /^(?:built|made|designed|crafted|proudly|proud|serving|served|trusted|dedicated|committed|focused|specializing|specialising|offering|providing|delivering|request|requests|ask|book|schedule|call|visit|explore|discover|join|follow|start|meet|welcome|get|need|find|expert|professional|premier|leading)\b/i;

/** Tagline fragments: participle clauses joined into a slogan
 *  ("Solar Gear, Stocked & Shipped."). */
const TAGLINE_CLAUSES = /\b\w+ed\b\s*(?:,|&|and)\s*\w+ed\b/i;

/** Form labels ("First Name*", "Email*") — UI fields, never an identity. */
const FORM_LABEL = /\*\s*$|^(?:first|last|full)\s+name$|^(?:your\s+)?(?:email|e-mail|phone|telephone|mobile|address|message|subject|name|comment)s?$/i;

/** Lead-gen / list-widget furniture observed on directory and data-broker
 *  pages ("59 companies tracked", "Try Revenue Base free",
 *  "VERIFIED EMAILS", "SMARTSEARCH · EXACT"). Decorative bullet marks are
 *  stripped before matching — they adorn UI chips, not identities. */
function isListWidgetFurniture(cleaned: string): boolean {
  const bare = cleaned.replace(/^[◉•●◆·*\s]+/, "").trim();
  return /^\d[\d.,]*\s+\w+ (?:tracked|listed|found|verified|companies|results?)\b/i.test(bare) ||
    /\b(?:try|get|start)\b.{0,24}\bfree\b/i.test(bare) ||
    /^verified (?:emails?|contacts?|leads?)\b/i.test(bare) ||
    /^(?:smart\s*search|search (?:now|free)|browse (?:all|by)|filter (?:by|results))\b/i.test(bare);
}

export function isJunkEntityName(name: string): boolean {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return true;
  // A trailing colon is a UI label ("Showhome hours:", "Listings:"), never a
  // name — real entity identities do not end in a colon.
  if (/:\s*$/.test(cleaned)) return true;
  const letters = cleaned.replace(/[^a-zA-Z ]/g, "").trim();
  if (FURNITURE_NAMES.has(letters.toLowerCase())) return true;
  if (NAV_PHRASES.test(cleaned)) return true;
  if (STAT_BANNER.test(cleaned)) return true;
  if (SLOGAN_OPENERS.test(cleaned)) return true;
  if (TAGLINE_CLAUSES.test(cleaned)) return true;
  if (FORM_LABEL.test(cleaned)) return true;
  if (isListWidgetFurniture(cleaned)) return true;
  // A name that is exactly a known place ("Gobabis", "Keetmanshoop") is a
  // locality heading from a regional directory, not a business.
  if (isKnownPlaceName(cleaned)) return true;
  return false;
}

/** A name that is exactly a known place ("Gobabis", "Keetmanshoop") is a
 *  locality heading from a regional directory, not a business. */
function isKnownPlaceName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length > 2) return false;
  try {
    const geo = resolveCanonicalLocation(name);
    return !!geo && (geo.kind === "metro" || geo.kind === "city" || geo.kind === "country");
  } catch {
    return false;
  }
}
