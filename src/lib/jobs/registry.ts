import { createHash } from "node:crypto";
import type {
  JobPosting,
  JobSearchFilters,
  JobSourceId,
  JobSourceKind,
  RawJobPosting,
} from "./types";
import { ALL_JOB_SOURCE_IDS } from "./types";
import { matchesJobFilters } from "./filters";
import { isActiveJob, preferAtsUrl, recencyRank, secondaryDedupeKey } from "./hygiene";

export type JobSourceAdapter = {
  id: JobSourceKind;
  label: string;
  fetch: (filters: JobSearchFilters) => Promise<RawJobPosting[]>;
};

export function jobDedupeId(source: string, url: string): string {
  return createHash("sha1").update(`${source}|${url}`).digest("hex");
}

export function normalizeJob(raw: RawJobPosting): JobPosting {
  return {
    id: jobDedupeId(raw.source, raw.url),
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: raw.location?.trim() || null,
    url: raw.url,
    source: raw.source,
    board_id: raw.board_id,
    posted_at: raw.posted_at || null,
    updated_at: raw.updated_at || null,
    fetched_at: new Date().toISOString(),
    description: raw.description?.slice(0, 1200) || null,
    salary: raw.salary || null,
    remote: Boolean(raw.remote),
    seniority: raw.seniority || null,
    department: raw.department || null,
    employment_type: raw.employment_type || null,
  };
}

export function dedupeJobs(jobs: JobPosting[]): JobPosting[] {
  const byUrl = new Map<string, JobPosting>();
  for (const j of jobs) {
    const prev = byUrl.get(j.id);
    byUrl.set(j.id, prev ? preferAtsUrl(prev, j) : j);
  }
  const byKey = new Map<string, JobPosting>();
  for (const j of byUrl.values()) {
    const k = secondaryDedupeKey(j);
    const prev = byKey.get(k);
    byKey.set(k, prev ? preferAtsUrl(prev, j) : j);
  }
  return [...byKey.values()].sort((a, b) => recencyRank(b.posted_at) - recencyRank(a.posted_at));
}

export { matchesJobFilters };

const REGISTRY: JobSourceAdapter[] = [];

export function registerJobSource(adapter: JobSourceAdapter): void {
  const i = REGISTRY.findIndex((a) => a.id === adapter.id);
  if (i >= 0) REGISTRY[i] = adapter;
  else REGISTRY.push(adapter);
}

export function listJobSources(): JobSourceAdapter[] {
  return [...REGISTRY];
}

function adapterMatches(a: JobSourceAdapter, wanted: Set<string>): boolean {
  const id = a.id.replace(/^source-ats-/, "").replace(/^source-/, "");
  return wanted.has(id);
}

export async function fetchAllJobSources(filters: JobSearchFilters): Promise<JobPosting[]> {
  const wanted = new Set<string>(
    (filters.sources?.length ? filters.sources : ALL_JOB_SOURCE_IDS) as JobSourceId[],
  );
  const adapters = REGISTRY.filter((a) => adapterMatches(a, wanted));

  const chunks = await Promise.all(
    adapters.map(async (a) => {
      try {
        return await a.fetch(filters);
      } catch (e) {
        console.warn(`[jobs] ${a.id} failed`, e);
        return [] as RawJobPosting[];
      }
    }),
  );

  const active = chunks.flat().filter(isActiveJob).map(normalizeJob);
  const deduped = dedupeJobs(active);
  return deduped.filter((j) => matchesJobFilters(j, filters));
}

/** Per-source fetch outcome — a failed source never erases other sources'
 *  jobs, and its status/error is reported to the UI (PRD §10). */
export interface JobSourceStatus {
  id: string;
  label: string;
  status: "ok" | "error";
  /** Raw job count returned by this source on this fetch. */
  count: number;
  error?: string;
  fetchedAt: number;
}

export async function fetchAllJobSourcesWithMeta(filters: JobSearchFilters): Promise<{
  jobs: JobPosting[];
  fetched: number;
  sourceStatuses: JobSourceStatus[];
}> {
  const wanted = new Set<string>(
    (filters.sources?.length ? filters.sources : ALL_JOB_SOURCE_IDS) as JobSourceId[],
  );
  const adapters = REGISTRY.filter((a) => adapterMatches(a, wanted));
  const results = await Promise.all(
    adapters.map(async (a) => {
      const fetchedAt = Date.now();
      try {
        const raw = await a.fetch(filters);
        return { adapter: a, raw, fetchedAt, error: undefined as string | undefined };
      } catch (e) {
        console.warn(`[jobs] ${a.id} failed`, e);
        return {
          adapter: a,
          raw: [] as RawJobPosting[],
          fetchedAt,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  const sourceStatuses: JobSourceStatus[] = results.map((r) => ({
    id: r.adapter.id,
    label: r.adapter.label,
    status: r.error ? "error" : "ok",
    count: r.raw.length,
    ...(r.error ? { error: r.error } : {}),
    fetchedAt: r.fetchedAt,
  }));
  const raw = results.flatMap((r) => r.raw);
  const active = raw.filter(isActiveJob).map(normalizeJob);
  const deduped = dedupeJobs(active);
  return {
    fetched: deduped.length,
    jobs: deduped.filter((j) => matchesJobFilters(j, filters)),
    sourceStatuses,
  };
}
