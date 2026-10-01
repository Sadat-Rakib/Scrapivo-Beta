import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";
import { extractStructuredFacts, factsFromJsonLdText, JSONLD_BLOCK_SEPARATOR } from "../page-structured";
import { discoverWithBrowser, structuredBusinessRows, type BrowserTraceEvent } from "../browser-live.server";

const listing = (name: string, locality: string, extra: Record<string, unknown> = {}) => ({
  "@type": "ListItem", position: 1,
  item: { "@type": "Restaurant", name, telephone: "+1 403-555-0100", url: `https://www.restaurantji.com/ab/${locality.toLowerCase()}/${name.toLowerCase().replace(/\W+/g, "-")}/`,
    address: { "@type": "PostalAddress", streetAddress: "100 Main St", addressLocality: locality, addressRegion: "AB", addressCountry: "CA" }, ...extra },
});
const itemList = (items: unknown[]) => JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: items });

describe("structured local-business facts", () => {
  it("reads literal ItemList restaurant entries without treating them as the page organization", () => {
    const html = `<script type="application/ld+json">${itemList([listing("Model Milk", "Calgary"), listing("Bridgette Bar", "Calgary"), { "@type": "ListItem", item: { "@type": "Restaurant" } }])}</script>`;
    const facts = extractStructuredFacts(html);
    expect(facts.businesses?.map((b) => [b.name, b.types[0], b.locality, b.region, b.telephone])).toEqual([
      ["Model Milk", "Restaurant", "Calgary", "AB", "+1 403-555-0100"],
      ["Bridgette Bar", "Restaurant", "Calgary", "AB", "+1 403-555-0100"],
    ]);
    expect(facts.organizationName).toBeNull();
    expect(facts.phones).toEqual([]);
  });

  it("parses several JSON-LD blocks joined by the block separator", () => {
    const text = [JSON.stringify({ "@type": "WebSite", name: "Directory" }), "{not json", itemList([listing("Model Milk", "Calgary")])].join(JSONLD_BLOCK_SEPARATOR);
    expect(factsFromJsonLdText(text).businesses?.map((b) => b.name)).toEqual(["Model Milk"]);
  });

  it("reads @graph local-business nodes and skips non-business types", () => {
    const text = JSON.stringify({ "@graph": [{ "@type": "Organization", name: "Publisher Inc" }, { "@type": ["Dentist", "LocalBusiness"], name: "Bow Valley Dental", address: { addressLocality: "Canmore" } }] });
    expect(factsFromJsonLdText(text).businesses?.map((b) => [b.name, b.locality])).toEqual([["Bow Valley Dental", "Canmore"]]);
  });
});

const spec: SearchSpec = { entity: "business", raw_query: "Restaurants in Calgary, Alberta", criteria: [
  { field: "category", value: "restaurant", stated: true, confidence: 1 }, { field: "location", value: "Calgary", stated: true, confidence: 1 },
], missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const page = "https://www.restaurantji.com/ab/calgary/";
const jsonld = itemList([listing("Model Milk", "Calgary"), listing("Bridgette Bar", "Calgary"), listing("Pigeonhole", "Calgary"), listing("Airdrie Diner", "Airdrie")]);

function browser(): AgentBrowser {
  const snap: PageSnapshot = { url: page, title: "THE 30 BEST Restaurants in Calgary", pageType: "directory", headings: [], visibleRelevantText: "Best restaurants in Calgary. ".repeat(20), links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
  const observation = () => ({ snapshot: snap, action: "navigate", verified: true });
  const serp: PageSnapshot = { ...snap, url: "https://duckduckgo.com/html/?q=x", pageType: "search_results" };
  return {
    createSession: vi.fn(async () => ({ id: "t", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 60, pages: 20, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => ({ snapshot: serp, action: "search", verified: true })),
    navigate: vi.fn(async () => observation()), observe: vi.fn(async () => snap),
    click: vi.fn(async () => observation()), type: vi.fn(async () => observation()), select: vi.fn(async () => observation()),
    scroll: vi.fn(async () => observation()), waitFor: vi.fn(async () => observation()),
    extract: vi.fn(async () => ({ values: { body: snap.visibleRelevantText, jsonld }, sourceUrl: page, observedAt: new Date().toISOString(), errors: [] })),
    extractLinks: vi.fn(async () => [{ ref: "", name: "THE 30 BEST Restaurants in Calgary", url: page }]),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}

describe("list-page location context", () => {
  const page = (title: string, items: unknown[]) => ({ url: "https://www.tripadvisor.ca/Restaurants-g154913-Calgary_Alberta.html", title, text: "restaurants",
    structured: factsFromJsonLdText(itemList(items)) });
  const bare = (name: string) => ({ "@type": "ListItem", item: { "@type": "Restaurant", name } });

  it("gives address-less list entries the city the list page itself is titled for, as separate lower-confidence evidence", () => {
    const rows = structuredBusinessRows([page("THE 10 BEST Restaurants in Calgary (Updated 2026)", [bare("Ten Foot Henry")])], spec);
    expect(rows[0]).toMatchObject({ title: "Ten Foot Henry", location: "Calgary" });
    const context = rows[0].evidence?.find((item) => item.extraction_method === "json_ld_list_page_context");
    expect(context).toMatchObject({ confidence: 0.6 });
    expect(context?.excerpt).toContain("THE 10 BEST Restaurants in Calgary");
  });

  it("never applies page context when the page title does not name the requested place, or to entries with their own address", () => {
    expect(structuredBusinessRows([page("Best restaurants near you", [bare("Ten Foot Henry")])], spec)[0].location ?? null).toBeNull();
    const own = structuredBusinessRows([page("THE 10 BEST Restaurants in Calgary", [listing("Model Milk", "Calgary")])], spec)[0];
    expect(own.evidence?.some((item) => item.extraction_method === "json_ld_list_page_context")).toBe(false);
  });
});

describe("deterministic business candidates from a directory page", () => {
  it("remembers literal structured listings, skips location contradictions, and never sets a website from a directory", async () => {
    const events: BrowserTraceEvent[] = [];
    const extractor = vi.fn(async () => []);
    const rows = await discoverWithBrowser(spec, { browser: browser(), discoveryQueries: ["restaurants Calgary"], extractEntities: extractor,
      isVerified: () => false, onTrace: (event) => events.push(event) });
    expect(rows.map((row) => row.title).sort()).toEqual(["Bridgette Bar", "Model Milk", "Pigeonhole"]);
    const row = rows.find((item) => item.title === "Model Milk")!;
    expect(row).toMatchObject({ kind: "business", category: "restaurant", location: "Calgary, AB", country: "CA", phone: "+1 403-555-0100", source_url: page, entity_resolved: true });
    expect(row.website_url ?? null).toBeNull();
    expect(row.evidence?.[0]).toMatchObject({ extraction_method: "json_ld_local_business", source_url: page });
    expect(row.evidence?.[0].excerpt).toContain("Model Milk");
    expect(events).toContainEqual(expect.objectContaining({ kind: "entity", name: "Airdrie Diner", outcome: "rejected", reason: "LOCATION_MISMATCH" }));
    // Three literal listings are enough: the model extractor is not called for that page.
    expect(extractor).not.toHaveBeenCalled();
  });
});
