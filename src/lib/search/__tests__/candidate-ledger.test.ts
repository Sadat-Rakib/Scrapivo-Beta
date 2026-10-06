import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import { runSpecSearchCore, type SpecSearchDeps } from "@/lib/spec-search.functions";
import { discoverWithBrowser } from "../browser-live.server";
import { createCandidateLedger, mergeCandidateLedgers, streamedFateLabel } from "../candidate-ledger";
import * as watchdogModule from "../run-watchdog";

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

  it("reconciles only outstanding entries on cancellation and preserves every booked fate", () => {
    const ledger = createCandidateLedger();
    ledger.streamed({ key: "stream", title: "Stream" });
    ledger.retrieved({ key: "stub", title: "Stub" });
    const booked = ["returned", "more", "rejected", "absorbed", "filtered", "incomplete", "gated", "excluded"];
    for (const key of booked) ledger.streamed({ key, title: key });
    ledger.delivered([{ key: "returned" }], [{ key: "more" }]);
    ledger.decided({ key: "rejected" }, { disposition: "rejected", reject_code: "LOCATION_MISMATCH" });
    ledger.merged({ key: "absorbed" }, { key: "returned" });
    ledger.filtered({ key: "filtered" }, "SPEC_MISMATCH");
    ledger.incomplete({ key: "incomplete", missingFields: ["email"] });
    ledger.gated({ key: "gated" }, "SIGNAL_NOT_VERIFIED");
    ledger.excluded({ key: "excluded" });
    const before = ledger.summary();
    ledger.cancelled("SEARCH_STALE_RUN");
    const after = ledger.summary();
    expect(after.accounting).toEqual({ retrieved: 10, fated: 10, unaccounted: 0, ok: true });
    expect(after.counts).toMatchObject({ returned: 1, qualified_more: 1, rejected: 1, absorbed: 1, gated: 3, unaccounted: 0 });
    expect(after.streamedNotReturned.filter((item) => booked.includes(item.key))).toEqual(
      before.streamedNotReturned.filter((item) => booked.includes(item.key)),
    );
    expect(after.streamedNotReturned.find((item) => item.key === "stream")).toEqual({
      key: "stream", title: "Stream", fate: "gated", reason: "SEARCH_STALE_RUN",
    });
    ledger.cancelled("SEARCH_CANCELLED");
    expect(ledger.summary()).toEqual(after);
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

  it("retracts a branch-local delivery when the aggregate is cancelled", () => {
    const branch = createCandidateLedger();
    branch.streamed({ key: "chattogram", title: "Chattogram Solar" });
    branch.delivered([{ key: "chattogram", title: "Chattogram Solar" }], []);
    const merged = mergeCandidateLedgers([branch.summary()], [], "SEARCH_STALE_RUN");
    expect(merged?.counts).toMatchObject({ returned: 0, qualified_more: 0, gated: 1 });
    expect(merged?.streamedNotReturned).toEqual([
      { key: "chattogram", title: "Chattogram Solar", fate: "gated", reason: "SEARCH_STALE_RUN" },
    ]);
  });

  it("explains fates in plain words", () => {
    expect(streamedFateLabel({ fate: "qualified_more", reason: null })).toBe("on the next page");
    expect(streamedFateLabel({ fate: "rejected", reason: "MISSING_QUERY_REQUIRED" })).toBe("missing a detail you asked for");
    expect(streamedFateLabel({ fate: "unaccounted", reason: null })).toBe("could not be confirmed");
    expect(streamedFateLabel({ fate: "gated", reason: "SEARCH_CANCELLED" })).toBe("search was cancelled before delivery");
    expect(streamedFateLabel({ fate: "gated", reason: "SEARCH_STALE_RUN" })).toBe("search was replaced before delivery");
  });
});

// C6: candidate merge must not drop rows between the funnel stages — every
// absorbed duplicate is ledgered against its survivor instead of vanishing.
describe("candidate ledger merge accounting", () => {
  it("keeps duplicates a merge absorbed visible, so accounting reconciles", () => {
    const ledger = createCandidateLedger();
    // Titles differ enough that ledger identity alone would not bind them —
    // exactly the gap `merged()` closes.
    ledger.streamed({ key: "browser:9", entity_id: "browser:9", title: "Nadia Rahim", company: "Rahim Legal" });
    ledger.merged(
      { key: "browser:9", entity_id: "browser:9", title: "Nadia Rahim", company: "Rahim Legal" },
      { key: "db:9", entity_id: "db:9", title: "Nadia Rahim LLB", company: "Rahim Legal PC" },
    );
    ledger.merged({ key: "db:2", title: "Nadia R." }, { key: "db:9", entity_id: "db:9", title: "Nadia Rahim LLB", company: "Rahim Legal PC" });
    ledger.retrieved({ key: "db:9", entity_id: "db:9", title: "Nadia Rahim LLB", company: "Rahim Legal PC" });
    ledger.delivered([{ key: "db:9", entity_id: "db:9", title: "Nadia Rahim LLB", company: "Rahim Legal PC" }], []);
    const summary = ledger.summary();
    expect(summary.counts).toMatchObject({ returned: 1, absorbed: 2, unaccounted: 0 });
    expect(summary.accounting).toEqual({ retrieved: 3, fated: 3, unaccounted: 0, ok: true });
  });

  it("reports an absorbed streamed lead as merged, not unaccounted", () => {
    const ledger = createCandidateLedger();
    ledger.streamed({ key: "browser:ben", entity_id: "browser:ben", title: "Ben Okafor" });
    ledger.merged({ key: "browser:ben", entity_id: "browser:ben", title: "Ben Okafor" }, { key: "db:ben", title: "Ben Okafor" });
    const summary = ledger.summary();
    expect(summary.counts.unaccounted).toBe(0);
    expect(summary.streamedNotReturned).toEqual([
      { key: "browser:ben", title: "Ben Okafor", fate: "absorbed", reason: "merged into db:ben" },
    ]);
    expect(streamedFateLabel({ fate: "absorbed", reason: "merged into db:ben" })).toBe("merged with a duplicate lead");
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
  it("still reports an unexplained streamed loss on an ordinary successful run", async () => {
    const res = await runSpecSearchCore("B2B SaaS founders with public contact details", {
      people: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
      index: null,
      browserProgress: () => {},
      liveGapfill: { osm: null, web: null, jobs: null, browser: async (_spec, options) => {
        const event = { action: "Researching", row: { key: "lost", entity_id: "lost", kind: "person", title: "Lost founder" } };
        options.onProgress?.(event);
        return [];
      } },
    }, 1, {}, { force: true });
    expect(res.outcome).toBe("NO_QUALIFIED_RESULTS");
    expect(res.candidateLedger?.accounting).toEqual({ retrieved: 1, fated: 1, unaccounted: 1, ok: false });
    expect(res.candidateLedger?.streamedNotReturned).toEqual([
      { key: "lost", title: "Lost founder", fate: "unaccounted", reason: null },
    ]);
  });

  it.each(["SEARCH_CANCELLED", "SEARCH_STALE_RUN"] as const)("reconciles streamed and retrieved candidates after %s", async (code) => {
    const controller = new AbortController();
    const browser = vi.fn<NonNullable<NonNullable<SpecSearchDeps["liveGapfill"]>["browser"]>>(async (_spec, options) => {
      const event = { action: "Researching", row: { key: "streamed", entity_id: "streamed", kind: "person", title: "Streamed founder" } };
      options.onProgress?.(event);
      controller.abort({ code });
      return [];
    });
    const res = await runSpecSearchCore("B2B SaaS founders with public contact details", {
      signal: controller.signal,
      people: (async () => ({ rows: [{ key: "stored", entity_id: "stored", kind: "person", title: "Stored founder", role: "Founder", industry: "B2B SaaS" }], meta: { dbHit: true, engine: "fixture", partitionsRead: [], rowsScanned: 1, rowsReturned: 1 } })) as never,
      index: null,
      browserProgress: () => {},
      liveGapfill: { osm: null, web: null, jobs: null, browser },
    }, 1, {}, { force: true });
    expect(browser).toHaveBeenCalled();
    expect(res.outcome).toBe("SEARCH_CANCELLED");
    expect(res.rows).toEqual([]);
    expect(res.candidateLedger?.accounting).toEqual({ retrieved: 2, fated: 2, unaccounted: 0, ok: true });
    expect(res.candidateLedger?.counts).toMatchObject({ gated: 2, unaccounted: 0 });
    expect(res.candidateLedger?.streamedNotReturned).toEqual([
      { key: "streamed", title: "Streamed founder", fate: "gated", reason: code },
    ]);
  });

  it.each(["success", "cancelled", "error"])("keeps watchdog active while hung, then stops after %s", async (terminal) => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const originalStart = watchdogModule.startRunWatchdog;
    const start = vi.spyOn(watchdogModule, "startRunWatchdog").mockImplementation((options) =>
      originalStart({ ...options, budgetMs: 1_000, intervalMs: 50 }),
    );
    const controller = new AbortController();
    const progress = vi.fn();
    let failFinalLog = false;
    const info = vi.spyOn(console, "info").mockImplementation((message) => {
      if (failFinalLog && typeof message === "string" && message.startsWith("[spec-run] ")) throw new Error("terminal fixture error");
    });
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    let run: ReturnType<typeof runSpecSearchCore> | undefined;
    try {
      run = runSpecSearchCore("B2B SaaS founders with public contact details", {
        signal: controller.signal,
        people: (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never,
        index: null,
        browserProgress: (event) => {
          progress(event);
        },
        liveGapfill: { osm: null, web: null, jobs: null, browser: async () => { entered(); await pending; return []; } },
      }, 1, {}, { force: true });
      await ready;
      await vi.advanceTimersByTimeAsync(1_050);
      expect(progress.mock.calls.some(([event]) => event.source === "watchdog")).toBe(true);
      if (terminal === "cancelled") controller.abort();
      // Final logging is outside provider recovery: a sink failure must also
      // release the watchdog when the core rejects instead of returning.
      if (terminal === "error") {
        failFinalLog = true;
      }
      release();
      if (terminal === "error") await expect(run).rejects.toThrow("terminal fixture error");
      else expect((await run).outcome).toBe(terminal === "cancelled" ? "SEARCH_CANCELLED" : "NO_QUALIFIED_RESULTS");
      expect(start).toHaveBeenCalledOnce();
      const eventCount = progress.mock.calls.filter(([event]) => event.source === "watchdog").length;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(progress.mock.calls.filter(([event]) => event.source === "watchdog")).toHaveLength(eventCount);
    } finally {
      release();
      await run?.catch(() => {});
      info.mockRestore();
      start.mockRestore();
      vi.useRealTimers();
    }
  });

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
