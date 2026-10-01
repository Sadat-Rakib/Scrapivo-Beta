import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";
import { discoverWithBrowser } from "../browser-live.server";

const spec: SearchSpec = { entity: "person", raw_query: "B2B SaaS founders with public contact details", criteria: [
  { field: "role", value: "founder", stated: true, confidence: 1 }, { field: "industry", value: "SaaS", stated: true, confidence: 1 },
  { field: "require_contact", value: "true", stated: true, confidence: 1 }, { field: "required_field", value: "contact", stated: true, confidence: 1 },
], missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search", requested_fields: ["contact"] };

const home = { title: "Acme - SaaS for finance teams", text: "Acme builds software for finance teams. About us. Pricing. Contact. ".repeat(4) };

function browser(contact: { title: string; text: string }): AgentBrowser {
  let current: PageSnapshot | null = null;
  const snap = (url: string): PageSnapshot => {
    const page = url.includes("/contact") ? contact : url === "https://acme.test/" ? home
      : { title: "Top SaaS Founders", text: "Top SaaS Founders 2026. Amina Carter is the founder of Acme, a software-as-a-service company. ".repeat(3) };
    return { url, title: page.title, pageType: "entity_detail", headings: [], visibleRelevantText: page.text, links: url === "https://acme.test/" ? [{ ref: "l1", name: "Contact", url: "https://acme.test/contact" }] : [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
  };
  const observation = (value: PageSnapshot) => ({ snapshot: value, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async () => ({ id: "t", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 60, pages: 20, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => observation(snap("https://duckduckgo.com/html/?q=x"))),
    navigate: vi.fn(async (_s, url: string) => observation(current = snap(url))),
    observe: vi.fn(async () => current!),
    click: vi.fn(async () => observation(current!)), type: vi.fn(async () => observation(current!)), select: vi.fn(async () => observation(current!)),
    scroll: vi.fn(async () => observation(current!)), waitFor: vi.fn(async () => observation(current!)),
    extract: vi.fn(async () => ({ values: { body: current?.visibleRelevantText ?? "" }, sourceUrl: current?.url ?? "", observedAt: "", errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}

const seed = {
  kind: "person" as const, title: "Amina Carter", role: "Founder", company: "Acme", industry: "SaaS", entity_id: "browser:amina", key: "browser:amina",
  entity_resolved: true, website_url: "https://acme.test/", source_url: "https://publisher.test/founders", detail: "Founder | Acme",
};

describe("contact page evidence", () => {
  it("records a real contact page", async () => {
    const rows = await discoverWithBrowser(spec, { browser: browser({ title: "Contact us - Acme", text: "Get in touch with the Acme team. Email hello@acme.test or call +1 416 555 0100. Offices in Toronto, Ontario, Canada." }),
      discoveryQueries: [], initialCandidates: [seed], extractEntities: async () => [] });
    expect(rows[0].contact_page_url).toBe("https://acme.test/contact");
  });

  it("does not record a 404 template rendered at /contact", async () => {
    const rows = await discoverWithBrowser(spec, { browser: browser({ title: "Page not found - Acme", text: "404. Sorry, this page does not exist. Go back to the Acme homepage and try again later please, thank you." }),
      discoveryQueries: [], initialCandidates: [seed], extractEntities: async () => [] });
    expect(rows[0].contact_page_url ?? null).toBeNull();
  });
});
