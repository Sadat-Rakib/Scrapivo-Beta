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
    description: raw.description?.slice(0, 1200) || null,
    salary: raw.salary || null,
    remote: Boolean(raw.remote),
    seniority: raw.seniority || null,
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

export async function fetchAllJobSourcesWithMeta(filters: JobSearchFilters): Promise<{
  jobs: JobPosting[];
  fetched: number;
}> {
  const wanted = new Set<string>(
    (filters.sources?.length ? filters.sources : ALL_JOB_SOURCE_IDS) as JobSourceId[],
  );
  const adapters = REGISTRY.filter((a) => adapterMatches(a, wanted));
  const chunks = await Promise.all(
    adapters.map(async (a) => {
      try {
        return await a.fetch(filters);
      } catch {
        return [] as RawJobPosting[];
      }
    }),
  );
  const raw = chunks.flat();
  const active = raw.filter(isActiveJob).map(normalizeJob);
  const deduped = dedupeJobs(active);
  return {
    fetched: deduped.length,
    jobs: deduped.filter((j) => matchesJobFilters(j, filters)),
  };
}
