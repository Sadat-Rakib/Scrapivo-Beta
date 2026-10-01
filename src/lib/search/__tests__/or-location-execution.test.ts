import { describe, expect, it } from "vitest";
import { rowCouldSatisfySpec, rowSatisfiesSpec, runSpecSearchCore, type SpecRow } from "@/lib/spec-search.functions";
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
    const dhaka: SpecRow = { kind: "company", title: "Example", detail: "Dhaka, Bangladesh", location: "Dhaka", country: "BD" };
    expect(rowSatisfiesSpec(spec, dhaka)).toBe(true);
    expect(rowCouldSatisfySpec(spec, dhaka)).toBe(true);
  });

  it("rejects a row outside both locations", () => {
    const outside: SpecRow = { kind: "company", title: "Example", detail: "Porto, Portugal", location: "Porto", country: "PT" };
    expect(rowSatisfiesSpec(spec, outside)).toBe(false);
    expect(rowCouldSatisfySpec(spec, outside)).toBe(false);
  });

  it("passes each alternative location to retrieval", async () => {
    const searched: string[] = [];
    const companies = (async (request: { location?: string }) => {
      searched.push(request.location ?? "");
      return { rows: [], meta: { dbHit: false, engine: "s3-parquet", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } };
    }) as never;
    await runSpecSearchCore(spec.raw_query, { companies, index: null, liveGapfill: null }, 5, {}, { spec, force: true });
    expect(searched).toEqual(["Chattogram", "Dhaka"]);
  });
});
