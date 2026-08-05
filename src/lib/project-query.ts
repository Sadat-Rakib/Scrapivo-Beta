// Compile a project's onboarding answers into the search query the user
// would otherwise have to type — the "zero typing" layer. The output is a
// plain-English signal the classifier already understands (hiring phrasing
// routes to job sources, need-phrasing to client-demand sources).
import { isAnywhereLocation, normalizeNiche } from "./project-context";

export type ProjectQueryInput = {
  service?: string | null;
  niche?: string | null;
  location?: string | null;
  goal?: "jobs" | "clients" | "both" | null;
};

export function buildProjectQuery(p: ProjectQueryInput): string {
  const svc = (p.service || "").trim();
  // "all" / "anyone" / "any niche" → no niche clause (search all categories).
  const niche = normalizeNiche(p.niche);
  const loc =
    p.location && !isAnywhereLocation(p.location) ? ` in ${p.location.trim()}` : "";
  if (!svc && !niche) return "";

  if (p.goal === "jobs") {
    // Hiring phrasing → job boards / ATS.
    return `currently hiring ${svc || niche}${svc && niche ? ` for ${niche}` : ""}${loc}`.trim();
  }
  // clients / both / unset → demand phrasing so social + marketplace buyers
  // surface first (not job-board listings).
  return `need a ${svc || niche}${svc && niche ? ` for ${niche}` : ""}${loc}`.trim();
}
