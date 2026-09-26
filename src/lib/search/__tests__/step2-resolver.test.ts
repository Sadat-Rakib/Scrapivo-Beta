import { afterEach, describe, expect, it } from "vitest";

const ENV_OLD = process.env.USE_INDEXED_SEARCH;
afterEach(() => {
  if (ENV_OLD === undefined) delete process.env.USE_INDEXED_SEARCH;
  else process.env.USE_INDEXED_SEARCH = ENV_OLD;
});
import {
  resolveLocationToken,
  suggestLocation,
  similarity,
} from "../location-resolver";
import { extractSearchSpec } from "../search-spec-extract";
import { entityQuestionsForSpec } from "../clarifier";
import { expandCategory, canonCraft } from "@/lib/canonical/businesses.server";
import { runSpecSearchCore } from "@/lib/spec-search.functions";

describe("Step 2.1 location resolver", () => {
  it("exact + alias resolve at confidence 1", () => {
    expect(resolveLocationToken("Pune")).toMatchObject({ kind: "exact", canonical: "Pune", confidence: 1 });
    expect(resolveLocationToken("Bombay")).toMatchObject({ kind: "alias", canonical: "Mumbai" });
    expect(resolveLocationToken("Dacca")).toMatchObject({ kind: "alias", canonical: "Dhaka" });
  });

  it("Daaka suggests Dhaka above the floor", () => {
    const r = resolveLocationToken("Daaka");
    expect(r.kind).toBe("fuzzy");
    expect(r.canonical).toBe("Dhaka");
    expect(r.confidence).toBeGreaterThanOrEqual(0.68);
  });

  it("gibberish + short tokens stay unknown", () => {
    expect(resolveLocationToken("Xyzqwv").kind).toBe("unknown");
    expect(resolveLocationToken("in").kind).toBe("unknown");
  });

  it("suggestLocation finds in-phrase typos, ignores exacts", () => {
    const s = suggestLocation("find me dentists in Daaka");
    expect(s).toMatchObject({ suggestion: "Dhaka" });
    expect(suggestLocation("find me dentists in Pune")).toBeNull();
    expect(suggestLocation("yo find me businesses rn")).toBeNull();
  });

  it("similarity is sane", () => {
    expect(similarity("Daaka", "Dhaka")).toBeGreaterThan(0.7);
    expect(similarity("Pune", "Mumbai")).toBeLessThan(0.5);
  });
});

describe("Step 2.1 extractor + did-you-mean wiring", () => {
  it("dentists in Daaka: location missing + Dhaka suggestion, never stated", () => {
    const spec = extractSearchSpec("find me dentists in Daaka");
    expect(spec.entity).toBe("business");
    expect(spec.missing).toContain("location");
    expect(spec.criteria.find((c) => c.field === "location")).toBeUndefined();
    expect(spec.locationSuggestion).toMatchObject({ suggestion: "Dhaka" });
    expect(spec.status).toBe("needs_clarification");
  });

  it("dentists in Dhaka: exact, ready, no suggestion", () => {
    const spec = extractSearchSpec("find me dentists in Dhaka");
    expect(spec.criteria.find((c) => c.field === "location")?.value).toBe("Dhaka");
    expect(spec.locationSuggestion ?? null).toBeNull();
    expect(spec.missing).not.toContain("location");
  });

  it("suggestion becomes a Yes-option that answers the slot", () => {
    const spec = extractSearchSpec("find me dentists in Daaka");
    const qs = entityQuestionsForSpec(spec);
    const loc = qs.find((q) => q.id === "entity_location");
    expect(loc?.question).toMatch(/Did you mean Dhaka\?/);
    const yes = loc?.options.find((o) => o.recommended);
    expect(yes?.id).toBe("Dhaka");
  });
});

describe("T3 country-hint gate (Jamnagar-must-never-pass-Dhaka)", () => {
  it("wrong-country and wrong-city rows are both rejected", async () => {
    const { rowSatisfiesSpec } = await import("@/lib/spec-search.functions");
    const { extractSearchSpec } = await import("../search-spec-extract");
    const dhaka = extractSearchSpec("find me dentists in Dhaka");
    // Jamnagar (IN) must NOT pass a Dhaka query.
    expect(
      rowSatisfiesSpec(dhaka, {
        kind: "business", title: "Ruparelia Dental", detail: "cross rd, jamnagar, gj, 361008, Jamnagar, GJ, IN",
        category: "dentist", location: "Jamnagar, GJ", country: "IN",
      }),
    ).toBe(false);
    // Country membership alone does not prove the requested city.
    const pune = extractSearchSpec("find me dentists in Pune");
    expect(
      rowSatisfiesSpec(pune, {
        kind: "business", title: "Bandra Smile", detail: "linking rd, bandra, Mumbai, MH",
        category: "dentist", location: "Mumbai, MH", country: "IN",
      }),
    ).toBe(false);
  });

  it("countryHintForCity covers scope cities", async () => {
    const { countryHintForCity } = await import("../location-resolver");
    expect(countryHintForCity("Dhaka")).toBe("BD");
    expect(countryHintForCity("Dacca")).toBe("BD");
    expect(countryHintForCity("Pune")).toBe("IN");
    expect(countryHintForCity("Lyon")).toBeNull();
  });
});

describe("T3 coverage: qualifiers, slots, vocab", () => {
  it("mid-sentence unknown places survive qualifiers", () => {
    const s = extractSearchSpec("dentists in Lyon without websites");
    expect(s.criteria.find((c) => c.field === "location")?.value).toBe("Lyon");
    expect(s.criteria.find((c) => c.field === "opportunity")?.value).toBe("no_website");
  });

  it("Pune with qualifier still resolves exact", () => {
    const s = extractSearchSpec("dentists in Pune without websites");
    expect(s.criteria.find((c) => c.field === "location")?.value).toBe("Pune");
  });

  it("Goa (real, no close match) states verbatim; Daaka still fuzzy", () => {
    // No guess when nothing is close: the DB judges coverage (Lyon rule).
    expect(suggestLocation("bars in Goa")).toBeNull();
    const g = extractSearchSpec("bars in Goa");
    expect(g.criteria.find((c) => c.field === "location")?.value).toBe("Goa");
    expect(suggestLocation("find me dentists in Daaka")?.suggestion).toBe("Dhaka");
    // 3-letter tokens pass the length gate (Rio/Goa no longer blocked).
    expect(resolveLocationToken("Rio")).toMatchObject({ kind: expect.any(String) });
  });

  it("shops map to business entity+category; managers to person role", () => {
    const shops = extractSearchSpec("shops in Austin");
    expect(shops.entity).toBe("business");
    expect(shops.criteria.find((c) => c.field === "category")?.value).toMatch(/shop/);
    const mgr = extractSearchSpec("managers in Mumbai");
    expect(mgr.entity).toBe("person");
    expect(mgr.criteria.find((c) => c.field === "role")?.value).toMatch(/manager/);
  });

  it("climate/devtools industries + seed check + spaced stages", () => {
    const c = extractSearchSpec("climate companies in London");
    expect(
      c.criteria.find((x) => x.field === "industry")?.value ??
        c.criteria.find((x) => x.field === "investor_sector")?.value,
    ).toBe("Climate");
    const d = extractSearchSpec("investors in DevTools in London");
    expect(d.criteria.find((x) => x.field === "investor_sector")?.value).toBe("DevTools");
    const s = extractSearchSpec("seed investors in AI");
    expect(s.criteria.find((x) => x.field === "investor_stage")?.value).toBe("seed");
    expect(s.criteria.find((x) => x.field === "investor_check")?.value).toBe("seed");
    const sb = extractSearchSpec("investors series B fintech");
    expect(sb.criteria.find((x) => x.field === "investor_stage")?.value).toBe("series-b");
  });

  it("new countries resolve (France, Japan, Texas stays a stated word)", () => {
    expect(extractSearchSpec("dentists in France").criteria.find((c) => c.field === "location")?.value).toBe("France");
    expect(extractSearchSpec("dentists in Texas").criteria.find((c) => c.field === "location")?.value).toBe("Texas");
  });
});

describe("Index-empty S3 fallthrough + throw safety", () => {
  const emptyIndex = async () => ({
    rows: [],
    meta: { dbHit: false, engine: "pg-index" as const, partitionsRead: ["idx"], rowsScanned: 0, rowsReturned: 0 },
  });

  it("index empty + location -> S3 rows used, both metas logged", async () => {
    process.env.USE_INDEXED_SEARCH = "true";
    const s3 = async () => ({
      rows: [{ name: "Toronto Dental", category: "dentist", locality: "Toronto", country: "CA", phone: "+1-416-555-0100" }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["ca.parquet"], rowsScanned: 10, rowsReturned: 1 },
    });
    const res = await runSpecSearchCore(
      "find me dentists in Toronto", { index: emptyIndex as never, businesses: s3 as never }, 20,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("Toronto Dental");
    expect(res.dbMeta.map((m) => m.engine)).toEqual(["pg-index", "s3-parquet"]);
  });

  it("index empty + S3 throws -> honest empty, no crash", async () => {
    process.env.USE_INDEXED_SEARCH = "true";
    const boom = async () => { throw new Error("no creds"); };
    const res = await runSpecSearchCore(
      "find me dentists in Toronto", { index: emptyIndex as never, businesses: boom as never }, 20,
    );
    expect(res.rows).toEqual([]);
    expect(res.liveDiscovery).toBe("db_thin_gapfill_pending");
  });
});

describe("Investor answers end to end (stubs)", () => {
  it("stage/sector/check asked, answered, filtered by row values", async () => {
    const fake = async () => ({
      rows: [
        { name: "Seed AI Fund", role: "", firm: "SAIF", location_raw: "London", location_country: "UK", email: "a@saif.example", website: "https://saif.example", sectors: ["AI"], stages: ["seed"] },
        { name: "Growth Fintech Fund", role: "", firm: "GFF", location_raw: "London", location_country: "UK", email: "b@gff.example", website: "https://gff.example", sectors: ["Fintech"], stages: ["series-b"] },
      ],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 2, rowsReturned: 2 },
    });
    const res = await runSpecSearchCore(
      "investors in London", { investors: fake as never, index: null }, 25,
      { investor_stage: "seed", investor_sector: "AI", investor_check: "seed" },
    );
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toMatch(/Seed AI Fund/);
  });
});

describe("Step 2.2 category families (DB vocabulary, counted)", () => {
  it("canon + expansion cover real_estate and hvac rows", () => {
    expect(canonCraft("real estate")).toBe("real_estate");
    expect(canonCraft("realtors")).toBe("real_estate");
    expect(expandCategory("real_estate")).toEqual(
      expect.arrayContaining(["real_estate_service", "real_estate_agent"]),
    );
    expect(expandCategory("hvac")).toEqual(
      expect.arrayContaining(["hvac", "hvac_services"]),
    );
    expect(expandCategory("dentist")).toContain("dentist");
    expect(expandCategory("plumber")).toEqual(["plumber"]);
  });

  it("extractor picks up real-estate phrasing", () => {
    const spec = extractSearchSpec("real estate businesses in Mumbai");
    expect(spec.entity).toBe("business");
    expect(spec.criteria.find((c) => c.field === "category")?.value).toMatch(/real.?estate|realtor/);
    expect(spec.criteria.find((c) => c.field === "location")?.value).toBe("Mumbai");
  });
});

describe("Step 2.3 opportunity slot + investor phrasing", () => {
  it("without-a-website becomes an optional opportunity criterion", () => {
    const spec = extractSearchSpec("find local HVAC companies without a website in Austin");
    expect(spec.criteria.find((c) => c.field === "opportunity")?.value).toBe("no_website");
    expect(spec.missing).not.toContain("opportunity");
  });

  it("investors backing pre-seed AI: entity + stage + sector", () => {
    const spec = extractSearchSpec("investors backing pre-seed AI startups");
    expect(spec.entity).toBe("investor");
    expect(spec.criteria.find((c) => c.field === "investor_stage")?.value).toBe("pre-seed");
    expect(spec.criteria.find((c) => c.field === "investor_sector")?.value).toBe("AI");
  });

  it("no_website filters site rows on every engine", async () => {
    const fake = async () => ({
      rows: [
        { name: "NoSite Plumbing", category: "plumber", locality: "Austin", country: "US", website: null, phone: "+1-512-555-0100" },
        { name: "HasSite Plumbing", category: "plumber", locality: "Austin", country: "US", website: "https://x.example", phone: "+1-512-555-0101" },
      ],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 2, rowsReturned: 2 },
    });
    // Phase 1.3: the mode gate fires first (no mode stated) — pass it
    // explicitly so this test isolates opportunity filtering, not gating.
    const res = await runSpecSearchCore(
      "plumbers in Austin without a website", { businesses: fake as never }, 20,
      { mode: "selling", offer: "websites" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("NoSite Plumbing");
  });
});

describe("Step 2.4 mode + offer questions (Phase 1.3: owned by the mode gate)", () => {
  it("panel asks missing fields only — never mode/offer (gate asks those pre-retrieval)", () => {
    const spec = extractSearchSpec("bro i need businesses plz asap");
    const qs = entityQuestionsForSpec(spec);
    expect(qs.map((q) => q.id)).toEqual([
      "entity_category",
      "entity_location",
    ]);
    expect(qs.map((q) => q.id)).not.toContain("entity_mode");
    expect(qs.map((q) => q.id)).not.toContain("entity_offer");
  });

  it("complete specs and investors get no mode questions", () => {
    expect(
      entityQuestionsForSpec(extractSearchSpec("I need SaaS founders in New York")).map((q) => q.id),
    ).not.toContain("entity_mode");
    expect(
      entityQuestionsForSpec(extractSearchSpec("I need investors")).map((q) => q.id),
    ).not.toContain("entity_mode");
  });
});
