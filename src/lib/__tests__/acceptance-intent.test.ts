/** Phase 1 acceptance (intent half): the four evidence grades. Every
 *  qualified signal must carry source + URL + timestamp + evidence +
 *  confidence; anything less is an honest null. Classifier injected. */
import { describe, expect, it } from "vitest";
import { verifyHit } from "@/lib/intent/verify.server";
import type { IntentLabel } from "@/lib/ai/intent-classifier.server";
import type { EvidenceHit } from "@/lib/intent/evidence";

type MockClassify = (
  _target: string,
  _leads: unknown,
) => Promise<Record<string, IntentLabel>>;

const HIT: EvidenceHit = {
  tier: "explicit_request",
  strength: 0.95,
  source: "LinkedIn",
  url: "https://linkedin.example/posts/123",
  title: "Looking for a freelance web designer",
  phrase: "looking for a web designer",
  excerpt: "We are looking for a freelance web designer to rebuild our site ASAP.",
  publishedAt: "2026-09-10T12:00:00.000Z",
};

describe("acceptance: intent evidence grades", () => {
  it("genuine public signal → qualified evidence with all five fields", async () => {
    const ev = await verifyHit(HIT, "website design", "lead:1", async (_target: string, _leads: unknown): Promise<Record<string, IntentLabel>> => ({
      hit: { intent: "hiring", confidence: 0.9, role_in_post: "buyer", evidence: "looking for a web designer" },
    }));
    expect(ev).not.toBeNull();
    expect(ev).toMatchObject({
      source: "LinkedIn",
      url: "https://linkedin.example/posts/123",
      tier: "explicit_request",
    });
    expect(typeof ev!.observedAt).toBe("string");
    expect(ev!.excerpt.length).toBeGreaterThan(0);
    expect(ev!.confidence).toBe(0.9);
  });

  it("no signal (classifier unavailable) → honest null, never a badge", async () => {
    const ev = await verifyHit(HIT, "website design", "lead:1", async () => {
      throw new Error("no keys");
    });
    expect(ev).toBeNull();
  });

  it("weak/ambiguous evidence (confidence 0.3) → null", async () => {
    const ev = await verifyHit(HIT, "website design", "lead:1", async (_target: string, _leads: unknown): Promise<Record<string, IntentLabel>> => ({
      hit: { intent: "researching", confidence: 0.3, role_in_post: "buyer", evidence: "maybe need design" },
    }));
    expect(ev).toBeNull();
  });

  it("strong explicit buying intent → qualified at full confidence", async () => {
    const ev = await verifyHit(HIT, "website design", "lead:1", async (_target: string, _leads: unknown): Promise<Record<string, IntentLabel>> => ({
      hit: { intent: "buying", confidence: 0.95, role_in_post: "buyer", evidence: "will pay for a website" },
    }));
    expect(ev).not.toBeNull();
    expect(ev!.confidence).toBe(0.95);
  });

  it("seeker-role posts never qualify (seller's own pitch is not buyer intent)", async () => {
    const ev = await verifyHit(HIT, "website design", "lead:1", async (_target: string, _leads: unknown): Promise<Record<string, IntentLabel>> => ({
      hit: { intent: "hiring", confidence: 0.9, role_in_post: "seeker", evidence: "we build websites" },
    }));
    expect(ev).toBeNull();
  });
});
