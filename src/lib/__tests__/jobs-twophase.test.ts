/** Two-phase ATS gating battery: tenant scrapes run only when fast boards
 *  are thin; full fast pages never trigger ATS fan-out. Registry mocked. */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/jobs/registry", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/jobs/registry")>();
  return { ...orig, fetchAllJobSourcesWithMeta: vi.fn() };
});

vi.mock("@/lib/jobs/source-catalog", () => ({ ensureJobCatalogRegistered: vi.fn() }));
vi.mock("@/lib/jobs/freehire-source", () => ({ ensureFreehireSourceRegistered: vi.fn() }));

import { fetchAllJobSourcesWithMeta } from "@/lib/jobs/registry";
import { fetchSpecJobs } from "@/lib/search/jobs-provider";

const mocked = vi.mocked(fetchAllJobSourcesWithMeta);

const posting = (id: string) => ({
  id,
  title: `Frontend Developer ${id}`,
  company: `Acme ${id}`,
  location: "Remote",
  url: `https://jobs.example/${id}`,
  source: "source-remoteok" as const,
  board_id: "remoteok",
  posted_at: null,
  fetched_at: "2026-09-11T00:00:00.000Z",
  description: "React role",
  salary: null,
  remote: true,
  seniority: null,
});

beforeEach(() => {
  mocked.mockReset();
});

describe("two-phase ATS gating", () => {
  it("full fast page → ATS never runs (no fanout)", async () => {
    mocked.mockResolvedValueOnce({
      jobs: Array.from({ length: 10 }, (_, i) => posting(`f${i}`)),
      fetched: 10,
      sourceStatuses: [],
      relaxed: [],
    });
    const r = await fetchSpecJobs({ query: "frontend", limit: 10 });
    expect(r.jobs).toHaveLength(10);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked.mock.calls[0][0].sources).not.toContain("greenhouse");
  });

  it("thin fast page → ATS phase runs and merges (deduped)", async () => {
    mocked
      .mockResolvedValueOnce({ jobs: [posting("f1")], fetched: 1, sourceStatuses: [], relaxed: [] })
      .mockResolvedValueOnce({
        jobs: [posting("f1"), posting("a1")],
        fetched: 2,
        sourceStatuses: [],
        relaxed: [],
      });
    const r = await fetchSpecJobs({ query: "frontend", limit: 10 });
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls[1][0].sources).toContain("greenhouse");
    expect(r.jobs.map((j) => j.id).sort()).toEqual(["a1", "f1"]);
  });
});
