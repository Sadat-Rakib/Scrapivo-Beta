import { describe, expect, it } from "vitest";
import { buildWhyRelevant, rankRelevance, relevanceFor } from "../relevance";
import type { LeadSignal } from "../types";

const sig = (over: Partial<LeadSignal> = {}): LeadSignal => ({
  signal_id: "s1",
  entity_id: "e1",
  signal_type: "service_request",
  topic: "website_development",
  text_summary: "CEO posted that the company is rebuilding its website.",
  platform: "linkedin",
  source_url: "https://linkedin.com/posts/abc",
  published_at: "2026-09-01",
  discovered_at: "2026-09-08",
  recency_days: 7,
  confidence: 0.9,
  evidence: ["post text"],
  method: "searxng",
  state: "verified",
  entity_match_method: "exact_profile_url",
  entity_match_confidence: 0.95,
  matched_entity_id: "e1",
  ...over,
});

describe("relevance (Phases 7-9)", () => {
  it("ranks matched criteria deterministically", () => {
    expect(rankRelevance({ matchedCriteria: ["role", "location"], qualityScore: 100 })).toBe(60);
  });
  it("grounds why_relevant in facts + verified signal", () => {
    const w = buildWhyRelevant({
      leadLabel: "ABC Plumbing",
      matchedCriteria: ["based in Austin"],
      signals: [sig()],
    });
    expect(w).toContain("Austin");
    expect(w).toContain("https://linkedin.com/posts/abc");
    expect(w).toContain("2026-09-01");
  });
  it("stays silent on thin evidence", () => {
    expect(buildWhyRelevant({ leadLabel: "X", matchedCriteria: [] })).toBe("");
  });
  it("ignores unverified signals", () => {
    const w = buildWhyRelevant({
      leadLabel: "X",
      matchedCriteria: ["based in Austin"],
      signals: [sig({ state: "candidate" })],
    });
    expect(w).not.toContain("linkedin.com");
  });
  it("caps score when signal required but none verified", () => {
    expect(
      rankRelevance({ matchedCriteria: ["a", "b", "c"], qualityScore: 100, signalRequired: true, signals: [] }),
    ).toBeLessThanOrEqual(30);
  });
  it("relevanceFor bundles score + criteria + explanation", () => {
    const r = relevanceFor("ABC Plumbing", { matchedCriteria: ["based in Austin"], signals: [sig()] });
    expect(r.relevance_score).toBeGreaterThan(0);
    expect(r.why_relevant).toContain("ABC Plumbing");
  });
});
