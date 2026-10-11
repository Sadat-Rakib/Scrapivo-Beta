import { describe, expect, it, vi } from "vitest";
import {
  rowCouldSatisfySpec,
  rowSatisfiesSpec,
  runSpecSearchCore,
  type SpecRow,
} from "@/lib/spec-search.functions";
import { buildSpec } from "../search-spec";

describe("OR location execution", () => {
  const spec = {
    ...buildSpec({
      entity: "company",
      criteria: [{ field: "location", value: "Chattogram", stated: true, confidence: 1 }],
      raw_query: "companies in Chattogram or Dhaka",
    }),
    locations: ["Chattogram", "Dhaka"],
  };

  it("keeps a row from either requested location", () => {
    const dhaka: SpecRow = {
      kind: "company",
      title: "Example",
      detail: "Dhaka, Bangladesh",
      location: "Dhaka",
      country: "BD",
    };
    expect(rowSatisfiesSpec(spec, dhaka)).toBe(true);
    expect(rowCouldSatisfySpec(spec, dhaka)).toBe(true);
  });

  it("rejects a row outside both locations", () => {
    const outside: SpecRow = {
      kind: "company",
      title: "Example",
      detail: "Porto, Portugal",
      location: "Porto",
      country: "PT",
    };
    expect(rowSatisfiesSpec(spec, outside)).toBe(false);
    expect(rowCouldSatisfySpec(spec, outside)).toBe(false);
  });

  it("passes each alternative location to retrieval", async () => {
    const searched: string[] = [];
    const companies = (async (request: { location?: string }) => {
      searched.push(request.location ?? "");
      return {
        rows: [],
        meta: {
          dbHit: false,
          engine: "s3-parquet",
          partitionsRead: [],
          rowsScanned: 0,
          rowsReturned: 0,
        },
      };
    }) as never;
    await runSpecSearchCore(
      spec.raw_query,
      { companies, index: null, liveGapfill: null },
      5,
      {},
      { spec, force: true },
    );
    expect(searched).toEqual(["Chattogram", "Dhaka"]);
  });

  it("shares the remaining adapter cap across actual location recursion", async () => {
    const budget = { adapterCalls: 63, contactCandidates: 12, paidCalls: 0 };
    const registry = vi.fn(async () => ({ fields: [] }));
    const companies = (async (request: { location?: string }) => ({
      rows: [
        {
          company_name: `Solar ${request.location}`,
          category: "Solar installers",
          location: request.location,
          website: null,
          email: null,
          phone: null,
        },
      ],
      meta: { dbHit: true, engine: "fixture", partitionsRead: [], rowsScanned: 1, rowsReturned: 1 },
    })) as never;
    await runSpecSearchCore(
      spec.raw_query,
      {
        companies,
        index: null,
        liveGapfill: null,
        enrichFn: null,
        enrichmentAdapters: { "registry-identity": registry },
      },
      5,
      {},
      { spec, force: true, enrichmentBudget: budget },
    );
    expect(registry).toHaveBeenCalledTimes(1);
    expect(budget.adapterCalls).toBe(64);
    expect(budget.contactCandidates).toBe(12);
  });

  it("does not spend site-contact budget on already complete location branches", async () => {
    const budget = { adapterCalls: 0, contactCandidates: 11, paidCalls: 0 };
    const contact = vi.fn(async (row: SpecRow) => ({ ...row, email: "hello@solar.example" }));
    const companies = (async (request: { location?: string }) => ({
      rows: [
        {
          company_name: `Solar ${request.location}`,
          category: "Solar installers",
          location: request.location,
          website: null,
          email: null,
          phone: null,
        },
      ],
      meta: { dbHit: true, engine: "fixture", partitionsRead: [], rowsScanned: 1, rowsReturned: 1 },
    })) as never;
    await runSpecSearchCore(
      spec.raw_query,
      {
        companies,
        index: null,
        liveGapfill: null,
        enrichFn: contact,
      },
      5,
      {},
      { spec, force: true, enrichmentBudget: budget },
    );
    expect(contact).not.toHaveBeenCalled();
    expect(budget.contactCandidates).toBe(11);
    expect(budget.adapterCalls).toBeLessThanOrEqual(64);
  });

  it("does not relabel a cancelled aggregate as the first successful location", async () => {
    const successfulCompanies = (async () => ({
      rows: [
        {
          company_name: "Chattogram Solar",
          category: "Solar installers",
          location: "Chattogram",
          website: "https://chattogram-solar.example",
          email: "hello@chattogram-solar.example",
          phone: null,
        },
      ],
      meta: {
        dbHit: true,
        engine: "fixture",
        partitionsRead: ["Chattogram"],
        rowsScanned: 1,
        rowsReturned: 1,
      },
    })) as never;
    const firstBranch = await runSpecSearchCore(
      spec.raw_query,
      {
        companies: successfulCompanies,
        index: null,
        liveGapfill: null,
      },
      5,
      {},
      {
        spec: { ...spec, locations: ["Chattogram"] },
        locationBranch: true,
        force: true,
      },
    );
    expect(firstBranch.outcome).toBe("QUALIFIED_RESULTS");
    expect(firstBranch.rows).toHaveLength(1);

    const controller = new AbortController();
    const searched: string[] = [];
    const companies = (async (request: { location?: string }) => {
      const location = request.location ?? "";
      searched.push(location);
      if (location === "Dhaka") controller.abort({ code: "SEARCH_STALE_RUN" });
      return {
        rows:
          location === "Chattogram"
            ? [
                {
                  company_name: "Chattogram Solar",
                  category: "Solar installers",
                  location,
                  website: "https://chattogram-solar.example",
                  email: "hello@chattogram-solar.example",
                  phone: null,
                },
              ]
            : [],
        meta: {
          dbHit: location === "Chattogram",
          engine: "fixture",
          partitionsRead: [location],
          rowsScanned: 1,
          rowsReturned: location === "Chattogram" ? 1 : 0,
        },
      };
    }) as never;
    const result = await runSpecSearchCore(
      spec.raw_query,
      {
        companies,
        index: null,
        liveGapfill: null,
        signal: controller.signal,
      },
      5,
      {},
      { spec, force: true },
    );
    expect(searched).toEqual(["Chattogram", "Dhaka"]);
    expect(result.rows).toEqual([]);
    expect(result.outcome).toBe("SEARCH_CANCELLED");
    expect(result.retrievalTrace).toMatchObject({ returned: 0, reason: "CANCELLED" });
    expect(result.candidateLedger?.counts.returned).toBe(0);
  });
});
