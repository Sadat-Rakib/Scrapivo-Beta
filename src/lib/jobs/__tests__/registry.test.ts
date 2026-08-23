/**
 * PRD §10 — jobs pipeline: normalized-model field preservation, dedup
 * rules, adapter selection, and independent per-source failure handling.
 */
import { describe, expect, it } from "vitest";
import {
  dedupeJobs,
  fetchAllJobSourcesWithMeta,
  normalizeJob,
  registerJobSource,
} from "../registry";
import type { JobPosting, JobSourceKind, RawJobPosting } from "../types";

const raw = (over: Partial<RawJobPosting> = {}): RawJobPosting => ({
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  source: "source-ats-greenhouse",
  board_id: "acme",
  posted_at: new Date().toISOString(),
  description: "Build things.",
  salary: "$150K - $200K",
  remote: true,
  seniority: "senior",
  department: "Engineering",
  employment_type: "Full-time",
  ...over,
});

describe("normalizeJob (field preservation)", () => {
  it("carries every populated field into the normalized model", () => {
    const r = raw();
    const j = normalizeJob(r);
    expect(j.title).toBe("Senior Engineer");
    expect(j.company).toBe("Acme");
    expect(j.location).toBe("Remote");
    expect(j.url).toBe(r.url);
    expect(j.source).toBe(r.source);
    expect(j.board_id).toBe("acme");
    expect(j.posted_at).toBe(r.posted_at);
    expect(j.description).toBe("Build things.");
    expect(j.salary).toBe("$150K - $200K");
    expect(j.remote).toBe(true);
    expect(j.seniority).toBe("senior");
    expect(j.department).toBe("Engineering");
    expect(j.employment_type).toBe("Full-time");
    expect(j.fetched_at).toBeTruthy();
    expect(j.id).toBeTruthy();
  });

  it("produces a stable id from source + apply URL", () => {
    expect(normalizeJob(raw()).id).toBe(normalizeJob(raw()).id);
    expect(normalizeJob(raw({ url: "https://x/2" })).id).not.toBe(normalizeJob(raw()).id);
  });
});

describe("dedupeJobs", () => {
  it("dedupes identical source + URL", () => {
    const jobs = [normalizeJob(raw()), normalizeJob(raw())];
    expect(dedupeJobs(jobs)).toHaveLength(1);
  });

  it("dedupes same company + normalized title + location across URLs", () => {
    const a = normalizeJob(raw({ url: "https://boards.greenhouse.io/acme/jobs/1" }));
    const b = normalizeJob(raw({ url: "https://acme.com/careers/1" }));
    expect(dedupeJobs([a, b])).toHaveLength(1);
    // ATS URL is preferred over the aggregator URL
    expect(dedupeJobs([b, a])[0].url).toContain("greenhouse.io");
  });

  it("keeps distinct jobs (different title/location/company)", () => {
    const jobs = [
      normalizeJob(raw()),
      normalizeJob(
        raw({ title: "Staff Engineer", url: "https://boards.greenhouse.io/acme/jobs/2" }),
      ),
      normalizeJob(raw({ company: "Globex", url: "https://boards.greenhouse.io/globex/jobs/9" })),
    ];
    expect(dedupeJobs(jobs)).toHaveLength(3);
  });
});

describe("fetchAllJobSourcesWithMeta (independent failures + selection)", () => {
  const KIND_A = "source-remoteok" as JobSourceKind;
  const KIND_B = "source-remotive" as JobSourceKind;

  it("a failing source never erases another source's jobs and reports status", async () => {
    registerJobSource({
      id: KIND_A,
      label: "TestA",
      fetch: async () => [raw({ source: KIND_A, url: "https://remoteok.com/l/1" })],
    });
    registerJobSource({
      id: KIND_B,
      label: "TestB",
      fetch: async () => {
        throw new Error("upstream 503");
      },
    });

    const { jobs, sourceStatuses } = await fetchAllJobSourcesWithMeta({
      sources: ["remoteok", "remotive"],
    });

    expect(jobs.length).toBeGreaterThanOrEqual(1);
    const a = sourceStatuses.find((s) => s.id === KIND_A);
    const b = sourceStatuses.find((s) => s.id === KIND_B);
    expect(a?.status).toBe("ok");
    expect(a?.count).toBe(1);
    expect(b?.status).toBe("error");
    expect(b?.error).toContain("upstream 503");
    expect(b?.count).toBe(0);
  });

  it("the sources filter selects which adapters run", async () => {
    const { jobs, sourceStatuses } = await fetchAllJobSourcesWithMeta({
      sources: ["remoteok"],
    });
    expect(sourceStatuses.map((s) => s.id)).toEqual([KIND_A]);
    for (const j of jobs as JobPosting[]) expect(j.source).toBe(KIND_A);
  });
});
