import { describe, expect, it } from "vitest";
import { extractEmployment, extractSearchSpec } from "../search-spec-extract";
import { jobRefinementQuestions } from "../clarifier";
import { runSpecSearchCore } from "@/lib/spec-search.functions";

/** Phase 3: jobs location/seniority/employment in the spec flow. */
describe("extractEmployment", () => {
  it("detects employment types and normalizes", () => {
    expect(extractEmployment("full time designer jobs")).toBe("full-time");
    expect(extractEmployment("part-time marketing roles")).toBe("part-time");
    expect(extractEmployment("contract engineers")).toBe("contract");
    expect(extractEmployment("remote senior designer jobs")).toBe("remote");
    expect(extractEmployment("frontend developer jobs")).toBeNull();
  });
});

describe("job spec extraction", () => {
  it("'remote senior frontend developer jobs in Berlin' extracts all slots, still ready", () => {
    const s = extractSearchSpec("remote senior frontend developer jobs in Berlin");
    expect(s.entity).toBe("job");
    expect(s.criteria).toContainEqual({ field: "role", value: "developer", stated: true, confidence: 1 });
    expect(s.criteria).toContainEqual({ field: "seniority", value: "senior", stated: true, confidence: 1 });
    expect(s.criteria).toContainEqual({ field: "employment", value: "remote", stated: true, confidence: 1 });
    expect(s.criteria).toContainEqual({ field: "location", value: "Berlin", stated: true, confidence: 1 });
    // Optional slots never block: role alone is still the only requirement.
    expect(s.missing).toEqual([]);
    expect(s.status).toBe("ready_to_search");
  });

  it("bare 'frontend developer jobs' stays ready with no invented slots", () => {
    const s = extractSearchSpec("frontend developer jobs");
    expect(s.entity).toBe("job");
    expect(s.missing).toEqual([]);
    const fields = s.criteria.map((c) => c.field);
    expect(fields).not.toContain("employment");
    expect(fields).not.toContain("location");
  });
});

describe("jobRefinementQuestions (thin-ask)", () => {
  it("asks only unstated slots", () => {
    const q = jobRefinementQuestions({ entity: "job", criteria: [] });
    expect(q.map((x) => x.id)).toEqual(["entity_location", "entity_seniority", "entity_employment"]);
    const partial = jobRefinementQuestions({
      entity: "job",
      criteria: [{ field: "location", value: "Berlin" }],
    });
    expect(partial.map((x) => x.id)).toEqual(["entity_seniority", "entity_employment"]);
  });

  it("non-job entities get nothing", () => {
    expect(jobRefinementQuestions({ entity: "company", criteria: [] })).toEqual([]);
  });
});

describe("thin job search offers refinements, rich search stays quiet", () => {
  const emptyJobs = (async () => ({
    jobs: [],
    fetched: 0,
    droppedSeeker: 0,
    sourceStatuses: [],
  })) as never;

  it("empty fleet → thin + refinement questions, no crash", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const res = await runSpecSearchCore("frontend developer jobs", { providerJobs: emptyJobs }, 25, {});
      expect(res.rows).toEqual([]);
      expect(res.liveDiscovery).toBe("db_thin_gapfill_pending");
      expect(res.clarify.map((q) => q.id)).toContain("entity_location");
      expect(res.clarify.map((q) => q.id)).toContain("entity_seniority");
      expect(res.clarify.map((q) => q.id)).toContain("entity_employment");
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });

  it("stated slots are not re-asked on thin", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const res = await runSpecSearchCore(
        "remote senior frontend developer jobs in Berlin",
        { providerJobs: emptyJobs },
        25,
        {},
      );
      expect(res.liveDiscovery).toBe("db_thin_gapfill_pending");
      expect(res.clarify).toEqual([]);
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });
});
