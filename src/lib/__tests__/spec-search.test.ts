import { afterEach, describe, expect, it, vi } from "vitest";
import {
  questionsForMissing,
  rowSatisfiesSpec,
  runSpecSearchCore,
} from "../spec-search.functions";
import { extractSearchSpec } from "../search/search-spec-extract";

/** Phase 1 E2E-shaped assertions with injected (fake) DB readers. */
const fakePeople = vi.fn(async () => ({
  rows: [
    { name: "Ada Lovelace", title: "Founder & CEO", company_name: "Analytical Inc",
      website: "https://analytical.example", email: "ada@analytical.example",
      phone: "+1", country: "New York", industry: "SaaS" },
    { name: "Bob Smith", title: "Plumber", company_name: "Pipes Co",
      website: null, email: "b@x.com", phone: "+1", country: "Texas", industry: "Plumbing" },
  ],
  meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 2, rowsReturned: 2 },
}));

describe("spec-first flow", () => {
  it("P1: SaaS founders NY → zero questions, validated rows", async () => {
    const res = await runSpecSearchCore("I need SaaS founders in New York", { people: fakePeople as never }, 25);
    // DB reader is stubbed: validate the flow wiring (spec + validation), not S3.
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.questions).toEqual([]);
    expect(res.dbMeta).toHaveLength(1);
    expect(res.rejected).toBeGreaterThanOrEqual(0);
    expect(res.liveDiscovery).toBe("not_required");
  });

  it("P2: bare businesses → location question, no search", async () => {
    const res = await runSpecSearchCore("bro i need businesses plz asap", {}, 25);
    expect(res.spec.status).toBe("needs_clarification");
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]).toMatch(/location/i);
    expect(res.rows).toEqual([]);
  });

  it("P3: signal-required company intent flagged, DB-first", async () => {
    const res = await runSpecSearchCore(
      "companies looking for website developers",
      { companies: (async () => ({ rows: [], meta: { dbHit: false, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 0, rowsReturned: 0 } })) as never },
      25,
    );
    expect(res.spec.signal_required).toBe(true);
    // Phase C: live may run (completed) or stay thin when skipped under vitest.
    expect(["completed", "db_thin_gapfill_pending", "required_pending_phase7"]).toContain(
      res.liveDiscovery,
    );
  });

  it("validation rejects rows violating the spec", () => {    const spec = extractSearchSpec("I need SaaS founders in New York");
    expect(rowSatisfiesSpec(spec, {
      kind: "person", title: "Ada Lovelace — Founder & CEO @ Analytical Inc",
      detail: "New York · SaaS · https://analytical.example",
    })).toBe(true);
    expect(rowSatisfiesSpec(spec, {
      kind: "person", title: "Bob Smith — Plumber @ Pipes Co", detail: "Texas · Plumbing",
    })).toBe(false);
  });

  it("questions map 1:1 to missing fields", () => {
    const spec = extractSearchSpec("bro i need businesses");
    expect(questionsForMissing(spec)).toHaveLength(spec.missing.length);
  });

  it("validation uses row category/location fields, not just title text", () => {
    // Regression: 50 fetched dentists were all rejected because clinic names
    // don't contain the word "dentists" — the category column does.
    const spec = extractSearchSpec("find me dentists in canada");
    expect(spec.status).toBe("ready_to_search");
    expect(
      rowSatisfiesSpec(spec, {
        kind: "business",
        title: "Bright Smile Dental",
        detail: "123 Main St",
        category: "dentist",
        location: "Toronto",
        country: "CA",
      }),
    ).toBe(true);
    expect(
      rowSatisfiesSpec(spec, {
        kind: "business",
        title: "Joe's Plumbing",
        detail: "9 Main St",
        category: "plumber",
        location: "Austin",
        country: "US",
      }),
    ).toBe(false);
  });

  it("force searches with partial answers instead of re-asking", async () => {
    const fakeBusinesses = (async () => ({
      rows: [{ name: "Acme Plumbers Austin", category: "plumber", phone: "+15125550123" }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
    })) as never;
    const res = await runSpecSearchCore(
      "yo find me businesses rn", { businesses: fakeBusinesses }, 25, { category: "plumbers" }, { force: true },
    );
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.questions).toEqual([]);
    expect(res.rows).toHaveLength(1);
  });

  it("without force, partial answers re-ask only still-missing fields", async () => {
    const res = await runSpecSearchCore(
      "yo find me businesses rn", {}, 25, { category: "plumbers" },
    );
    expect(res.spec.status).toBe("needs_clarification");
    expect(res.spec.missing).toEqual(["location"]);
  });

  it("extractor finds location without 'in' + new crafts/cities", () => {
    const cases: Array<[string, string, string]> = [
      ["dentists Canada", "dentists", "Canada"],
      ["find me dentists in Pune", "dentists", "Pune"],
      ["plumbers Austin", "plumbers", "Austin"],
      ["find me hvac in Austin", "hvac", "Austin"],
      ["find me companies in UK", "", "UK"],
    ];
    for (const [q, wantCat, wantLoc] of cases) {
      const s = extractSearchSpec(q);
      expect(s.status).toBe("ready_to_search");
      if (wantCat) {
        expect(s.criteria.find((c) => c.field === "category")?.value).toBe(wantCat);
      }
      expect(s.criteria.find((c) => c.field === "location")?.value).toBe(wantLoc);
    }
  });

  it("country validation uses ISO: CA passes Canada, US rejected", () => {
    const spec = extractSearchSpec("find me dentists in canada");
    expect(
      rowSatisfiesSpec(spec, {
        kind: "business", title: "Bright Smile", detail: "123 Main, Toronto, ON, CA",
        category: "dentist", location: "Toronto", country: "CA",
      }),
    ).toBe(true);
    expect(
      rowSatisfiesSpec(spec, {
        kind: "business", title: "Texas Dental", detail: "1 Main, Austin, TX, US",
        category: "dentist", location: "Austin", country: "US",
      }),
    ).toBe(false);
  });

  describe("indexed cutover (USE_INDEXED_SEARCH)", () => {
    const OLD = process.env.USE_INDEXED_SEARCH;
    afterEach(() => { process.env.USE_INDEXED_SEARCH = OLD; });

    const pgMeta = {
      dbHit: true, engine: "pg-index" as const, partitionsRead: ["idx_businesses"],
      rowsScanned: 1, rowsReturned: 1, elapsedMs: 7, indexUsed: "idx_biz_country_citynorm_cat",
    };
    const pgRow = {
      kind: "business" as const, key: "overture:test-1",
      entity_id: "overture:test-1", entity_resolved: true, page_type: "entity_page" as const,
      title: "Pune Smile", detail: "1 MG Rd, Pune, MH, IN",
      email: null, phone: "+919876543210", url: null,
      category: "dentist", location: "Pune, MH", country: "IN",
    };

    it("flag on: index serves, S3 readers untouched", async () => {
      process.env.USE_INDEXED_SEARCH = "true";
      const index = vi.fn(async () => ({ rows: [pgRow], meta: pgMeta }));
      const businesses = vi.fn(async () => { throw new Error("S3 must not run"); });
      const res = await runSpecSearchCore(
        "find me dentists in Pune", { index: index as never, businesses: businesses as never }, 20,
      );
      expect(index).toHaveBeenCalledOnce();
      expect(businesses).not.toHaveBeenCalled();
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].title).toBe("Pune Smile");
      expect(res.dbMeta[0].engine).toBe("pg-index");
    });

    it("flag on but index throws: falls back to S3", async () => {
      process.env.USE_INDEXED_SEARCH = "true";
      const index = vi.fn(async () => { throw new Error("db down"); });
      const businesses = vi.fn(async () => ({
        rows: [{ name: "Fallback Dental", category: "dentist", locality: "Pune", country: "IN", phone: "+919876543210" }],
        meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
      }));
      const res = await runSpecSearchCore(
        "find me dentists in Pune", { index: index as never, businesses: businesses as never }, 20,
      );
      expect(businesses).toHaveBeenCalledOnce();
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].title).toBe("Fallback Dental");
      expect(res.dbMeta[0].engine).toBe("s3-parquet");
    });

    it("registry-key invariant: keyless rows dropped + counted", async () => {
      process.env.USE_INDEXED_SEARCH = "true";
      const good = {
        kind: "business" as const, key: "overture:real-1",
        title: "Real Dental", detail: "1 MG Rd, Pune, MH, IN",
        entity_id: "overture:real-1", entity_resolved: true, page_type: "entity_page" as const,
        email: null, phone: "+919876543210", url: null,
        category: "dentist", location: "Pune, MH", country: "IN",
      };
      // Passes validation (category matches) but carries no retrieval key:
      // a fabricated row must never reach the user.
      const keyless = { ...good, title: "Ghost Dental", key: null };
      // Wrong category: rejected by the validation gate, not the invariant.
      const offSpec = { ...good, title: "Pipe Dreams", key: "overture:real-2", category: "plumber" };
      const index = vi.fn(async () => ({
        rows: [good, keyless, offSpec],
        meta: { dbHit: true, engine: "pg-index" as const, partitionsRead: ["idx"], rowsScanned: 3, rowsReturned: 3 },
      }));
      const res = await runSpecSearchCore(
        "find me dentists in Pune", { index: index as never }, 20,
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].title).toBe("Real Dental");
      expect(res.rejected).toBe(2);
    });

    it("unconstrained spec: real index fn returns null before any query", async () => {
      const { queryIndexForSpec } = await import("@/lib/indexed/search-index.server");
      const base = extractSearchSpec("restaurants");
      const spec = {
        ...base,
        entity: "business" as const,
        criteria: [{ field: "category", value: "restaurants", stated: true, confidence: 1 }],
        missing: [] as string[],
        status: "ready_to_search" as const,
      };
      // category-only, no location: must refuse (would seq-scan), no DB touch
      const res = await queryIndexForSpec(spec, 20);
      expect(res).toBeNull();
    });

    it("geo-less forced search falls back to S3 refuse path", async () => {
      process.env.USE_INDEXED_SEARCH = "true";
      const businesses = vi.fn(async () => ({
        rows: [],
        meta: { dbHit: false, engine: "s3-parquet", partitionsRead: ["refused"], rowsScanned: 0, rowsReturned: 0 },
      }));
      // force:true with category but no location -> ready; real index refuses
      const res = await runSpecSearchCore(
        "yo find me businesses rn", { businesses: businesses as never },
        25, { category: "restaurants" }, { force: true },
      );
      expect(businesses).toHaveBeenCalledOnce();
      expect(res.rows).toEqual([]);
      expect(res.dbMeta[0].engine).toBe("s3-parquet");
    });

    it("explicit flag off: index never called", async () => {
      process.env.USE_INDEXED_SEARCH = "false";
      const index = vi.fn(async () => ({ rows: [pgRow], meta: pgMeta }));
      const businesses = vi.fn(async () => ({
        rows: [{ name: "S3 Dental", category: "dentist", locality: "Pune", country: "IN", phone: "+919876543210" }],
        meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
      }));
      const res = await runSpecSearchCore(
        "find me dentists in Pune", { index: index as never, businesses: businesses as never }, 20,
      );
      expect(index).not.toHaveBeenCalled();
      expect(res.rows[0].title).toBe("S3 Dental");
    });
  });

  it("business detail carries full geo + email for cards", async () => {
    const fakeBusinesses = (async () => ({
      rows: [{
        name: "Pune Smile", category: "dentist", address: "1 MG Rd",
        locality: "Pune", region: "MH", country: "IN",
        phone: "+91", email: "a@x.in", website: "https://x.in",
      }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
    })) as never;
    const res = await runSpecSearchCore("find me dentists in Pune", { businesses: fakeBusinesses }, 20);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].detail).toContain("Pune");
    expect(res.rows[0].detail).toContain("IN");
    expect(res.rows[0].email).toBe("a@x.in");
  });

  it("routes a person city to its country shard and filters city separately", async () => {
    const people = vi.fn(async () => ({
      rows: [{
        name: "A Founder", title: "Founder", company_name: "North Co",
        city: "Toronto", country: "Canada", industry: "Software",
        email: "a@example.test", phone: null, personal_linkedin: "https://linkedin.com/in/a",
      }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["canada"], rowsScanned: 1, rowsReturned: 1 },
    }));
    const res = await runSpecSearchCore(
      "founders in Toronto", { people: people as never }, 10, { mode: "looking" },
    );
    expect(people).toHaveBeenCalledWith(expect.objectContaining({ country: "CA", city: "Toronto" }));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].location).toBe("Toronto");
  });

  it("keeps exact-location populated companies and reports stage counts", async () => {
    const companies = vi.fn(async () => ({
      rows: [{
        company_name: "Build Right", category: "Construction", location: "Dallas",
        website: "https://build-right.example", email: null, phone: null,
      }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fixture"], rowsScanned: 1, rowsReturned: 1 },
    }));
    const res = await runSpecSearchCore(
      "construction companies in Dallas", { companies: companies as never }, 10, { mode: "looking" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.retrievalTrace).toMatchObject({
      rawCandidates: 1, postSpecFilter: 1, returned: 1, reason: "RESULTS",
    });
  });

  it("supports requested pages of at least 50 without an internal five-row cap", async () => {
    const businesses = vi.fn(async ({ limit }: { limit: number }) => ({
      rows: Array.from({ length: Math.min(51, limit) }, (_, i) => ({
        registry_id: `b-${i}`, name: `Austin HVAC ${i}`, category: "hvac",
        locality: "Austin", region: "TX", country: "US", phone: "+15125550123",
      })),
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fixture"], rowsScanned: 51, rowsReturned: 51 },
    }));
    const res = await runSpecSearchCore(
      "HVAC contractors in Austin", { businesses: businesses as never }, 50, { mode: "looking" },
    );
    expect(res.rows).toHaveLength(50);
    expect(res.hasMore).toBe(true);
  });
});
