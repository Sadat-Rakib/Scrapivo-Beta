import { beforeEach, describe, expect, it, vi } from "vitest";

// NOTE: fresh module registry per test FILE (vitest isolate default), so
// doMock here applies cleanly — never statically import discover.server
// in this file or the real SearXNG module loads first.
const LUKE_RESULTS = [
  {
    url: "https://social.example/p/1",
    title: "Luke Bayliss is looking for a freelance web specialist",
    content: "Looking for a freelance web specialist for a government client",
    publishedDate: new Date(Date.now() - 12 * 3_600_000).toISOString(),
  },
  {
    url: "https://food.example/p/9",
    title: "Best pizza near me",
    content: "unrelated dinner post",
    publishedDate: new Date().toISOString(),
  },
];

const HIRING_RESULTS = [
  {
    url: "https://social.example/p/1",
    title: "Acme Corp: hiring a frontend developer for our new website",
    content: "Acme Corp is hiring a frontend developer for our new website launch",
    publishedDate: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  },
];

describe("Step 4.2 discovery composition (mocked sources)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("queries capped, hits matched to candidate, caps honored", async () => {
    const calls: string[][] = [];
    vi.doMock("@/lib/search/searxng.server", () => ({
      searchSearxng: async (qs: string[]) => {
        calls.push(qs);
        return LUKE_RESULTS;
      },
    }));
    const { discoverCandidateEvidence } = await import("../discover.server");
    const { templateStrategy: tpl } = await import("../strategy");
    const hits = await discoverCandidateEvidence(
      { key: "k1", name: "Luke Bayliss", company: "Creative Natives", city: "Melbourne" },
      tpl("web design", "person"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].length).toBeLessThanOrEqual(3);
    // Pizza post dropped (no candidate match); Luke hit kept with tier.
    expect(hits).toHaveLength(1);
    expect(hits[0].tier).toBe("explicit_request");
    expect(hits[0].url).toBe("https://social.example/p/1");
  });

  it("full loop: strategy -> discover -> verify -> rank (Luke-style case)", async () => {
    vi.doMock("@/lib/search/searxng.server", () => ({
      searchSearxng: async () => HIRING_RESULTS,
    }));
    const { discoverCandidateEvidence } = await import("../discover.server");
    const { templateStrategy: tpl } = await import("../strategy");
    const { verifyHit } = await import("../verify.server");
    const { rankEvidence } = await import("../rank");
    const strategy = tpl("web development", "company");
    const hits = await discoverCandidateEvidence(
      { key: "c1", name: "Acme Corp", company: "Acme Corp", city: "Austin" },
      strategy,
    );
    expect(hits).toHaveLength(1);
    const buyer = async () => ({
      hit: {
        intent: "hiring" as const,
        confidence: 0.95,
        evidence: "hiring a frontend developer",
        role_in_post: "buyer" as const,
      },
    });
    const ev = await verifyHit(hits[0], "web development", "c1", buyer);
    expect(ev).not.toBeNull();
    const ranked = rankEvidence({ score: 80 }, "c1", ev!);
    expect(ranked.quality).toBeGreaterThan(0.5);
  });
});
