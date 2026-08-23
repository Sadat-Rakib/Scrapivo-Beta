/**
 * PRD §7 — human-friendly labels, internal-field suppression, and the
 * guarantee that no raw snake_case key reaches the rendered UI.
 */
import { describe, expect, it } from "vitest";
import { FIELD_LABELS, humanLabel, isInternalKey } from "../field-labels";
import { populatedFields } from "../populated-fields";
import { splitParagraphs } from "../text";

describe("humanLabel", () => {
  it.each([
    ["firm_type", "Firm type"],
    ["lp_type", "LP type"],
    ["target_sectors", "Target sectors"],
    ["target_subsectors", "Target subsectors"],
    ["target_regions", "Target regions"],
    ["vc_investment_types", "VC investment types"],
    ["profile_summary", "Profile summary"],
    ["investment_profile", "Investment profile"],
    ["current_role", "Current role"],
    ["us_states", "U.S. states"],
    ["aum", "AUM"],
  ])("maps %s → %s", (key, expected) => {
    expect(humanLabel(key)).toBe(expected);
  });

  it("never produces naive capitalization like 'Vc Investment Types'", () => {
    expect(humanLabel("vc_investment_types")).not.toBe("Vc Investment Types");
    expect(humanLabel("lp_type")).not.toBe("Lp Type");
  });

  it("resolves dotted keys by their leaf", () => {
    expect(humanLabel("investment_profile.sweet_spot")).toBe("Sweet spot");
    expect(humanLabel("links.linkedin")).toBe("LinkedIn");
  });

  it("sentence-cases unknown keys with acronym overrides", () => {
    expect(humanLabel("vc_fund_size")).toBe("VC fund size");
    expect(humanLabel("portfolio_url")).toBe("Portfolio URL");
  });

  it("every curated label is free of snake_case", () => {
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
      expect(label, `label for ${key}`).not.toMatch(/_/);
    }
  });
});

describe("internal-field suppression", () => {
  it("hides parser metadata keys from ordinary UI", () => {
    expect(isInternalKey("source_file")).toBe(true);
    expect(isInternalKey("image_url")).toBe(true);
    expect(isInternalKey("information_completeness_score")).toBe(true);
    expect(isInternalKey("record_type")).toBe(true);
    expect(isInternalKey("id")).toBe(true);
    expect(isInternalKey("score")).toBe(true);
    expect(isInternalKey("investment_profile.image_url")).toBe(true);
  });

  it("hides verification/ingest internals from ordinary UI", () => {
    expect(isInternalKey("verify_note")).toBe(true);
    expect(isInternalKey("email_verified")).toBe(true);
    expect(isInternalKey("website_status")).toBe(true);
    expect(isInternalKey("sample_url")).toBe(true);
    expect(isInternalKey("listing_url")).toBe(true);
    expect(isInternalKey("fetched_at")).toBe(true);
  });

  it("keeps user-relevant keys visible", () => {
    expect(isInternalKey("name")).toBe(false);
    expect(isInternalKey("website")).toBe(false);
    expect(isInternalKey("profile_summary")).toBe(false);
    expect(isInternalKey("investment_profile.sweet_spot")).toBe(false);
  });

  it("walked fields of a record filter out every internal key", () => {
    const rec = {
      id: "x1",
      name: "Test Firm",
      record_type: "firm",
      source_file: "firms.json",
      image_url: "/pics/x.png",
      information_completeness_score: 0.9,
      aum: "$1.5B",
    };
    const visible = populatedFields(rec).filter((f) => !isInternalKey(f.key));
    const keys = visible.map((f) => f.key);
    expect(keys).toContain("name");
    expect(keys).toContain("aum");
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("record_type");
    expect(keys).not.toContain("source_file");
    expect(keys).not.toContain("image_url");
    expect(keys).not.toContain("information_completeness_score");
  });
});

describe("populatedFields (lossless walker)", () => {
  it("flattens nested objects into dotted keys without dropping values", () => {
    const rec = {
      name: "A",
      investment_profile: {
        sweet_spot: 250000,
        investment_range: { raw: "$100K - $1.5M", min: 100000, max: 1500000 },
      },
      target_sectors: ["AI", "Fintech"],
    };
    const fields = populatedFields(rec);
    const map = Object.fromEntries(fields.map((f) => [f.key, f.value]));
    expect(map["investment_profile.investment_range.raw"]).toBe("$100K - $1.5M");
    expect(map["investment_profile.investment_range.min"]).toBe("100000");
    expect(map["investment_profile.sweet_spot"]).toBe("250000");
    expect(map["target_sectors"]).toBe("AI, Fintech");
  });

  it("skips null/empty leaves", () => {
    const fields = populatedFields({ a: null, b: "", c: "  ", d: "x", e: [] });
    expect(fields.map((f) => f.key)).toEqual(["d"]);
  });

  it("renders booleans as Yes/No, never 1/0 or true/false", () => {
    const map = Object.fromEntries(
      populatedFields({ remote: true, verified: false, flags: [true, false] }).map((f) => [
        f.key,
        f.value,
      ]),
    );
    expect(map.remote).toBe("Yes");
    expect(map.verified).toBe("No");
    expect(map.flags).toBe("Yes, No");
  });

  it("renders evidence claim arrays as readable bullets, never JSON", () => {
    const rec = {
      evidence: [
        {
          claim: "invests in / covers Southeast Asia",
          evidence: [{ source: "investors_seed", data: "Southeast Asia" }],
          confidence: "high",
          observedAt: "2026-08-22T00:00:00.000Z",
        },
        {
          claim: "has public email",
          evidence: [{ source: "contact_intelligence", url: "https://example.com/x" }],
          confidence: "high",
          observedAt: "2026-08-22T00:00:00.000Z",
        },
      ],
    };
    const fields = populatedFields(rec);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("evidence");
    expect(fields[0].value).toContain("invests in / covers Southeast Asia");
    expect(fields[0].value).toContain("has public email (example.com)");
    expect(fields[0].value).not.toMatch(/[{"[]/); // no JSON punctuation
  });

  it("summarizes unknown object arrays from their primitive leaves, never JSON", () => {
    const fields = populatedFields({ offices: [{ city: "London" }, { city: "NYC" }] });
    expect(fields[0].value).toBe("London; NYC");
  });
});

describe("splitParagraphs (PRD §8 readability)", () => {
  it("preserves source paragraph breaks", () => {
    const out = splitParagraphs("First para.\n\nSecond para.");
    expect(out).toEqual(["First para.", "Second para."]);
  });

  it("splits dense blocks at sentence boundaries", () => {
    const sentence = "The fund invests in early stage companies. ";
    const dense = sentence.repeat(30).trim();
    const out = splitParagraphs(dense);
    expect(out.length).toBeGreaterThan(1);
    // Rejoining must preserve every character of meaning (no truncation).
    expect(out.join(" ").replace(/\s+/g, " ")).toBe(dense.replace(/\s+/g, " "));
    for (const p of out) expect(p.length).toBeLessThanOrEqual(600);
  });

  it("leaves short text untouched", () => {
    expect(splitParagraphs("Short bio.")).toEqual(["Short bio."]);
    expect(splitParagraphs("")).toEqual([]);
  });
});
