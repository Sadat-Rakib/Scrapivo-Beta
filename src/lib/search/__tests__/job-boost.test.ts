import { describe, expect, it } from "vitest";
import { applyJobDiscoveryBoost } from "../lead-segments";
import type { Lead } from "../../scoring";

const lead = (over: Partial<Lead> = {}): Lead =>
  ({
    source: "searxng",
    platform: "Web Search",
    title: "t",
    snippet: "s",
    full_post_url: "https://example.com/1",
    score: 50,
    ...over,
  }) as Lead;

describe("applyJobDiscoveryBoost", () => {
  it("boosts job-native sources", () => {
    const [out] = applyJobDiscoveryBoost([
      { lead: lead({ source: "greenhouse", score: 50 }), text: "x" },
    ]);
    expect(out.score).toBe(62);
    expect(out.match_reasons).toContain("Job-board posting");
  });
  it("demotes non-job-shaped generic web rows", () => {
    const [out] = applyJobDiscoveryBoost([
      { lead: lead({ source: "reddit", score: 50 }), text: "best crm tools compared" },
    ]);
    expect(out.score).toBe(38);
  });
  it("leaves job-shaped web rows alone", () => {
    const [out] = applyJobDiscoveryBoost([
      { lead: lead({ source: "reddit", score: 50 }), text: "we are hiring engineers" },
    ]);
    expect(out.score).toBe(50);
  });
});
