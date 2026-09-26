import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  templateStrategy,
  buildIntentStrategy,
  TIER_STRENGTH,
} from "../strategy";
import { verifyHit } from "../verify.server";
import { rankEvidence, sortRanked, fitOf } from "../rank";
import { recencyScore, type EvidenceHit } from "../evidence";

const hit = (over: Partial<EvidenceHit> = {}): EvidenceHit => ({
  tier: "explicit_request",
  strength: TIER_STRENGTH.explicit_request,
  phrase: "looking for web design",
  source: "web",
  url: "https://example.com/post/1",
  title: "Looking for a freelance web specialist",
  excerpt: "Looking for a freelance web specialist for a government client",
  publishedAt: new Date(Date.now() - 12 * 3_600_000).toISOString(),
  ...over,
});

describe("Step 4.1 strategy", () => {
  it("template covers all tiers with offer phrases, no LLM needed", () => {
    const s = templateStrategy("web design", "person");
    expect(s.llmRefined).toBe(false);
    expect(s.signals.map((x) => x.type)).toEqual([
      "explicit_request",
      "evaluation",
      "problem",
      "trigger",
    ]);
    expect(s.signals[0].phrases.join(" ")).toMatch(/looking for web design/);
  });

  it("empty offer never touches the LLM", async () => {
    const s = await buildIntentStrategy("", "person");
    expect(s.llmRefined).toBe(false);
  });
});

describe("Step 4.2 candidate matching", () => {
  const c = { key: "k1", name: "Luke Bayliss", company: "Creative Natives", city: "Melbourne" };
  let resultMatchesCandidate: (
    r: { url: string; title: string; content: string },
    cnd: { key: string; name: string },
  ) => boolean;
  beforeAll(async () => {
    ({ resultMatchesCandidate } = await import("../discover.server"));
  });
  it("matches name/company mentions, drops strangers", () => {
    expect(
      resultMatchesCandidate(
        { url: "https://x.example", title: "Luke Bayliss is hiring", content: "hello" },
        c,
      ),
    ).toBe(true);
    expect(
      resultMatchesCandidate(
        { url: "https://x.example", title: "Best pizza", content: "unrelated food post" },
        c,
      ),
    ).toBe(false);
  });
});

describe("Step 4.3 verification gate", () => {
  const buyer = async () => ({
    hit: { intent: "buying" as const, confidence: 0.9, evidence: "looking for", role_in_post: "buyer" as const },
  });

  it("buyer + confident -> evidence object", async () => {
    const ev = await verifyHit(hit(), "web design", "k1", buyer);
    expect(ev).not.toBeNull();
    expect(ev?.leadKey).toBe("k1");
    expect(ev?.url).toBe("https://example.com/post/1");
    expect(ev?.confidence).toBeGreaterThan(0.5);
  });

  it("seeker / noise / low-confidence / throw -> null (hidden, never shown)", async () => {
    const seeker = async () => ({
      hit: { intent: "buying" as const, confidence: 0.9, evidence: "x", role_in_post: "seeker" as const },
    });
    const noise = async () => ({
      hit: { intent: "noise" as const, confidence: 0.9, evidence: "x", role_in_post: "unknown" as const },
    });
    const weak = async () => ({
      hit: { intent: "buying" as const, confidence: 0.2, evidence: "x", role_in_post: "buyer" as const },
    });
    const down = async () => { throw new Error("no keys"); };
    expect(await verifyHit(hit(), "web design", "k1", seeker)).toBeNull();
    expect(await verifyHit(hit(), "web design", "k1", noise)).toBeNull();
    expect(await verifyHit(hit(), "web design", "k1", weak)).toBeNull();
    expect(await verifyHit(hit(), "web design", "k1", down)).toBeNull();
  });

  it("stale evidence decays", () => {
    expect(recencyScore(new Date(Date.now() - 2 * 3_600_000).toISOString())).toBe(1);
    expect(recencyScore(new Date(Date.now() - 400 * 24 * 3_600_000).toISOString())).toBe(0.2);
    expect(recencyScore(null)).toBe(0.3);
  });
});

describe("Step 4.3 ranking math", () => {
  it("fit x intent x recency x evidence", () => {
    const ev = {
      leadKey: "k1", tier: "explicit_request" as const, strength: 1,
      source: "web", url: "https://x.example", observedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(), excerpt: "looking for web design",
      reason: "r", confidence: 0.9,
    };
    const r = rankEvidence({ score: 80 }, "k1", ev);
    expect(r.fit).toBeCloseTo(0.8);
    expect(r.quality).toBeCloseTo(0.8 * 0.9 * 1 * 1);
  });

  it("fitOf falls back to 0.5 without scores", () => {
    expect(fitOf({})).toBe(0.5);
    expect(fitOf({ quality_score: 37 })).toBeCloseTo(0.37);
  });

  it("sortRanked orders by quality", () => {
    const rows = [{ key: "a" }, { key: "b" }];
    const byKey = (k: string) => (k === "a" ? { key: "a", fit: 1, intent: 1, recency: 1, evidence: 1, quality: 0.9 } : { key: "b", fit: 1, intent: 1, recency: 1, evidence: 1, quality: 0.1 });
    expect(sortRanked(rows, byKey).map((x) => x.key)).toEqual(["a", "b"]);
  });
});
