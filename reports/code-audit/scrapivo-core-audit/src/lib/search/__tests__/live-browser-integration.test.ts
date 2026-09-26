import { describe, expect, it, vi } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { runLiveGapfill } from "../live-gapfill";
import type { SpecRow } from "@/lib/spec-search.functions";

const spec = extractSearchSpec("cafes in Toronto without a website");
const row = (key: string): SpecRow => ({
  kind: "business",
  title: key,
  detail: "Toronto",
  location: "Toronto",
  category: "cafe",
  key,
  entity_id: key,
  entity_resolved: true,
  page_type: "entity_page",
  url: null,
  phone: "+1-416-555-0199",
  opportunity: "no_website",
});

describe("live browser integration", () => {
  it("invokes browser even when OSM succeeds and merges canonical rows", async () => {
    const browser = vi.fn(async () => [row("browser:one"), row("osm:one")]);
    const result = await runLiveGapfill(spec, {
      osm: async () => [row("osm:one")],
      web: null,
      jobs: null,
      browser,
      searchRunId: "run_browser_test",
    });
    expect(browser).toHaveBeenCalledWith(
      spec,
      expect.objectContaining({
        searchRunId: "run_browser_test",
        researchPlan: expect.objectContaining({ discoveryQueries: expect.any(Array) }),
        initialCandidates: expect.any(Array),
      }),
    );
    expect(result.rows.map((r) => r.key).sort()).toEqual(["browser:one", "osm:one"]);
    expect(result.diagnostics?.find((d) => d.provider === "browser-live")?.artifactsFound).toBe(2);
  });

  it("keeps browser rows after web failure", async () => {
    const companySpec = extractSearchSpec("find SaaS companies in Toronto");
    const result = await runLiveGapfill(companySpec, {
      osm: null,
      jobs: null,
      web: async () => { throw new Error("SearXNG down"); },
      browser: async () => [{ ...row("browser:company"), kind: "company" }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.engine).toBe("live-browser");
    expect(result.diagnostics?.some((d) => d.outcome === "SOURCE_ERROR")).toBe(true);
  });

  it("keeps distinct people discovered on the same page", async () => {
    const peopleSpec = extractSearchSpec("find SaaS founders in Toronto");
    const result = await runLiveGapfill(peopleSpec, {
      osm: null,
      jobs: null,
      web: null,
      browser: async () => [
        { ...row("person:one"), kind: "person", url: "https://example.com/team" },
        { ...row("person:two"), kind: "person", url: "https://example.com/team" },
      ],
    });
    expect(result.rows.map((r) => r.key)).toEqual(["person:one", "person:two"]);
  });

  it("rethrows cancellation after both providers settle", async () => {
    const controller = new AbortController();
    await expect(runLiveGapfill(spec, {
      osm: async () => { controller.abort(); return []; },
      browser: async () => [],
      signal: controller.signal,
    })).rejects.toThrow("SEARCH_CANCELLED");
  });

  it("browser null disables browser discovery", async () => {
    const result = await runLiveGapfill(spec, {
      osm: async () => [row("osm:only")],
      web: null,
      jobs: null,
      browser: null,
    });
    expect(result.rows.map((r) => r.key)).toEqual(["osm:only"]);
    expect(result.diagnostics?.find((d) => d.provider === "browser-live")?.attempted).toBe(false);
  });

  it("structured web query does not launder query location into row fields", async () => {
    const companySpec = extractSearchSpec("find SaaS companies in Toronto");
    const result = await runLiveGapfill(companySpec, {
      osm: null,
      jobs: null,
      browser: null,
      web: async (_query, _location, _entity, specArg) => {
        const { evidenceFromWebHit } = await import("../live-gapfill");
        return [{
          kind: "company",
          title: "Example CRM",
          detail: "Public CRM product",
          key: "web:example",
          entity_id: "web:example",
          entity_resolved: false,
          page_type: "unknown",
          url: "https://example.com",
          location: null,
          country: null,
          evidence: specArg ? evidenceFromWebHit({
            title: "Example CRM",
            snippet: "Public CRM product",
            url: "https://example.com",
            spec: specArg,
          }) : [],
        }];
      },
    });
    expect(result.rows[0].location).toBeNull();
    expect(result.rows[0].detail).not.toContain("Toronto");
  });
});
