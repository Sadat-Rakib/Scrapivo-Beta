/**
 * HARD GATE fixture: one browser-required query travels the real server core
 * (runSpecSearchCore → live gapfill → discoverWithBrowser → deterministic
 * extraction → research → qualification → streamed row → final rows).
 * Only the browser pages are fixtures; nothing below the browser is mocked.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import { discoverWithBrowser } from "../browser-live.server";

const LIST = "https://publisher.test/top-25-b2b-saas-founder-list";
const pages: Record<string, { title: string; text: string; links?: PageSnapshot["links"] }> = {
  [LIST]: {
    title: "Top 25 B2B SaaS Founder List",
    text: "Top 25 B2B SaaS Founder List\nThe founders building the next generation of B2B SaaS companies.\nAmina Carter\nFounder & CEO\nAcme\nView Bio\nBen Okafor\nCo-Founder\nLedgerly\nView Bio\nChloe Martin\nCEO & Founder\nBrightpath\nView Bio",
    links: [{ ref: "l1", name: "Acme", url: "https://acme.test/" }],
  },
  "https://acme.test/": {
    title: "Acme — reporting software for finance teams",
    text: "Acme builds reporting software for finance teams. Product. Pricing. About. Contact. Acme is a B2B SaaS company. ".repeat(3),
    links: [{ ref: "l2", name: "Contact", url: "https://acme.test/contact" }],
  },
  "https://acme.test/contact": {
    title: "Contact Acme",
    text: "Contact Acme. Get in touch with our team about pricing, onboarding or support. Offices in Toronto, Ontario.",
  },
};

function fixtureBrowser(): AgentBrowser {
  let current: PageSnapshot | null = null;
  const snap = (url: string): PageSnapshot => {
    const page = pages[url] ?? { title: "Search", text: "results", links: url.startsWith("https://duckduckgo.com")
      ? [{ ref: "l0", name: "Top 25 B2B SaaS Founder List", url: LIST }] : [] };
    return { url, title: page.title, pageType: "entity_detail", headings: [], visibleRelevantText: page.text, links: page.links ?? [],
      interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
  };
  const observation = (value: PageSnapshot) => ({ snapshot: value, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async () => ({ id: "gate", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 200, pages: 60, scrolls: 4, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => observation(current = snap("https://duckduckgo.com/html/?q=founders"))),
    navigate: vi.fn(async (_s, url: string) => observation(current = snap(url))),
    observe: vi.fn(async () => current!),
    click: vi.fn(async () => observation(current!)), type: vi.fn(async () => observation(current!)), select: vi.fn(async () => observation(current!)),
    scroll: vi.fn(async () => observation(current!)), waitFor: vi.fn(async () => observation(current!)),
    extract: vi.fn(async () => ({ values: { body: current?.visibleRelevantText ?? "" }, sourceUrl: current?.url ?? "", observedAt: new Date().toISOString(), errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}

describe("HARD GATE: first browser row end to end", () => {
  it("a browser-found founder reaches the streamed rows and the final page with evidence", async () => {
    const streamed: Array<{ key: string; title: string }> = [];
    const res = await runSpecSearchCore("B2B SaaS founders with public contact details", {
      people: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
      index: null,
      browserProgress: (event) => { if (event.row) streamed.push({ key: event.row.key, title: event.row.title }); },
      liveGapfill: {
        osm: null, web: null, jobs: null,
        browser: (spec, options) => discoverWithBrowser(spec, { ...options, browser: fixtureBrowser() }),
      },
    }, 10, {}, { force: true });

    const row = res.rows.find((item) => item.title === "Amina Carter");
    expect(row, `outcome=${res.outcome} rows=${res.rows.map((r) => r.title).join(",")}`).toBeDefined();
    expect(row).toMatchObject({ kind: "person", company: "Acme", website_url: "https://acme.test", contact_page_url: "https://acme.test/contact" });
    // Identity, role and company are quoted from the visited list page.
    const identity = row!.evidence?.find((item) => item.evidence_type === "identity" && item.source_url === LIST);
    expect(identity?.excerpt).toContain("Amina Carter");
    expect(pages[LIST].text).toContain(identity!.excerpt!.split("\n")[0]);
    // No fabricated contact: nothing on these pages names Amina's email or phone.
    expect(row!.email ?? null).toBeNull();
    expect(row!.phone ?? null).toBeNull();
    // The streamed row is the same lead that reached the final page, and it
    // streams exactly once.
    expect(streamed.map((item) => item.key)).toContain(row!.key);
    expect(streamed.filter((item) => item.key === row!.key)).toHaveLength(1);
    // Leads without any observed contact channel do not qualify.
    expect(res.rows.some((item) => item.title === "Ben Okafor")).toBe(false);
  });
});
