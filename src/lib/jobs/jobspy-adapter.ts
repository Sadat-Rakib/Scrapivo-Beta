/**
 * Optional JobSpy adapter (Phase D).
 *
 * JobSpy / jobseek are NOT vendored. When JOBSPY_API_URL is set, we GET a
 * search and map public results into JobPosting shape. Without the env var
 * this module is a no-op — FreeHire + remote boards remain primary.
 *
 * Never uses session cookies. Public/API responses only.
 */
import type { JobPosting } from "./types";

export type JobSpySearchOpts = {
  query: string;
  location?: string;
  limit?: number;
};

/**
 * Fetch from an optional self-hosted JobSpy API.
 * Returns [] when JOBSPY_API_URL is unset or the call fails.
 */
export async function fetchJobSpyJobs(opts: JobSpySearchOpts): Promise<JobPosting[]> {
  const base = (process.env.JOBSPY_API_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return [];
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const now = new Date().toISOString();
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", opts.query);
    if (opts.location) url.searchParams.set("location", opts.location);
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      jobs?: Array<{
        id?: string;
        title?: string;
        company?: string;
        location?: string;
        url?: string;
        description?: string;
        date_posted?: string;
        job_type?: string;
        is_remote?: boolean;
      }>;
    };
    const jobs = data.jobs ?? [];
    return jobs
      .filter((j) => j.title && j.company && j.url)
      .slice(0, limit)
      .map((j, i) => ({
        id: j.id ?? `jobspy-${i}`,
        board_id: "jobspy",
        source: "source-remoteok" as const,
        title: j.title!,
        company: j.company!,
        location: j.location ?? null,
        url: j.url!,
        employment_type: j.job_type ?? null,
        remote: !!j.is_remote,
        salary: null,
        seniority: null,
        posted_at: j.date_posted ?? null,
        fetched_at: now,
        contacts: [],
        description: j.description ?? null,
      }));
  } catch {
    return [];
  }
}
