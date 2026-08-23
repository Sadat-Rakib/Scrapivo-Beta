/**
 * PRD §3/§4/§5/§6/§9 — investor render adapters: classification truth,
 * no fabricated badges, currency magnitude, human-labeled links, and
 * image URL selection with legacy fallback.
 */
import { describe, expect, it } from "vitest";
import {
  buildFirmCardModel,
  buildIndividualCardModel,
  buildInvestorCardModel,
  checkSizeOf,
  hasExplicitAngel,
  isFirmRecord,
  populatedFields,
  sourceTypeBadges,
  verificationLabel,
} from "../card-adapters";
import type { InvestorRow } from "../card-adapters";
import { hasProfileImage, investorImageUrl } from "../search";

const firmRecord = {
  id: "firm-1",
  name: "2AM VC",
  record_type: "firm",
  firm_type: ["Micro VC"],
  aum: "$1.5B",
  target_sectors: ["AI", "Fintech"],
  website: "https://2am.vc",
  linkedin: "https://www.linkedin.com/company/2am-vc",
  profile_summary: "Early stage fund.",
  source_file: "firms.json",
  image_url: "/Investors_Profile_Pics/2AM VC.png",
  information_completeness_score: 0.8,
};

const individualRecord = {
  id: "inv-1",
  name: "Adam Draper",
  record_type: "investor",
  investor_type: ["angel"],
  title: "Managing Director",
  current_role: "Managing Director",
  firm_name: "Boost Ventures",
  location: "San Francisco, CA",
  links: {
    linkedin: "https://www.linkedin.com/in/adamdraper",
    twitter: "https://x.com/adamdraper",
    firm: "https://boost.vc",
  },
  investment_profile: {
    investment_range: { raw: "$100K - $1.5M", min: 100000, max: 1500000 },
    sweet_spot: 250000,
  },
};

describe("classification (PRD §4)", () => {
  it("record_type is the source of truth", () => {
    expect(isFirmRecord(firmRecord as unknown as InvestorRow)).toBe(true);
    expect(isFirmRecord(individualRecord as unknown as InvestorRow)).toBe(false);
  });

  it("angel_investor entity_type classifies as a person, never a firm", () => {
    // The David Sargeant mislabel: an angel was org-classified.
    const angel = {
      id: "firm-abc",
      name: "David Sargeant",
      record_type: "investor",
      entity_type: "angel_investor",
    };
    expect(isFirmRecord(angel as unknown as InvestorRow)).toBe(false);
    const m = buildInvestorCardModel(angel as unknown as InvestorRow);
    expect(m.isFirm).toBe(false);
    expect(m.typeBadges).toContain("Angel");
  });

  it("untyped legacy rows classify by shape", () => {
    // Fund-machinery fields ⇒ firm, even with no classification field at all.
    const firmShaped = { name: "Mystery Capital", aum: "$2B", offices: ["London"] };
    expect(isFirmRecord(firmShaped as unknown as InvestorRow)).toBe(true);
    // Person-shaped rows (role at a firm) stay individuals.
    const personShaped = { name: "Saam Motamedi", role: "General Partner", firm: "Greylock" };
    expect(isFirmRecord(personShaped as unknown as InvestorRow)).toBe(false);
  });

  it("a firm never renders Angel or Individual", () => {
    const firms = [
      firmRecord,
      { name: "AICONIC Ventures", record_type: "firm" },
      { name: "Baillie Gifford", record_type: "firm", firm_type: ["VC"] },
      { name: "AT Capital Group", record_type: "firm" },
      { name: "Ally Bridge Group", record_type: "firm" },
    ];
    for (const rec of firms) {
      const m = buildInvestorCardModel(rec as unknown as InvestorRow);
      expect(m.isFirm).toBe(true);
      expect(m.category).toBe("Firm");
      const rendered = JSON.stringify([m.category, ...m.typeBadges]).toLowerCase();
      expect(rendered).not.toContain("angel");
      expect(rendered).not.toContain("individual");
    }
  });

  it("Angel appears only when the source record explicitly says angel", () => {
    expect(hasExplicitAngel(individualRecord as unknown as InvestorRow)).toBe(true);
    expect(hasExplicitAngel({ name: "X", record_type: "investor" } as unknown as InvestorRow)).toBe(
      false,
    );
    expect(hasExplicitAngel(firmRecord as unknown as InvestorRow)).toBe(false);
  });

  it("badges come strictly from the investor_type array", () => {
    expect(sourceTypeBadges({ investor_type: ["vc", "angel"] } as unknown as InvestorRow)).toEqual([
      "VC",
      "Angel",
    ]);
    expect(sourceTypeBadges({ name: "No types" } as unknown as InvestorRow)).toEqual([]);
  });

  it("no universal Verified default", () => {
    expect(verificationLabel(firmRecord as unknown as InvestorRow)).toBeUndefined();
    expect(verificationLabel({ record_status: "verified" } as unknown as InvestorRow)).toBe(
      "Verified",
    );
    expect(verificationLabel({ record_status: "pending" } as unknown as InvestorRow)).toBe(
      "Unverified",
    );
  });
});

describe("currency magnitude in the model (PRD §6)", () => {
  it("check size keeps both range endpoints with their units", () => {
    expect(checkSizeOf(individualRecord as unknown as InvestorRow)).toBe("$100K - $1.5M");
  });

  it("firm AUM never collapses $1.5B to $1", () => {
    const m = buildFirmCardModel(firmRecord as unknown as InvestorRow);
    const aum = m.detailStats.find((s) => s.label === "AUM");
    expect(aum?.value).toBe("$1.5B");
    const cardAum = m.cardStats.find((s) => s.label === "AUM");
    expect(cardAum?.value).toBe("$1.5B");
  });

  it("numeric sweet spot renders with magnitude", () => {
    const m = buildIndividualCardModel(individualRecord as unknown as InvestorRow);
    const ss = m.detailStats.find((s) => s.label === "Sweet spot");
    expect(ss?.value).toBe("$250K");
  });

  it("single-sided check bounds never render a ? placeholder", () => {
    const half = checkSizeOf({ check_max_usd: 5_000_000 } as unknown as InvestorRow);
    expect(half).toBe("$5M");
    const otherHalf = checkSizeOf({ check_min_usd: 100_000 } as unknown as InvestorRow);
    expect(otherHalf).toBe("$100K");
    expect(half && half.includes("?")).toBe(false);
    expect(otherHalf && otherHalf.includes("?")).toBe(false);
  });
});

describe("links and internal fields (PRD §9/§7)", () => {
  it("builds human-labeled links with full URLs preserved", () => {
    const m = buildIndividualCardModel(individualRecord as unknown as InvestorRow);
    const byLabel = Object.fromEntries(m.links.map((l) => [l.label, l.href]));
    expect(byLabel["LinkedIn profile"]).toBe("https://www.linkedin.com/in/adamdraper");
    expect(byLabel["Twitter / X"]).toBe("https://x.com/adamdraper");
    expect(byLabel["Firm website"]).toBe("https://boost.vc");
  });

  it("firm links include LinkedIn profile and Website", () => {
    const m = buildFirmCardModel(firmRecord as unknown as InvestorRow);
    const byLabel = Object.fromEntries(m.links.map((l) => [l.label, l.href]));
    expect(byLabel["LinkedIn profile"]).toBe("https://www.linkedin.com/company/2am-vc");
    expect(byLabel["Website"]).toBe("https://2am.vc");
  });

  it("detail stats never carry raw URLs or internal source_file rows", () => {
    for (const rec of [firmRecord, individualRecord]) {
      const m = buildInvestorCardModel(rec as unknown as InvestorRow);
      for (const s of m.detailStats) {
        expect(s.value, `stat ${s.label}`).not.toMatch(/^https?:\/\//);
        expect(s.label).not.toBe("Source");
      }
    }
  });

  it("populatedFields stays lossless for the full-record drawer", () => {
    const fields = populatedFields(firmRecord as unknown as InvestorRow);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("aum");
    expect(keys).toContain("target_sectors");
    expect(keys).toContain("profile_summary");
    expect(keys).toContain("source_file"); // present in walker; hidden by UI filter
  });
});

describe("image selection (PRD §5)", () => {
  it("uses record.image_url as the canonical field", () => {
    expect(investorImageUrl(firmRecord as never)).toBe("/Investors_Profile_Pics/2AM VC.png");
    expect(hasProfileImage(firmRecord as never)).toBe(true);
  });

  it("falls back to links.image_url for legacy records", () => {
    const legacy = { name: "Legacy", links: { image_url: "/pics/legacy.png" } };
    expect(investorImageUrl(legacy as never)).toBe("/pics/legacy.png");
  });

  it("returns null for missing images (initials fallback at render)", () => {
    expect(investorImageUrl({ name: "No Image" } as never)).toBeNull();
    expect(hasProfileImage({ name: "No Image" } as never)).toBe(false);
  });

  it("never reconstructs a filename — stored path used exactly", () => {
    const rec = { name: "Weird / Name!", image_url: "/pics/Stored Exact.png" };
    expect(investorImageUrl(rec as never)).toBe("/pics/Stored Exact.png");
  });
});
