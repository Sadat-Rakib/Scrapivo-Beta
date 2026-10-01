import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXTRACT_ALL_SEPARATOR } from "./browser";

// Real Chromium, local data: pages only (no network). Skipped when the
// Playwright Chromium build is not installed on the machine.
const chromiumInstalled = existsSync(join(process.env.LOCALAPPDATA ?? process.env.HOME ?? "", "ms-playwright"));
process.env.SCRAPIVO_BROWSER_SCREENSHOTS = "false";

const html = (body: string) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><title>Results</title>${body}</head></html>`)}`;

describe.skipIf(!chromiumInstalled)("PlaywrightBrowserAdapter (real Chromium)", async () => {
  const { PlaywrightBrowserAdapter } = await import("./playwright-browser.server");
  const adapter = new PlaywrightBrowserAdapter(null, { visible: false });
  afterAll(async () => { await adapter.closeAll(); });

  it("returns only organic result anchors, with refs that click the same anchor", async () => {
    const session = await adapter.createSession({ id: "pw-test-links", visible: false });
    const page = html(`<body><nav><a href="https://www.bing.com/images">Images</a><a href="https://copilot.cloud.microsoft/">Copilot</a></nav>
      <ol id="b_results"><li class="b_algo"><h2><a href="https://example.org/one">First result</a></h2></li>
      <li class="b_algo"><h2><a href="https://example.org/two">Second result</a></h2></li></ol></body>`);
    await adapter.navigate(session, page);
    const links = await adapter.extractLinks(session, "#b_results .b_algo h2 a", 1000);
    expect(links.map((link) => [link.name, link.url])).toEqual([["First result", "https://example.org/one"], ["Second result", "https://example.org/two"]]);
    expect(links[0].ref).toBe("l2");
    await adapter.close(session);
  });

  it("flags a search-engine bot challenge as CAPTCHA friction", async () => {
    const session = await adapter.createSession({ id: "pw-test-challenge", visible: false });
    const observation = await adapter.navigate(session, html(`<body><p>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge to confirm this search was made by a human.</p></body>`));
    expect(observation.snapshot.friction).toContain("CAPTCHA");
    await adapter.close(session);
  });

  it("extracts every JSON-LD block when asked for all matches, beyond the text cap", async () => {
    const session = await adapter.createSession({ id: "pw-test-jsonld", visible: false });
    const big = JSON.stringify({ "@type": "ItemList", itemListElement: Array.from({ length: 400 }, (_, i) => ({ "@type": "ListItem", item: { "@type": "Restaurant", name: `Place ${i}`, address: { addressLocality: "Calgary" } } })) });
    await adapter.navigate(session, html(`<script type="application/ld+json">{"@type":"WebSite","name":"Dir"}</script><script type="application/ld+json">${big}</script><body><p>list</p></body>`));
    const result = await adapter.extract(session, { fields: { jsonld: { selector: 'script[type="application/ld+json"]', all: true, maxChars: 400_000 } } });
    const blocks = String(result.values.jsonld).split(EXTRACT_ALL_SEPARATOR);
    expect(blocks).toHaveLength(2);
    expect(JSON.parse(blocks[1]).itemListElement).toHaveLength(400);
    await adapter.close(session);
  });
});
