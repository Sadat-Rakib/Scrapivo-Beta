import { describe, expect, it } from "vitest";
import { thinClarifyForSpec } from "../clarifier";
import { runSpecSearchCore } from "@/lib/spec-search.functions";

/** Phase 5: always-ask on thin — ready-but-empty results carry refinements. */
describe("thinClarifyForSpec", () => {
  it("company asks unstated optionals, skips stated", () => {
    const q = thinClarifyForSpec({
      entity: "company",
      criteria: [{ field: "business_model", value: "d2c" }],
    });
    expect(q.map((x) => x.id)).toEqual(["entity_location", "entity_industry"]);
  });

  it("person does not ask unrelated seniority when industry+location are known", () => {
    const q = thinClarifyForSpec({
      entity: "person",
      criteria: [
        { field: "role", value: "founder" },
        { field: "industry", value: "SaaS" },
        { field: "location", value: "New York" },
      ],
    });
    expect(q).toEqual([]);
  });

  it("business asks location (forced geo-less) + business_model", () => {
    const q = thinClarifyForSpec({
      entity: "business",
      criteria: [{ field: "category", value: "restaurants" }],
    });
    expect(q.map((x) => x.id)).toEqual(["entity_location", "entity_business_model"]);
  });

  it("investor/unknown get nothing (no optional slots)", () => {
    expect(thinClarifyForSpec({ entity: "investor", criteria: [] })).toEqual([]);
    expect(thinClarifyForSpec({ entity: "unknown", criteria: [] })).toEqual([]);
  });
});

describe("thin-ask end to end (stubs, no network)", () => {
  const emptyPeople = (async () => ({
    rows: [],
    meta: { dbHit: false, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 0, rowsReturned: 0 },
  })) as never;
  const emptyCompanies = emptyPeople;
  const emptyBusinesses = emptyPeople;

  it("thin person search stays honest-empty without asking seniority", async () => {
    const res = await runSpecSearchCore(
      "SaaS founders in New York",
      { people: emptyPeople, index: null },
      25,
      { mode: "looking" },
    );
    expect(res.rows).toEqual([]);
    expect(res.liveDiscovery).toBe("db_thin_gapfill_pending");
    expect(res.clarify).toEqual([]);
    expect(res.questions).toEqual([]);
  });

  it("thin company search with a stated business model asks only for location", async () => {
    const res = await runSpecSearchCore(
      "D2C brands",
      { companies: emptyCompanies, index: null },
      25,
      { mode: "looking" },
    );
    expect(res.rows).toEqual([]);
    expect(res.clarify.map((q) => q.id)).toEqual(["entity_location"]);
  });

  // E2E-C3 contract: force = Skip / "Search with defaults" — the user already
  // declined refinement, so a forced thin run settles as an honest zero and
  // never re-attaches the same question. Non-forced thin zeros still offer it
  // once (the client asks at most once per turn).
  it("thin forced business search settles as honest zero without re-asking", async () => {
    const res = await runSpecSearchCore(
      "yo find me businesses rn",
      { businesses: emptyBusinesses, index: null },
      25,
      { category: "restaurants", mode: "looking" },
      { force: true },
    );
    expect(res.rows).toEqual([]);
    expect(res.clarify).toEqual([]);
    expect(res.questions).toEqual([]);
  });

  it("rich search stays quiet (no thin questions when rows found)", async () => {
    const full = (async () => ({
      rows: [{ name: "Jane Founder", title: "Founder", company_name: "Acme", country: "New York", industry: "SaaS", email: "jane@acme.example", personal_linkedin: "https://linkedin.com/in/jane" }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
    })) as never;
    const res = await runSpecSearchCore(
      "SaaS founders in New York",
      { people: full, index: null },
      25,
      { mode: "looking" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
    expect(res.questions).toEqual([]);
  });
});
