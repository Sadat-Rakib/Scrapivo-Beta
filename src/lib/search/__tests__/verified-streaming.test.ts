import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";
import { discoverWithBrowser, type BrowserExtractedEntity } from "../browser-live.server";

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders", criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }],
  missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const url = "https://publisher.test/founders";
const text = "SaaS founders. Amina Carter is the founder of Acme, a software-as-a-service company in Toronto. Ben Okafor is the founder of Ledgerly, a software-as-a-service company in Lagos.";

function browser(): AgentBrowser {
  const snap: PageSnapshot = { url, title: "SaaS founders", pageType: "entity_detail", headings: [], visibleRelevantText: text, links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
  const observation = () => ({ snapshot: snap, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async () => ({ id: "t", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 60, pages: 20, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => ({ snapshot: { ...snap, url: "https://duckduckgo.com/html/?q=x", links: [{ ref: "l0", name: "SaaS founders", url }] }, action: "search", verified: true })),
    navigate: vi.fn(async () => observation()), observe: vi.fn(async () => snap),
    click: vi.fn(async () => observation()), type: vi.fn(async () => observation()), select: vi.fn(async () => observation()),
    scroll: vi.fn(async () => observation()), waitFor: vi.fn(async () => observation()),
    extract: vi.fn(async () => ({ values: { body: text }, sourceUrl: url, observedAt: "", errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}
const person = (name: string, company: string): BrowserExtractedEntity => {
  const quote = `${name} is the founder of ${company}, a software-as-a-service company`;
  return { page: 0, kind: "person", name, identityQuote: quote, fields: { role: { value: "founder", quote }, company: { value: company, quote } } };
};

describe("progressive verified rows", () => {
  it("streams every lead that verifies, once, even when it verifies outside its own research turn", async () => {
    const events: string[] = [];
    // Both leads verify the moment they are extracted (before research runs).
    const rows = await discoverWithBrowser(spec, { browser: browser(), discoveryQueries: ["SaaS founders"], isVerified: (row) => !!row.company,
      extractEntities: async () => [person("Amina Carter", "Acme"), person("Ben Okafor", "Ledgerly")],
      onProgress: (event) => { if (event.row) events.push(event.row.title); } });
    expect(rows).toHaveLength(2);
    expect(events.sort()).toEqual(["Amina Carter", "Ben Okafor"]);
  });

  it("publishes nothing after cancellation", async () => {
    const abort = new AbortController();
    const events: string[] = [];
    await discoverWithBrowser(spec, { browser: browser(), discoveryQueries: ["SaaS founders"], isVerified: (row) => !!row.company, signal: abort.signal,
      extractEntities: async () => { abort.abort(); return [person("Amina Carter", "Acme")]; },
      onProgress: (event) => { if (event.row) events.push(event.row.title); } }).catch(() => undefined);
    expect(events).toEqual([]);
  });
});
