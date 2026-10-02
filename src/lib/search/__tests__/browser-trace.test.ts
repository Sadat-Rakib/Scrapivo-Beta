import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";
import { browserEntitiesToRows, discoverWithBrowser, type BrowserExtractedEntity, type BrowserObservedPage, type BrowserTraceEvent } from "../browser-live.server";

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders in Canada", criteria: [], missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const text = "Amina Carter is the founder of Acme, a software-as-a-service company in Toronto, Canada.";
const page: BrowserObservedPage = { url: "https://acme.test/team", title: "Our team", text };
const entity: BrowserExtractedEntity = { page: 0, kind: "person", name: "Amina Carter", identityQuote: text,
  fields: { role: { value: "founder", quote: text }, company: { value: "Acme", quote: text } } };

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return { url: page.url, title: "Our team", pageType: "entity_detail", headings: [], visibleRelevantText: "Team page text ".repeat(20), links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [], ...overrides };
}

// Page bodies under 100 characters count as thin; keep the fixture realistic.
const body = `${text} The Acme team builds reporting tools for finance teams across Canada.`;

function fakeBrowser(pageSnapshot: (url: string) => PageSnapshot): AgentBrowser {
  let current = snapshot();
  const observation = (value: PageSnapshot) => ({ snapshot: value, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async (options = {}) => ({ id: options.id ?? "t", visible: false, createdAt: new Date().toISOString(), screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 30, pages: 8, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    // The SERP result must share a query term: discovery now runs the user's
    // real query (C8) and serpResultShares drops zero-overlap results BEFORE
    // a navigation is spent — the old empty-query fixture bypassed that gate.
    search: vi.fn(async () => observation(snapshot({ url: "https://duckduckgo.com/?q=x", pageType: "search_results", links: [{ ref: "", name: "SaaS founders in Canada — Acme team", url: page.url }] }))),
    navigate: vi.fn(async (_s, url) => observation(current = pageSnapshot(url))),
    observe: vi.fn(async () => current),
    click: vi.fn(async () => observation(current)), type: vi.fn(async () => observation(current)), select: vi.fn(async () => observation(current)),
    scroll: vi.fn(async () => observation(current)), waitFor: vi.fn(async () => observation(current)),
    extract: vi.fn(async () => ({ values: { body }, sourceUrl: current.url, observedAt: new Date().toISOString(), errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}

const collect = () => {
  const events: BrowserTraceEvent[] = [];
  return { events, onTrace: (event: BrowserTraceEvent) => events.push(event) };
};

describe("browser lifecycle trace", () => {
  it("reports each entity rejection with a structured reason", () => {
    const { events, onTrace } = collect();
    const rows = browserEntitiesToRows([
      { ...entity, identityQuote: "Amina Carter founded a company that is not on this page at all." },
      { ...entity, name: "Ben Miller" },
      { page: 3, kind: "person", name: "Ghost", identityQuote: "Ghost is a founder somewhere." },
      { page: 0, kind: "person", name: "Amina Carter", identityQuote: "Acme, a software-as-a-service company in Toronto, Canada." },
      entity,
    ], [page], onTrace);
    expect(rows.map((row) => row.title)).toEqual(["Amina Carter"]);
    const entityEvents = events.filter((event) => event.kind === "entity") as Extract<BrowserTraceEvent, { kind: "entity" }>[];
    expect(entityEvents.map((event) => [event.outcome, event.reason ?? null, event.detail ?? null])).toEqual([
      ["rejected", "PROVENANCE_INCOMPLETE", "identity_quote_not_on_page"],
      ["rejected", "PROVENANCE_INCOMPLETE", "identity_quote_missing_name"],
      ["rejected", "PROVENANCE_INCOMPLETE", "page_index_unknown"],
      ["rejected", "PROVENANCE_INCOMPLETE", "identity_quote_missing_name"],
      ["row", null, null],
    ]);
  });

  it("reports a kind the quotes do not support as ENTITY_TYPE_MISMATCH", () => {
    const { events, onTrace } = collect();
    const bare = "Amina Carter lives in Toronto and likes running.";
    browserEntitiesToRows([{ page: 0, kind: "person", name: "Amina Carter", identityQuote: bare }], [{ ...page, text: bare }], onTrace);
    expect(events).toContainEqual(expect.objectContaining({ kind: "entity", outcome: "rejected", reason: "ENTITY_TYPE_MISMATCH" }));
  });

  it("traces an irrelevant page and an empty extractor without changing results", async () => {
    const { events, onTrace } = collect();
    const browser = fakeBrowser((url) => snapshot({ url: `${url.replace(/\/team$/, "")}/privacy-policy`, title: "Privacy Policy" }));
    const rows = await discoverWithBrowser(spec, { browser, onTrace, extractEntities: async () => [] });
    expect(rows).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ kind: "page", outcome: "irrelevant", requestedUrl: page.url }));
    expect(events.some((event) => event.kind === "done")).toBe(true);
  });

  it("traces a read page, the extractor, and an accepted candidate", async () => {
    const { events, onTrace } = collect();
    const browser = fakeBrowser((url) => snapshot({ url }));
    const rows = await discoverWithBrowser(spec, { browser, onTrace, extractEntities: async () => [entity] });
    expect(rows).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ kind: "page", outcome: "read", origin: "discovery", requestedUrl: page.url }));
    expect(events).toContainEqual(expect.objectContaining({ kind: "extract", extractor: "injected", entities: 1 }));
    expect(events).toContainEqual(expect.objectContaining({ kind: "remember", name: "Amina Carter", outcome: "accepted" }));
    expect(events).toContainEqual(expect.objectContaining({ kind: "candidate", name: "Amina Carter" }));
  });

  it("traces a blocked page and a failing trace hook never breaks discovery", async () => {
    const browser = fakeBrowser((url) => snapshot({ url, friction: ["CAPTCHA"] }));
    const seen: string[] = [];
    const rows = await discoverWithBrowser(spec, { browser, extractEntities: async () => [entity],
      onTrace: (event) => { seen.push(`${event.kind}:${"outcome" in event ? event.outcome : ""}`); throw new Error("trace sink down"); } });
    expect(Array.isArray(rows)).toBe(true);
    expect(seen).toContain("page:blocked");
  });
});

it("accepts a solar-installation business card — trade vocabulary covers the entity-kind gate (Windhoek regression)", () => {
  const { events, onTrace } = collect();
  const solarText = "SolarTech Namibia installs photovoltaic systems. Solar panel installation and maintenance in Windhoek, Namibia — SolarTech Namibia serves homes and businesses across Namibia.";
  const rows = browserEntitiesToRows([
    { page: 0, kind: "business", name: "SolarTech Namibia", identityQuote: solarText,
      fields: { category: { value: "solar installer", quote: solarText }, location: { value: "Windhoek", quote: solarText } } },
  ], [{ ...page, text: solarText }], onTrace);
  expect(rows.map((row) => row.title)).toEqual(["SolarTech Namibia"]);
  expect(events).not.toContainEqual(expect.objectContaining({ kind: "entity", outcome: "rejected", reason: "ENTITY_TYPE_MISMATCH" }));
});
