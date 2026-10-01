/**
 * A worker -> in-process switch is reported even when the in-process runtime
 * then fails to start too (review item: the report used to be emitted only
 * after a session existed).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/research-agent/playwright-browser.server", () => ({
  PlaywrightBrowserAdapter: class {
    async createSession() { throw new Error("chromium failed to start"); }
    async close() { /* nothing to close */ }
  },
}));

import { discoverWithBrowser, type BrowserTraceEvent } from "../browser-live.server";
import type { SearchSpec } from "../search-spec";

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders", criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }],
  missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };

describe("runtime fallback trace", () => {
  it("records worker -> playwright (WORKER_UNAVAILABLE) although the fallback also failed", async () => {
    const saved = { adapter: process.env.SCRAPIVO_BROWSER_ADAPTER, url: process.env.SCRAPIVO_BROWSER_WORKER_URL, token: process.env.SCRAPIVO_BROWSER_WORKER_TOKEN };
    process.env.SCRAPIVO_BROWSER_ADAPTER = "worker";
    process.env.SCRAPIVO_BROWSER_WORKER_URL = "http://127.0.0.1:9";
    process.env.SCRAPIVO_BROWSER_WORKER_TOKEN = "t".repeat(40);
    const events: BrowserTraceEvent[] = [];
    try {
      await discoverWithBrowser(spec, { discoveryQueries: ["SaaS founders"], timeoutMs: 10_000, onTrace: (event) => events.push(event), extractEntities: async () => [] })
        .catch(() => undefined);
    } finally {
      for (const [key, value] of [["SCRAPIVO_BROWSER_ADAPTER", saved.adapter], ["SCRAPIVO_BROWSER_WORKER_URL", saved.url], ["SCRAPIVO_BROWSER_WORKER_TOKEN", saved.token]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    expect(events).toContainEqual({ kind: "runtime", requested: "worker", used: "playwright", reason: "WORKER_UNAVAILABLE" });
  });
});
