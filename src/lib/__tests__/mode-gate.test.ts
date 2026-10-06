/** Legacy answer utilities plus the current frame-owned discovery contract.
 * Explicit targets search directly; selling context never forces a funnel. */
import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";
import {
  detectModeFromQuery,
  interpretModeAnswer,
} from "@/lib/search/mode-gate";

const fakeBusinesses = (async () => ({
  rows: [{
    registry_id: "db:business:pune-smile-dental",
    name: "Pune Smile Dental", category: "dentist",
    address: "1 FC Rd", locality: "Pune", region: "MH", country: "IN",
    website: "https://punesmiledental.example",
  }],
  meta: {
    dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"],
    rowsScanned: 1, rowsReturned: 1,
  },
})) as never;

const fakePeople = (async () => ({
  rows: [],
  meta: { dbHit: false, engine: "s3-parquet", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 },
})) as never;

describe("detectModeFromQuery", () => {
  it("bare query → null (must ask)", () => {
    expect(detectModeFromQuery("dentists in Pune")).toBeNull();
    expect(detectModeFromQuery("plumbers in Austin")).toBeNull();
  });
  it("browsing signals → looking", () => {
    expect(detectModeFromQuery("I need SaaS founders in New York")).toBe("looking");
    expect(detectModeFromQuery("find me dentists in Pune")).toBe("looking");
    expect(detectModeFromQuery("just looking for cafes")).toBe("looking");
    expect(detectModeFromQuery("yo need founders i can reach out to rn")).toBe("looking");
  });
  it("seller signals → selling (seller markers win over looking phrases)", () => {
    expect(detectModeFromQuery("I sell websites")).toBe("selling");
    expect(detectModeFromQuery("find clients for my web design agency")).toBe("selling");
    expect(detectModeFromQuery("I'm trying to sell my marketing service")).toBe("selling");
  });
});

describe("interpretModeAnswer", () => {
  it("option ids pass through", () => {
    expect(interpretModeAnswer("looking")).toEqual({ mode: "looking" });
    expect(interpretModeAnswer("selling")).toEqual({ mode: "selling" });
  });
  it("offering-naming free text → selling + offer (skips redundant round)", () => {
    expect(interpretModeAnswer("websites")).toEqual({ mode: "selling", offer: "websites" });
  });
});

describe("mode gate in runSpecSearchCore", () => {
  it("bare SaaS founders preserves broad role and industry without a mode funnel", async () => {
    const res = await runSpecSearchCore("SaaS founders", { people: fakePeople, index: null, liveGapfill: null });
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.rows).toEqual([]);
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).toEqual(["entity_location"]);
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "role", value: "founder" }));
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "industry", value: expect.stringMatching(/^saas$/i) }));
    expect(res.spec.criteria.some((c) => c.field === "location")).toBe(false);

    const afterMode = await runSpecSearchCore(
      "SaaS founders",
      { people: fakePeople, index: null, liveGapfill: null },
      25,
      { mode: "looking" },
    );
    expect(afterMode.dbMeta.length).toBeGreaterThan(0);
    expect(afterMode.clarify.map((q) => q.id)).toEqual(["entity_location"]);
  });
  it("bare ready business query searches the stated category and city directly", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
    );
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "category", value: "dentist" }));
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "location", value: "Pune" }));
  });

  it("looking answer → search runs, offer question never appears", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "looking" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
  });

  it("selling without an offer keeps an already specified target searchable", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
    expect(res.spec.criteria.some((c) => c.field === "opportunity")).toBe(false);
  });

  it("selling + non-taxonomy offer → search runs with no follow-up", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "consulting" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
  });

  it("an offering answer stays user context and does not invent a site requirement", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { offer: "websites" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
    expect(res.spec.criteria.some((c) => c.field === "offer" && c.value === "websites")).toBe(true);
  });

  it("force bypasses the gate (explicit Search button)", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      {}, { force: true },
    );
    expect(res.rows).toHaveLength(1);
  });

  it("browsing-signal query is not gated (no unnecessary questions)", async () => {
    const res = await runSpecSearchCore(
      "find me dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
  });

  it("incomplete spec keeps missing-field panel (mode arrives next round)", async () => {
    const res = await runSpecSearchCore(
      "bro i need businesses plz asap", { index: null }, 25,
    );
    expect(res.spec.status).toBe("needs_clarification");
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_offer");
  });
});
