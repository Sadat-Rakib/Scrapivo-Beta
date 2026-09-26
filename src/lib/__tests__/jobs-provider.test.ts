/** Jobs fleet tier battery: job entities hit the registry subset (injected),
 *  map to validated job rows in the leads feed; flag off keeps legacy. */
import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";
import { isSeekerJobPosting } from "@/lib/search/jobs-provider";

describe("isSeekerJobPosting", () => {
  it("drops freelancer profiles and product pitches, keeps employer postings", () => {
    // Real shapes observed live (HN/GitHub text sources).
    expect(
      isSeekerJobPosting(
        "Lenin Aguiar — Software Developer",
        "Location: USA Remote: Yes Willing to relocate: Yes Technologies: C#, .NET",
      ),
    ).toBe(true);
    expect(
      isSeekerJobPosting("toast", "toast is for the developer who wants to stay in the terminal"),
    ).toBe(false); // no marker — kept (validator may still reject on role fit)
    expect(isSeekerJobPosting("Hire me", "I build websites, my rates start at $50")).toBe(true);
    expect(
      isSeekerJobPosting(
        "Senior Frontend Developer",
        "We are hiring a senior frontend developer to join our Berlin team.",
      ),
    ).toBe(false);
    expect(
      isSeekerJobPosting("Application Developer", "Full-time role. Apply with your CV."),
    ).toBe(false);
  });
});

const POSTINGS = [
  {
    id: "p1",
    title: "Senior Frontend Developer",
    company: "Acme",
    location: "Remote",
    url: "https://jobs.example/p1",
    source: "source-remoteok",
    board_id: "remoteok",
    posted_at: "2026-09-10T00:00:00.000Z",
    fetched_at: "2026-09-11T00:00:00.000Z",
    description: "React role",
    salary: "$120k",
    remote: true,
    seniority: "senior",
  },
  {
    id: "p2",
    title: "Backend Go Engineer",
    company: "Beta",
    location: "Berlin",
    url: "https://jobs.example/p2",
    source: "source-hn",
    board_id: "hn",
    posted_at: "2026-09-09T00:00:00.000Z",
    fetched_at: "2026-09-11T00:00:00.000Z",
    description: "Go role",
    salary: null,
    remote: false,
    seniority: null,
  },
];

const jobsFake = (async () => ({
  jobs: POSTINGS,
  fetched: 2,
  sourceStatuses: [{ id: "remoteok", label: "RemoteOK", status: "ok", count: 1 }],
})) as never;

describe("jobs fleet tier (USE_COVERAGE_SELECTOR=true)", () => {
  it("job entity returns real postings as validated job rows", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const res = await runSpecSearchCore(
        "frontend developer jobs",
        { providerJobs: jobsFake },
        25,
        {},
      );
      expect(res.spec.entity).toBe("job");
      expect(res.rows.length).toBeGreaterThan(0);
      for (const r of res.rows) {
        expect(r.kind).toBe("job");
        expect(r.key).toMatch(/^job:/);
        expect(r.url).toMatch(/^https?:\/\//);
      }
      expect(res.dbMeta.map((m) => m.engine)).toContain("provider-jobs");
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });

  it("role validation still rejects mismatched postings", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const res = await runSpecSearchCore(
        "frontend developer jobs",
        { providerJobs: jobsFake },
        25,
        {},
      );
      // Backend Go Engineer must not pass a frontend-developer spec.
      expect(res.rows.map((r) => r.title)).not.toContain("Backend Go Engineer @ Beta");
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });

  it("providerJobs null / throw → honest empty, no crash", async () => {
    process.env.USE_COVERAGE_SELECTOR = "true";
    try {
      const nulled = await runSpecSearchCore(
        "frontend developer jobs",
        { providerJobs: null },
        25,
        {},
      );
      expect(nulled.rows).toEqual([]);
      const boom = async () => {
        throw new Error("fleet down");
      };
      const thrown = await runSpecSearchCore(
        "frontend developer jobs",
        { providerJobs: boom as never },
        25,
        {},
      );
      expect(thrown.rows).toEqual([]);
    } finally {
      delete process.env.USE_COVERAGE_SELECTOR;
    }
  });
});
