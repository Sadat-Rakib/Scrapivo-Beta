/**
 * Jobs provider tier for spec-first search (fleet integration).
 *
 * Reuses the existing jobs subsystem (registry fan-out, per-source failure
 * isolation, ranking, hygiene) — this module only BOUNDS it for the spec
 * path: keyless board sources + the FreeHire API, never the per-tenant ATS
 * scrapes (those stay on the Jobs page behind quota + rate limits).
 * The 200-file freehire/sources catalogue and the vendored Go harvester
 * are untouched; the TS adapters already registered in the catalog are
 * what runs here.
 */
import type { JobPosting, JobSourceId } from "@/lib/jobs/types";
import { makeEvidence } from "@/lib/search/evidence";
import { isSeekerPhrasing } from "@/lib/search/lead-segments";
import type { SpecRow } from "@/lib/spec-search.functions";

/** Keyless, fast board sources + the FreeHire API. No tenant scraping.
 *  "hn" is back in: the registry adapter now consumes the hiring-thread-only
 *  split (live-proven seeker/pitch pollution came from the broad sweeps). */
export const SPEC_JOB_SOURCES: JobSourceId[] = [
  "freehire",
  "remoteok",
  "remotive",
  "jobicy",
  "weworkremotely",
  "arbeitnow",
  "workingnomads",
  "usajobs",
  "themuse",
  "githubjobs",
  "hn",
  "workatastartup",
  "himalayas",
  "internshala",
  "4dayweek",
  "nodesk",
];

/**
 * Phase-2 ATS platforms (tenant-board scrapes). Included ONLY when the fast
 * phase is thin — each adapter fans out across dozens of company boards, so
 * unconditional inclusion would turn every job query into hundreds of HTTP
 * calls. The adapters self-bound (board caps, 18s shared budget, batched +
 * staggered requests); this tier adds the sequential gate on top.
 */
export const SPEC_JOB_ATS_SOURCES: JobSourceId[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "workday",
];

export interface SpecJobsResult {
  jobs: JobPosting[];
  fetched: number;
  droppedSeeker: number;
  sourceStatuses: Array<{ id: string; label: string; status: "ok" | "error"; count: number }>;
}

/** Convert a structured posting into a theorem-ready, traceable job row. */
export function jobPostingToSpecRow(posting: JobPosting, prefix = "job"): SpecRow {
  const entityId = `${prefix}:${posting.board_id}:${posting.id}`;
  const details = [
    posting.location,
    posting.employment_type,
    posting.remote ? "Remote" : null,
    posting.salary,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    kind: "job",
    key: entityId,
    entity_id: entityId,
    entity_resolved: true,
    page_type: "job_posting",
    identity_confidence: 0.92,
    resolution_method: "structured_job_provider",
    title: `${posting.title} @ ${posting.company}`,
    detail: details.join(" · "),
    employer: posting.company,
    salary: posting.salary,
    email: posting.contacts?.[0]?.email ?? null,
    phone: null,
    url: posting.url,
    location: posting.location,
    country: /\bCanada\b|\b(?:ON|AB|QC|BC|MB|NB|NS|NL|PE|SK|YT|NT|NU),\s*CA\b/i.test(posting.location ?? "") ? "CA" : null,
    why_match: `Current structured posting on ${posting.board_id}`,
    evidence: [
      makeEvidence({
        source_url: posting.url,
        source_type: "job",
        excerpt: `${posting.title} at ${posting.company}`,
        evidence_type: "hiring",
        supports: "intent",
        subject: entityId,
        event_at: posting.posted_at,
        observed_at: posting.fetched_at,
        extraction_method: "structured_job_provider",
        confidence: 0.9,
      }),
    ],
  };
}

/**
 * Seeker-post filter: HN/GitHub text sources mix employer postings with
 * freelancer profiles ("Willing to relocate", "my rates") and product
 * pitches ("Show HN, we built…"). Those are PEOPLE, not openings — drop them
 * here so the jobs tier only serves employer postings. Pure posting boards
 * pass through untouched. Counts are reported, never silent.
 */
const PROFILE_PITCH_RE =
  /\b(willing to relocate|seeking (freelanc\w*|work|gigs?|contracts?)|show hn\b|we (built|launched)|introducing (our|my)|check out (my|our) (gig|work|product|app)|my rates|technologies:\s*[a-z#., ]{3,80}$)/i;

export function isSeekerJobPosting(title: string, description: string | null): boolean {
  const text = `${title ?? ""}\n${description ?? ""}`;
  return isSeekerPhrasing(text) || PROFILE_PITCH_RE.test(text);
}

export async function fetchSpecJobs(args: {
  query: string;
  location?: string;
  limit: number;
  /** Optional post-filters (Phase 3): matched leniently, never throw. */
  seniority?: string;
  employment?: string;
}): Promise<SpecJobsResult> {
  // The catalog + registry pull the ATS adapter chain -> http-fetch.server ->
  // node:child_process and registry -> node:crypto. Load them dynamically so a
  // client-reachable importer never drags those into the browser bundle.
  const [{ ensureJobCatalogRegistered }, { ensureFreehireSourceRegistered }, registry] = await Promise.all([
    import("@/lib/jobs/source-catalog"),
    import("@/lib/jobs/freehire-source"),
    import("@/lib/jobs/registry"),
  ]);
  const { dedupeJobs, fetchAllJobSourcesWithMeta } = registry;
  ensureJobCatalogRegistered();
  const statuses: SpecJobsResult["sourceStatuses"] = [];
  let fetched = 0;
  const phase1 = await fetchAllJobSourcesWithMeta({
    query: args.query,
    location: args.location,
    sources: SPEC_JOB_SOURCES,
    limit: args.limit,
  });
  statuses.push(...phase1.sourceStatuses);
  fetched += phase1.fetched;
  const matchesFilters = (j: JobPosting): boolean => {
    const hay = `${j.title ?? ""} ${j.description ?? ""} ${j.seniority ?? ""} ${j.employment_type ?? ""} ${j.remote ? "remote" : ""}`;
    if (args.seniority && !hay.toLowerCase().includes(args.seniority.toLowerCase())) return false;
    if (args.employment) {
      const want = args.employment.toLowerCase();
      if (want === "remote") {
        if (!j.remote && !hay.toLowerCase().includes("remote")) return false;
      } else if (!hay.toLowerCase().includes(want)) {
        return false;
      }
    }
    return true;
  };
  let kept = phase1.jobs.filter((j) => !isSeekerJobPosting(j.title, j.description));
  kept = kept.filter(matchesFilters);
  let droppedSeeker = phase1.jobs.length - kept.length;
  // Phase 2 (bounded): ATS tenant scrapes run ONLY when the fast boards are
  // thin — cheapest-first ordering applied to providers, same as retrieval
  // tiers. Skipped entirely when phase 1 already fills the page.
  if (kept.length < args.limit) {
    const phase2 = await fetchAllJobSourcesWithMeta({
      query: args.query,
      location: args.location,
      sources: SPEC_JOB_ATS_SOURCES,
      limit: args.limit,
    });
    statuses.push(...phase2.sourceStatuses);
    fetched += phase2.fetched;
    for (const j of phase2.jobs) {
      if (isSeekerJobPosting(j.title, j.description)) {
        droppedSeeker++;
        continue;
      }
      if (!matchesFilters(j)) continue;
      kept.push(j);
    }
  }
  // Cross-phase dedupe (FreeHire aggregates ATS career pages, so phases can
  // overlap): the registry's own key, applied to the merged set.
  const deduped = dedupeJobs(kept);
  return { jobs: deduped.slice(0, args.limit), fetched, droppedSeeker, sourceStatuses: statuses };
}
