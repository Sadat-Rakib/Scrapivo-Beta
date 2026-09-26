/** Phase 1.3: mode gate battery. Bare directory queries must ask mode BEFORE
 *  retrieval; offer only follows selling; just-looking never sees the offer
 *  question; explicit signals and force bypass. No network (injected fakes). */
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
  it("bare SaaS founders asks intent, then location before retrieval", async () => {
    const res = await runSpecSearchCore("SaaS founders", { people: fakePeople, index: null, liveGapfill: null });
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.rows).toEqual([]);
    expect(res.dbMeta).toEqual([]);
    expect(res.clarify.map((q) => q.id)).toEqual(["entity_mode"]);

    const afterMode = await runSpecSearchCore(
      "SaaS founders",
      { people: fakePeople, index: null, liveGapfill: null },
      25,
      { mode: "looking" },
    );
    expect(afterMode.dbMeta).toEqual([]);
    expect(afterMode.clarify.map((q) => q.id)).toEqual(["entity_location"]);
  });
  it("bare ready business query → exactly the mode question, zero retrieval", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
    );
    expect(res.spec.status).toBe("ready_to_search");
    expect(res.rows).toEqual([]);
    expect(res.clarify).toHaveLength(1);
    expect(res.clarify[0].id).toBe("entity_mode");
  });

  it("looking answer → search runs, offer question never appears", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "looking" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
  });

  it("selling without offer → exactly the offer question", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling" },
    );
    expect(res.rows).toEqual([]);
    expect(res.clarify).toHaveLength(1);
    expect(res.clarify[0].id).toBe("entity_offer");
  });

  it("selling + non-taxonomy offer → search runs with no follow-up", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "consulting" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.clarify).toEqual([]);
  });

  it("mode answer naming the offering skips the offer round (site follow-up next)", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "websites" },
    );
    // Offer inferred from the answer; the website follow-up is the one round.
    expect(res.rows).toEqual([]);
    expect(res.clarify).toHaveLength(1);
    expect(res.clarify[0].id).toBe("entity_site");
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
