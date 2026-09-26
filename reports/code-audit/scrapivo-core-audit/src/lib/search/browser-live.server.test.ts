import { describe, expect, it, vi } from "vitest";
import { AgentBrowserCliAdapter } from "@/lib/research-agent/agent-browser-cli.server";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "./search-spec";
import { browserEntitiesToRows, discoverWithBrowser, type BrowserExtractedEntity, type BrowserObservedPage } from "./browser-live.server";
import { rowSatisfiesSpec } from "@/lib/spec-search.functions";
import { applyWhyMatchGate } from "./live-gapfill";
import { qualifyLead, scoreIntent } from "./qualify";

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders in Canada", criteria: [], missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const text = "Amina Carter is the founder of Acme, a software-as-a-service company in Toronto, Canada. Contact Amina at hello@acme.test.";
const observed: BrowserObservedPage[] = [{ url: "https://acme.test/team", title: "Our team", text }];
const entity: BrowserExtractedEntity = { page: 0, kind: "person", name: "Amina Carter", identityQuote: text.split(" Contact")[0], fields: { role: { value: "founder", quote: text }, company: { value: "Acme", quote: text }, industry: { value: "SaaS", quote: text }, location: { value: "Toronto", quote: text }, country: { value: "Canada", quote: text } } };

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return { url: observed[0].url, title: "Our team", pageType: "entity_detail", headings: ["Our team"], visibleRelevantText: "Compact tree with no paragraph text ".repeat(20), links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [], ...overrides };
}

function fakeBrowser(): AgentBrowser {
  let current = snapshot();
  const observation = (page: PageSnapshot) => ({ snapshot: page, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async (options = {}) => ({ id: options.id ?? "test", visible: false, createdAt: new Date().toISOString(), screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 30, pages: 8, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => observation(snapshot({ url: "https://duckduckgo.com/?q=founders", pageType: "search_results", links: [{ ref: "@e1", name: "Acme team", url: observed[0].url }] }))),
    navigate: vi.fn(async (_session, url) => observation(current = snapshot({ url }))),
    observe: vi.fn(async () => current),
    click: vi.fn(async () => observation(current)), type: vi.fn(async () => observation(current)), select: vi.fn(async () => observation(current)),
    scroll: vi.fn(async () => observation(current)), waitFor: vi.fn(async () => observation(current)),
    extract: vi.fn(async () => ({ values: { body: text }, sourceUrl: current.url, observedAt: new Date().toISOString(), errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}

describe("browser discovery evidence boundary", () => {
  it("resolves a named founder card when model omits its separate company line", () => {
    const page: BrowserObservedPage = { url: "https://publisher.test/saas-founders", title: "Search page", text: "Top 25 B2B SaaS Founder List of 2024\nAndrew Breen\nFounder & CEO\nOutshine\nNext profile" };
    const rows = browserEntitiesToRows([{ page: 0, kind: "person", name: "Andrew Breen", identityQuote: "Andrew Breen\nFounder & CEO", fields: { role: { value: "Founder & CEO", quote: "Founder & CEO" } } }], [page]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "Founder & CEO", company: "Outshine", industry: "SaaS" });
    expect(rows[0].evidence?.some((e) => /Andrew Breen\s+Founder & CEO\s+Outshine/i.test(e.excerpt ?? ""))).toBe(true);
    expect(qualifyLead(rows[0], { ...spec, criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }, { field: "industry", value: "SaaS", stated: true, confidence: 1 }] }, rows[0].evidence).disposition).toBe("qualified");
  });
  it("resolves a founder card when the browser flattens visible line breaks", () => {
    const page: BrowserObservedPage = { url: "https://publisher.test/saas-founders", title: "Search page", text: "Top 25 B2B SaaS Founder List of 2024 Andrew Breen Founder & CEO Outshine View Bio Next profile" };
    const rows = browserEntitiesToRows([{ page: 0, kind: "person", name: "Andrew Breen", identityQuote: "Andrew Breen Founder & CEO", fields: { role: { value: "Founder & CEO", quote: "Founder & CEO" } } }], [page]);
    expect(rows[0]).toMatchObject({ company: "Outshine", industry: "SaaS" });
  });
  it("resolves a founder card when the page uses pipe-separated rows", () => {
    const page: BrowserObservedPage = { url: "https://publisher.test/saas-founders", title: "Founder list", text: "Top 25 B2B SaaS Founder List\nAndrew Breen | Founder & CEO | Outshine\nDavid Chevalier | Co-Founder & CEO | Surfe" };
    const rows = browserEntitiesToRows([{ page: 0, kind: "person", name: "Andrew Breen", identityQuote: "Andrew Breen | Founder & CEO", fields: { role: { value: "Founder & CEO", quote: "Founder & CEO" } } }], [page]);
    expect(rows[0]).toMatchObject({ role: "Founder & CEO", company: "Outshine", industry: "SaaS" });
    expect(rows[0].evidence?.some((e) => /Andrew Breen\s*\|\s*Founder & CEO\s*\|\s*Outshine/i.test(e.excerpt ?? ""))).toBe(true);
  });
  it("keeps observed person roles separate from names through spec filtering and qualification", () => {
    const founderSpec = { ...spec, criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }, { field: "industry", value: "SaaS", stated: true, confidence: 1 }] };
    const rows = browserEntitiesToRows([entity], observed);
    expect(rows[0].title).toBe("Amina Carter");
    expect(rowSatisfiesSpec(founderSpec, rows[0])).toBe(true);
    expect(applyWhyMatchGate(rows, founderSpec, false).kept).toHaveLength(1);
    const unbound = browserEntitiesToRows([{ ...entity, identityQuote: "Amina Carter works here. Acme has a founder.", fields: { role: { value: "founder", quote: "Acme has a founder." }, company: { value: "Acme", quote: "Acme has a founder." } } }], [{ ...observed[0], text: "Amina Carter works here. Acme has a founder." }]);
    expect(unbound[0]?.evidence?.[0].claim_parameters).toBeUndefined();
  });
  it("uses result-container links instead of search navigation and download links", async () => {
    const browser = fakeBrowser();
    vi.mocked(browser.search).mockResolvedValue({ snapshot: snapshot({ url: "https://duckduckgo.com/?q=founders", links: [{ ref: "@footer", name: "Get browser", url: "https://apps.apple.com/app/duckduckgo" }] }), action: "search", verified: true });
    browser.extractLinks = vi.fn(async () => [{ ref: "result-0", name: "Acme team", url: observed[0].url }]);
    const rows = await discoverWithBrowser(spec, { browser, extractEntities: async () => [entity] });
    expect(rows).toHaveLength(1);
    expect(browser.click).toHaveBeenCalledWith(expect.anything(), "result-0");
    expect(browser.navigate).not.toHaveBeenCalledWith(expect.anything(), "https://apps.apple.com/app/duckduckgo");
  });

  it("uses selector then attribute in the CLI extraction command", async () => {
    const runner = vi.fn(async (_args: string[], _signal?: AbortSignal | null) => JSON.stringify({ success: true, data: { value: "https://acme.test/team" } }));
    const browser = new AgentBrowserCliAdapter(runner);
    await browser.extract(await fakeBrowser().createSession(), { fields: { link: { selector: "a.result", attribute: "href" } } });
    expect(runner.mock.calls[0][0].slice(-4)).toEqual(["get", "attr", "a.result", "href"]);
  });
  it("uses observed body text, visits a public search result, and returns stable source-backed candidates", async () => {
    const browser = fakeBrowser();
    const extractor = vi.fn(async (_pages: BrowserObservedPage[], _spec: SearchSpec) => [entity]);
    const rows = await discoverWithBrowser(spec, { browser, extractEntities: extractor, searchRunId: "run-test" });
    expect(browser.search).toHaveBeenCalled();
    expect(vi.mocked(browser.search).mock.calls.some(([, query]) => /Amina Carter.*(?:official website|contact)/i.test(query))).toBe(true);
    expect(browser.click).toHaveBeenCalledWith(expect.anything(), "@e1");
    expect(browser.scroll).toHaveBeenCalledWith(expect.anything(), null, "down");
    expect(extractor.mock.calls[0][0][0].text).toBe(text);
    expect(rows[0]).toMatchObject({ title: "Amina Carter", kind: "person", industry: "SaaS", location: "Toronto", email: null, verification_status: "discovered" });
    expect(rows[0].evidence?.[0]).toMatchObject({ source_url: observed[0].url, excerpt: entity.identityQuote, extraction_method: "browser_observed_text" });
    expect(rows[0].entity_id).toBe(browserEntitiesToRows([entity], observed)[0].entity_id);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("uses understood criteria instead of replaying user wording and publishes real browser actions", async () => {
    const browser = fakeBrowser();
    const onProgress = vi.fn();
    const understood = { ...spec, raw_query: "please find me SaaS founders asap", criteria: [
      { field: "role", value: "founder", stated: true, confidence: 1 },
      { field: "industry", value: "SaaS", stated: true, confidence: 1 },
    ] };
    await discoverWithBrowser(understood, { browser, extractEntities: async () => [entity], onProgress });
    const firstQuery = vi.mocked(browser.search).mock.calls[0][1];
    expect(firstQuery).toMatch(/\bfounder\b/i);
    expect(firstQuery).toMatch(/\bSaaS\b/i);
    expect(firstQuery).not.toMatch(/please|asap/i);
    expect(onProgress.mock.calls.map(([event]) => event.action)).toEqual(expect.arrayContaining([
      "Searching the web", "Opened result", "Scrolled page", "Read page", "Extracted candidates",
    ]));
  });

  it("rejects invented identities and unobserved contacts/geography, without promoting requested criteria", () => {
    const rows = browserEntitiesToRows([{ ...entity, fields: { email: { value: "amina@acme.test", quote: text }, location: { value: "Vancouver", quote: text }, opportunity: { value: "no_website", quote: text } } }, { ...entity, name: "Imaginary Founder" }], observed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: null, location: null, opportunity: null, url: observed[0].url });
    expect(rows[0].evidence).toHaveLength(1);
  });

  it.each(["AI content", "AI slop"])("qualifies observed subject discussion of %s without inventing buying intent", (topic) => {
    const identityQuote = "Amina Carter is a copywriter in New York.";
    const discussionQuote = `Amina Carter writes about ${topic}.`;
    const topicSpec: SearchSpec = { ...spec, criteria: [
      { field: "role", value: "copywriter", stated: true, confidence: 1 },
      { field: "location", value: "New York", stated: true, confidence: 1 },
      { field: "content_topic", value: "AI content or AI slop", stated: true, confidence: 1 },
    ] };
    const rows = browserEntitiesToRows([{ page: 0, kind: "person", name: "Amina Carter", identityQuote, fields: {
      role: { value: "copywriter", quote: identityQuote },
      location: { value: "New York", quote: identityQuote },
      content_topic: { value: topic, quote: discussionQuote },
    } }], [{ ...observed[0], text: `${identityQuote} ${discussionQuote}` }]);
    expect(rows).toHaveLength(1);
    expect(qualifyLead(rows[0], topicSpec, rows[0].evidence)).toMatchObject({ disposition: "qualified", why_match: discussionQuote, intent_score: 0 });
    expect(scoreIntent(rows[0].evidence)).toBe(0);
    expect(applyWhyMatchGate(rows, topicSpec, false).kept).toHaveLength(1);
  });

  it("does not attribute a bystander's topic discussion to the named candidate", () => {
    const identityQuote = "Amina Carter is a copywriter in New York.";
    const discussionQuote = `${identityQuote} Ben Miller writes about AI slop.`;
    const topicSpec: SearchSpec = { ...spec, criteria: [{ field: "content_topic", value: "AI content or AI slop", stated: true, confidence: 1 }] };
    const rows = browserEntitiesToRows([{ page: 0, kind: "person", name: "Amina Carter", identityQuote, fields: {
      content_topic: { value: "AI slop", quote: discussionQuote },
    } }], [{ ...observed[0], text: discussionQuote }]);
    expect(rows[0].evidence?.some((item) => item.extraction_method === "browser_observed_subject_topic")).toBe(false);
    expect(qualifyLead(rows[0], topicSpec, rows[0].evidence)).toMatchObject({ disposition: "potential_match", reject_code: "NO_CLAIM_EVIDENCE", why_match: null, intent_score: 0 });
    expect(applyWhyMatchGate(rows, topicSpec, false).kept).toHaveLength(0);
  });

  it.each([
    ["company", "Acme", "Acme is a software company based in Toronto."],
    ["business", "North Plumbing", "North Plumbing is a plumbing service in Austin with no website."],
    ["investor", "Maple Capital", "Maple Capital invests in pre-seed AI companies in Canada."],
    ["job", "Software Engineer", "Apply for the Software Engineer job at Acme in Edmonton."],
  ] as const)("extracts %s subjects from page evidence instead of treating the page as the entity", (kind, name, quote) => {
    const result = browserEntitiesToRows([{ page: 0, kind, name, identityQuote: quote }], [{ url: "https://public-directory.test/list", title: "Directory", text: quote }]);
    expect(result[0]).toMatchObject({ kind, title: name, entity_resolved: true, page_type: "entity_page" });
  });

  it("retains explicit no-website evidence and never calls its directory URL the business website", () => {
    const quote = "North Plumbing is a plumbing service in Austin with no website.";
    const rows = browserEntitiesToRows([{ page: 0, kind: "business", name: "North Plumbing", identityQuote: quote, fields: { opportunity: { value: "no_website", quote } } }], [{ ...observed[0], text: quote }]);
    expect(rows[0]).toMatchObject({ url: null, opportunity: "no_website" });
    expect(rows[0].evidence?.[1]).toMatchObject({ evidence_type: "no_website", source_url: observed[0].url });
  });

  it("continues via another public search engine when the first source blocks access", async () => {
    const browser = fakeBrowser();
    vi.mocked(browser.search).mockResolvedValue({ snapshot: snapshot({ friction: ["CAPTCHA"] }), action: "search", verified: true });
    vi.mocked(browser.navigate).mockImplementation(async (_session, url) => ({ snapshot: url.includes("bing.com/search") ? snapshot({ url, links: [{ ref: "@e2", name: "Acme team", url: `https://www.bing.com/ck/a?u=a1${Buffer.from(observed[0].url).toString("base64url")}` }] }) : snapshot({ url }), action: "navigate", verified: true }));
    const rows = await discoverWithBrowser(spec, { browser, extractEntities: async () => [entity] });
    expect(browser.click).toHaveBeenCalledWith(expect.anything(), "@e2");
    expect(rows).toHaveLength(1);
  });

  it("continues after a failed result page and never opens private-network links", async () => {
    const browser = fakeBrowser();
    vi.mocked(browser.search).mockResolvedValue({ snapshot: snapshot({ links: [{ ref: "@e1", name: "Private", url: "http://127.0.0.1/admin" }, { ref: "@e2", name: "Broken", url: "https://broken.test/team" }, { ref: "@e3", name: "Team", url: observed[0].url }] }), action: "search", verified: true });
    vi.mocked(browser.navigate).mockImplementation(async (_session, url) => { if (url.includes("broken.test")) throw new Error("unavailable"); return { snapshot: snapshot({ url }), action: "navigate", verified: true }; });
    expect(await discoverWithBrowser(spec, { browser, extractEntities: async () => [entity] })).toHaveLength(1);
    expect(browser.navigate).not.toHaveBeenCalledWith(expect.anything(), "http://127.0.0.1/admin");
  });

  it("reports unavailable when both public search engines fail or block access", async () => {
    const browser = fakeBrowser();
    vi.mocked(browser.search).mockResolvedValue({ snapshot: snapshot({ friction: ["CAPTCHA"] }), action: "search", verified: true });
    vi.mocked(browser.navigate).mockRejectedValue(new Error("source unavailable"));
    await expect(discoverWithBrowser(spec, { browser })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", message: "BROWSER_SEARCH_SOURCES_UNAVAILABLE" });
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("keeps accessible searches with no external results distinct from unavailable sources", async () => {
    const browser = fakeBrowser();
    vi.mocked(browser.search).mockResolvedValue({ snapshot: snapshot({ links: [] }), action: "search", verified: true });
    await expect(discoverWithBrowser(spec, { browser })).resolves.toEqual([]);
  });

  it("propagates fatal extraction and session failures instead of reporting successful empty results", async () => {
    const browser = fakeBrowser();
    await expect(discoverWithBrowser(spec, { browser, extractEntities: async () => { throw new Error("extraction unavailable"); } })).rejects.toMatchObject({ code: "SOURCE_ERROR" });
    expect(browser.close).toHaveBeenCalledOnce();
    vi.mocked(browser.createSession).mockRejectedValue(new Error("browser unavailable"));
    await expect(discoverWithBrowser(spec, { browser })).rejects.toMatchObject({ code: "SOURCE_ERROR" });
  });

  it("reports a bounded extraction timeout as unavailable and closes the session", async () => {
    vi.useFakeTimers();
    try {
      const browser = fakeBrowser();
      const pending = discoverWithBrowser(spec, { browser, timeoutMs: 1000, extractEntities: () => new Promise(() => undefined) });
      const result = expect(pending).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(1000);
      await result;
      expect(browser.close).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("cancels without returning late extraction results and closes the session", async () => {
    const browser = fakeBrowser();
    const abort = new AbortController();
    await expect(discoverWithBrowser(spec, { browser, signal: abort.signal, extractEntities: async () => { abort.abort(); return [entity]; } })).rejects.toThrow("SEARCH_CANCELLED");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("closes the real CLI adapter even after its command signal is aborted", async () => {
    const abort = new AbortController();
    const runner = vi.fn(async () => JSON.stringify({ success: true, data: {} }));
    const browser = new AgentBrowserCliAdapter(runner, abort.signal);
    const session = await fakeBrowser().createSession({ id: "cleanup" });
    abort.abort();
    await browser.close(session);
    expect(runner).toHaveBeenCalledWith(expect.arrayContaining(["close"]));
  });
});
