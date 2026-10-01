/**
 * Evidence provenance (addendum 6.x): every evidence item observed during
 * browser discovery carries a unique id plus how it was acquired. A redirect
 * keeps the requested URL next to the final `source_url`, and the browser
 * session id lives only in provenance, never in evidence or row ids.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";
import { browserEntitiesToRows, discoverWithBrowser, type BrowserExtractedEntity } from "../browser-live.server";

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders", criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }],
  missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const REQUESTED = "https://publisher.test/founders";
const FINAL = "https://publisher.test/2026/saas-founders";
const SESSION = "prov-session-7";
const text = "SaaS founders. Amina Carter is the founder of Acme, a software-as-a-service company in Toronto. Acme is hiring engineers. Ben Okafor is the founder of Ledgerly, a software-as-a-service company in Lagos.";

function redirectingBrowser(): AgentBrowser {
  const snap = (url: string): PageSnapshot => ({ url, title: "SaaS founders", pageType: "entity_detail", headings: [], visibleRelevantText: text, links: [],
    interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] });
  // The requested article URL redirects to its canonical, dated URL.
  const observation = (url: string) => ({ snapshot: snap(url === REQUESTED ? FINAL : url), action: "navigate", verified: true });
  return {
    createSession: vi.fn(async () => ({ id: SESSION, visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 60, pages: 20, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => ({ snapshot: { ...snap("https://duckduckgo.com/html/?q=x"), links: [{ ref: "l0", name: "SaaS founders", url: REQUESTED }] }, action: "search", verified: true })),
    navigate: vi.fn(async (_s, url: string) => observation(url)), observe: vi.fn(async () => snap(FINAL)),
    click: vi.fn(async () => observation(FINAL)), type: vi.fn(async () => observation(FINAL)), select: vi.fn(async () => observation(FINAL)),
    scroll: vi.fn(async () => observation(FINAL)), waitFor: vi.fn(async () => observation(FINAL)),
    extract: vi.fn(async () => ({ values: { body: text }, sourceUrl: FINAL, observedAt: "", errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}
const person = (name: string, company: string): BrowserExtractedEntity => {
  const quote = `${name} is the founder of ${company}, a software-as-a-service company`;
  return { page: 0, kind: "person", name, identityQuote: quote, fields: { role: { value: "founder", quote }, company: { value: company, quote } },
    ...(name === "Amina Carter" ? { claims: [{ type: "hiring" as const, quote: "Amina Carter is the founder of Acme, a software-as-a-service company in Toronto. Acme is hiring engineers." }] } : {}) };
};

describe("evidence provenance", () => {
  it("keeps the requested URL, the final URL, the run and the session on every evidence item", async () => {
    const rows = await discoverWithBrowser(spec, { browser: redirectingBrowser(), searchRunId: "run-prov-1", discoveryQueries: ["SaaS founders"],
      isVerified: (row) => !!row.company, extractEntities: async () => [person("Amina Carter", "Acme"), person("Ben Okafor", "Ledgerly")] });
    expect(rows.length).toBeGreaterThan(0);
    const evidence = rows.flatMap((row) => row.evidence ?? []).filter((item) => item.source_url === FINAL);
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    for (const item of evidence) {
      expect(item.source_url).toBe(FINAL);
      expect(item.provenance).toMatchObject({ acquisition: "browser", requested_url: REQUESTED, search_run_id: "run-prov-1", browser_session_id: SESSION });
    }
    // Ids are unique per evidence item and never embed the session id.
    const ids = evidence.map((item) => item.id);
    expect(ids.every((id) => typeof id === "string" && id.startsWith("ev:"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id!.includes(SESSION))).toBe(false);
    expect(rows.some((row) => String(row.key).includes(SESSION) || String(row.entity_id).includes(SESSION))).toBe(false);
  });

  it("gives pages without a recorded acquisition an id but no invented provenance", () => {
    const rows = browserEntitiesToRows([person("Amina Carter", "Acme")], [{ url: FINAL, title: "SaaS founders", text }]);
    expect(rows).toHaveLength(1);
    const [identity] = rows[0].evidence!;
    expect(identity.id).toMatch(/^ev:/);
    expect(identity.provenance).toBeUndefined();
  });
});
