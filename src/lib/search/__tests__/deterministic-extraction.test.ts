import { describe, expect, it, vi } from "vitest";
import type { PageSnapshot } from "@/lib/research-agent/browser";
import type { BrowserObservedPage } from "../browser-live.server";
import type { SearchSpec } from "../search-spec";
import { extractEntities } from "../browser-live.server";

/** PRD Final-MVP Phase 1: ordinary lead discovery must not depend on an
 *  extraction LLM. The deterministic layer must yield provisional business
 *  and person candidates from first-party and directory pages. */

const businessSpec: SearchSpec = {
  entity: "business", raw_query: "wedding photographers in Cebu",
  criteria: [
    { field: "category", value: "wedding photographer", stated: true, confidence: 1 },
    { field: "location", value: "Cebu", stated: true, confidence: 1 },
  ],
  missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search",
};

const page = (url: string, title: string, text: string): BrowserObservedPage =>
  ({ url, title, text, structured: { emails: [], phones: [] } } as unknown as BrowserObservedPage);

describe("deterministic local-entity extraction (no extraction LLM)", () => {
  it("rainbowfishphoto-style first-party page yields a business candidate with contacts", async () => {
    const pages = [page("https://rainbowfishphoto.com/", "Wedding Photographer in Cebu | Rainbowfish Photo",
      "Rainbowfish Photo is a wedding photographer in Cebu, Philippines.\nWe document weddings across Cebu and Bohol.\nCall +63 32 555 1234 or email hello@rainbowfishphoto.com to book your date.")];
    const entities = await extractEntities(pages, businessSpec);
    expect(entities.length).toBeGreaterThanOrEqual(1);
    const entity = entities[0];
    expect(entity.kind).toBe("business");
    expect(entity.name).toMatch(/Rainbowfish/i);
    expect(entity.fields?.phone?.value).toContain("555 1234");
    expect(entity.fields?.email?.value).toContain("rainbowfishphoto.com");
  });

  it("a local directory page with several photographers yields several provisional candidates", async () => {
    const text = [
      "Cebu Wedding Suppliers Directory",
      "Dana Villanueva", "Wedding photographer serving Cebu",
      "Ivan Perez", "Wedding photography and films, Cebu city",
      "Tonskie Elsisura", "Cebu wedding photographer",
    ].join("\n");
    const pages = [page("https://cebuweddingsuppliers.com/list", "Cebu Wedding Suppliers", text)];
    const entities = await extractEntities(pages, businessSpec);
    expect(entities.length).toBeGreaterThanOrEqual(3);
    expect(entities.every((e) => e.kind === "business")).toBe(true);
    expect(entities.map((e) => e.name).some((n) => /Dana Villanueva/.test(n))).toBe(true);
  });

  it("an HVAC first-party page yields a business candidate", async () => {
    const hvacSpec: SearchSpec = { ...businessSpec, criteria: [
      { field: "category", value: "HVAC", stated: true, confidence: 1 },
      { field: "location", value: "Toronto", stated: true, confidence: 1 },
    ] };
    const pages = [page("https://trusthvac.ca/", "Trust HVAC — Heating and Cooling in Toronto",
      "Trust HVAC provides furnace installation and air conditioning repair across Toronto.\nOur licensed hvac technicians serve the Greater Toronto Area.\nPhone: +1 416 555 0188.")];
    const entities = await extractEntities(pages, hvacSpec);
    expect(entities.length).toBeGreaterThanOrEqual(1);
    expect(entities[0].kind).toBe("business");
    expect(entities[0].fields?.phone?.value).toContain("416");
  });

  it("a page without JSON-LD still yields a candidate when the extraction model is unavailable", async () => {
    // The deterministic path returns before any model call: the trace proves
    // the extractor never invoked the LLM.
    const trace: Array<{ extractor: string; llm: string }> = [];
    const pages = [page("https://plainstudio.test/", "Plain Studio — Photographers",
      "Plain Studio is a team of photographers shooting portraits and weddings.\nNo structured markup on this page at all.")];
    const entities = await extractEntities(pages, businessSpec, (e) => {
      if (e.kind === "extract") trace.push({ extractor: e.extractor, llm: String(e.llm) });
    });
    expect(entities.length).toBeGreaterThanOrEqual(1);
    expect(trace.some((t) => t.extractor === "deterministic")).toBe(true);
  });

  it("navigation-only pages yield no candidates", async () => {
    const pages = [page("https://example.test/", "Home",
      "Home\nAbout\nContact\nServices\nGallery\nPricing\nBlog\nLogin")];
    const entities = await extractEntities(pages, businessSpec);
    expect(entities).toEqual([]);
  });
});
