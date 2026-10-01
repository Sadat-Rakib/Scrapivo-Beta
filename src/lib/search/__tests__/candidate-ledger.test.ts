import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import { discoverWithBrowser } from "../browser-live.server";
import { createCandidateLedger, mergeCandidateLedgers, streamedFateLabel } from "../candidate-ledger";

describe("candidate ledger", () => {
  it("gives every candidate one fate and reconciles streamed leads with the final page", () => {
    const ledger = createCandidateLedger();
    ledger.streamed({ key: "browser:amina", entity_id: "browser:amina", title: "Amina Carter" });
    ledger.streamed({ key: "browser:ben", entity_id: "browser:ben", title: "Ben Okafor" });
    ledger.streamed({ key: "browser:chloe", entity_id: "browser:chloe", title: "Chloe Martin" });
    ledger.streamed({ key: "browser:dan", title: "Dan Wu" });
    ledger.decided({ key: "browser:ben", title: "Ben Okafor" }, { disposition: "rejected", reject_code: "MISSING_QUERY_REQUIRED" });
    ledger.decided({ key: "browser:amina", title: "Amina Carter" }, { disposition: "qualified" });
    ledger.incomplete({ key: "db:eve", title: "Eve Stone", missingFields: ["url"] });
    // A DB/live merge changed Amina's key; same entity id still matches.
    ledger.delivered([{ key: "db:amina-7", entity_id: "browser:amina", title: "Amina Carter" }], [{ key: "browser:chloe", title: "Chloe Martin" }]);
    const summary = ledger.summary();
    expect(summary.streamed).toBe(4);
    expect(summary.counts).toMatchObject({ returned: 1, qualified_more: 1, rejected: 1, incomplete: 1, unaccounted: 1 });
    expect(summary.rejectReasons).toEqual({ MISSING_QUERY_REQUIRED: 1 });
    expect(summary.streamedNotReturned).toEqual([
      { key: "browser:ben", title: "Ben Okafor", fate: "rejected", reason: "MISSING_QUERY_REQUIRED" },
      { key: "browser:chloe", title: "Chloe Martin", fate: "qualified_more", reason: null },
      { key: "browser:dan", title: "Dan Wu", fate: "unaccounted", reason: null },
    ]);
  });

  it("never downgrades a delivered row and keeps a rejection over a later gate", () => {
    const ledger = createCandidateLedger();
    ledger.decided({ key: "a", title: "A" }, { disposition: "rejected", reject_code: "LOCATION_MISMATCH" });
    ledger.gated({ key: "a", title: "A" });
    ledger.delivered([{ key: "b", title: "B" }], []);
    ledger.incomplete({ key: "b", title: "B" });
    const summary = ledger.summary();
    expect(summary.counts).toMatchObject({ rejected: 1, gated: 0, returned: 1, incomplete: 0 });
  });

  it("accounts for every candidate retrieved via streamed() and retrieved()", () => {
    const reconciled = createCandidateLedger();
    reconciled.streamed({ key: "s", title: "S" });
    reconciled.retrieved({ key: "r", title: "R" });
    reconciled.delivered([{ key: "s", title: "S" }], [{ key: "r", title: "R" }]);
    expect(reconciled.summary().accounting).toEqual({ retrieved: 2, fated: 2, unaccounted: 0, ok: true });
  });

  it("flags streamed rows the funnel never touched and retrievals it never fated", () => {
    const stranded = createCandidateLedger();
    stranded.streamed({ key: "x", title: "X" });
    expect(stranded.summary().accounting).toEqual({ retrieved: 1, fated: 1, unaccounted: 1, ok: false });

    const unfated = createCandidateLedger();
    unfated.retrieved({ key: "y", title: "Y" });
    expect(unfated.summary().accounting).toEqual({ retrieved: 1, fated: 0, unaccounted: 0, ok: false });
  });

  it("matches a re-minted entity id by registrable host and name", () => {
    const ledger = createCandidateLedger();
    ledger.streamed({ key: "browser:amina", entity_id: "browser:amina", title: "Amina Carter", company: "Acme", website_url: "https://www.amina.test/bio" });
    // The DB merge re-minted the entity id and the key; host + name still bind.
    ledger.delivered([{ key: "db:amina-9", entity_id: "db:amina-9", title: "Amina Carter", company: "Carter Labs", website_url: "https://amina.test" }], []);
    const summary = ledger.summary();
    expect(summary.counts).toMatchObject({ returned: 1, unaccounted: 0 });
    expect(summary.streamedNotReturned).toEqual([]);
    expect(summary.accounting).toEqual({ retrieved: 1, fated: 1, unaccounted: 0, ok: true });
  });

  it("merges location branches without reporting a lead another branch delivered", () => {
    const one = createCandidateLedger();
    one.streamed({ key: "x", title: "X" });
    one.decided({ key: "x", title: "X" }, { disposition: "rejected", reject_code: "LOCATION_MISMATCH" });
    const two = createCandidateLedger();
    two.streamed({ key: "y", title: "Y" });
    two.delivered([], [{ key: "y", title: "Y" }]);
    const merged = mergeCandidateLedgers([one.summary(), two.summary(), undefined], [{ key: "y", title: "Y" }]);
    expect(merged?.streamed).toBe(2);
    expect(merged?.streamedNotReturned.map((item) => item.key)).toEqual(["x"]);
    expect(mergeCandidateLedgers([undefined], [])).toBeUndefined();
  });

  it("explains fates in plain words", () => {
    expect(streamedFateLabel({ fate: "qualified_more", reason: null })).toBe("on the next page");
    expect(streamedFateLabel({ fate: "rejected", reason: "MISSING_QUERY_REQUIRED" })).toBe("missing a detail you asked for");
    expect(streamedFateLabel({ fate: "unaccounted", reason: null })).toBe("could not be confirmed");
  });
});

// Real server core: two founders verify and stream while researching, but the
// page holds one. The second must be reported "on the next page", not vanish.
const LIST = "https://publisher.test/top-25-b2b-saas-founder-list";
const pages: Record<string, { title: string; text: string; links?: PageSnapshot["links"] }> = {
  [LIST]: {
    title: "Top 25 B2B SaaS Founder List",
    text: "Top 25 B2B SaaS Founder List\nThe founders building the next generation of B2B SaaS companies.\nAmina Carter\nFounder & CEO\nAcme\nView Bio\nBen Okafor\nCo-Founder\nLedgerly\nView Bio",
    links: [{ ref: "l1", name: "Acme", url: "https://acme.test/" }, { ref: "l2", name: "Ledgerly", url: "https://ledgerly.test/" }],
  },
  "https://acme.test/": { title: "Acme — reporting software", text: "Acme builds reporting software for finance teams. Acme is a B2B SaaS company. ".repeat(3), links: [{ ref: "l3", name: "Contact", url: "https://acme.test/contact" }] },
  "https://acme.test/contact": { title: "Contact Acme", text: "Contact Acme. Email amina@acme.test or call +1 416 555 0100 about pricing, onboarding or support. Offices in Toronto, Ontario." },
  "https://ledgerly.test/": { title: "Ledgerly — ledgers for SaaS", text: "Ledgerly builds accounting ledgers for SaaS teams. Ledgerly is a B2B SaaS company. ".repeat(3), links: [{ ref: "l4", name: "Contact", url: "https://ledgerly.test/contact" }] },
  "https://ledgerly.test/contact": { title: "Contact Ledgerly", text: "Contact Ledgerly. Email ben@ledgerly.test or call +234 1 555 0199 about pricing, onboarding or support. Offices in Lagos, Nigeria." },
};
function fixtureBrowser(): AgentBrowser {
  let current: PageSnapshot | null = null;
  const snap = (url: string): PageSnapshot => {
    const page = pages[url] ?? { title: "Search", text: "results", links: url.startsWith("https://duckduckgo.com") ? [{ ref: "l0", name: "Top 25 B2B SaaS Founder List", url: LIST }] : [] };
    return { url, title: page.title, pageType: "entity_detail", headings: [], visibleRelevantText: page.text, links: page.links ?? [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
  };
  const observation = (value: PageSnapshot) => ({ snapshot: value, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async () => ({ id: "ledger", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 200, pages: 60, scrolls: 4, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => observation(current = snap("https://duckduckgo.com/html/?q=founders"))),
    navigate: vi.fn(async (_s, url: string) => observation(current = snap(url))),
    observe: vi.fn(async () => current!),
    click: vi.fn(async () => observation(current!)), type: vi.fn(async () => observation(current!)), select: vi.fn(async () => observation(current!)),
    scroll: vi.fn(async () => observation(current!)), waitFor: vi.fn(async () => observation(current!)),
    extract: vi.fn(async () => ({ values: { body: current?.visibleRelevantText ?? "" }, sourceUrl: current?.url ?? "", observedAt: new Date().toISOString(), errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}

describe("candidate ledger in the real server core", () => {
  it("reports a streamed lead that did not fit the page instead of dropping it silently", async () => {
    const streamed: string[] = [];
    const res = await runSpecSearchCore("B2B SaaS founders with public contact details", {
      people: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
      index: null,
      browserProgress: (event) => { if (event.row) streamed.push(event.row.title); },
      liveGapfill: { osm: null, web: null, jobs: null, browser: (spec, options) => discoverWithBrowser(spec, { ...options, browser: fixtureBrowser() }) },
    }, 1, {}, { force: true });
    expect(res.rows).toHaveLength(1);
    expect(streamed.length).toBeGreaterThanOrEqual(2);
    const ledger = res.candidateLedger!;
    expect(ledger.streamed).toBe(new Set(streamed).size);
    expect(ledger.counts.unaccounted).toBe(0);
    const delivered = res.rows[0].title;
    const missing = ledger.streamedNotReturned;
    expect(missing.map((item) => item.title)).not.toContain(delivered);
    expect(missing.length).toBe(ledger.streamed - 1);
    expect(missing.every((item) => item.fate === "qualified_more")).toBe(true);
    expect(res.hasMore).toBe(true);
  });
});
