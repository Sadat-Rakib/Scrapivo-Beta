/**
 * SearchQueryPlanner (Part 7) — Boolean/structured discovery variants.
 *
 * Search engines are DISCOVERY; the browser is RESEARCH. These variants give
 * free web search structured shapes (exact phrases, site-scoped public
 * signals) instead of re-pasting the user's sentence. Only publicly indexed
 * results are used — never private groups or login walls.
 */
import type { SearchSpec } from "./search-spec";

/** "term" — exact phrase operator. */
export const quote = (term: string): string => `"${term.replace(/"/g, "").trim()}"`;
/** site:domain — scope a query to a publicly indexable source. */
export const site = (domain: string): string => `site:${domain}`;
/** (a OR b) — Boolean any-of. */
export const anyOf = (terms: string[]): string =>
  `(${terms.filter(Boolean).map(quote).join(" OR ")})`;

function fieldOf(spec: SearchSpec, f: string): string | null {
  return spec.criteria.find((c) => c.field === f)?.value?.trim() || null;
}

const JOB_ROLE_ALIASES: Record<string, string[]> = {
  frontend: ["frontend developer", "front-end developer", "frontend engineer"],
  "front end": ["frontend developer", "front-end developer"],
  react: ["react developer", "react engineer", "frontend developer"],
  "react native": ["react native developer"],
  backend: ["backend developer", "back-end developer"],
  fullstack: ["full stack developer", "full-stack engineer"],
  ml: ["machine learning engineer"],
};

/**
 * 2-4 extra discovery variants per entity/mode. Callers merge + cap — these
 * are ADDITIONS to the entity's base discovery templates, never replacements.
 */
export function planDiscoveryVariants(spec: SearchSpec): string[] {
  const location = fieldOf(spec, "location");
  const industry = fieldOf(spec, "industry") ?? fieldOf(spec, "category");
  const role = fieldOf(spec, "role");
  const sector = fieldOf(spec, "investor_sector") ?? industry;
  const stage = fieldOf(spec, "investor_stage");
  const requestedService = fieldOf(spec, "requested_service") ?? fieldOf(spec, "requested_role");
  const variants: string[] = [];

  if (spec.entity === "person" && role && industry) {
    variants.push(`${quote(`${industry} ${role}`)}${location ? ` ${location}` : ""}`);
    variants.push(`${quote(`${industry} co-founder`)}${location ? ` ${location}` : ""}`);
  }
  if (spec.entity === "investor" && sector) {
    variants.push(`${quote(`${sector} investor`)}${stage ? ` ${quote(stage)}` : ""}`);
    variants.push(`${site("linkedin.com/in")} investor ${sector}`);
    variants.push(`${quote(sector)} portfolio ${stage ?? ""}`.trim());
  }
  if (spec.entity === "job") {
    const rawRole = (role ?? fieldOf(spec, "requested_role") ?? "").toLowerCase();
    const aliases = Object.entries(JOB_ROLE_ALIASES).find(([key]) => rawRole.includes(key))?.[1] ?? [];
    for (const alias of aliases.slice(0, 2)) {
      variants.push(`${quote(alias)}${/remote/i.test(spec.raw_query) ? " remote" : location ? ` ${location}` : ""}`);
    }
    variants.push(`${site("greenhouse.io")} ${role ?? ""} remote`.trim());
  }
  // Signal/intent hunts: publicly indexed asks, never private groups.
  if (requestedService && (spec.signal_required || /recently|posted|looking for|complain/i.test(spec.raw_query))) {
    variants.push(`${site("reddit.com")} ${quote("looking for")} ${requestedService}`);
    variants.push(`${site("linkedin.com/posts")} ${quote("looking for")} ${requestedService}`);
    variants.push(`${quote("need help with")} ${requestedService}`);
  }
  return variants.filter(Boolean).slice(0, 4);
}
