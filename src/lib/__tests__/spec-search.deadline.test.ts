import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";
import { extractSearchSpec } from "../search/search-spec-extract";

const query = "SaaS companies in Canada";
const spec = { ...extractSearchSpec(query), mode: "browsing" as const };
const emptyDb = async () => ({ rows: [], meta: { dbHit: false, engine: "s3-parquet", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } });
const deps = { companies: emptyDb as never, index: null, enrichFn: null };
const stageLatch = () => {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  return { enter, entered };
};
const atDeadline = async <T>(work: Promise<T>, stage: ReturnType<typeof stageLatch>): Promise<T> => {
  // Module transforms do not consume the search clock. Advance only once the
  // operation under test actually owns the root signal and is awaiting work.
  await stage.entered;
  await vi.advanceTimersByTimeAsync(301);
  return work;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("root search deadline", () => {
  it("settles a non-cooperative stored reader without claiming complete zero results", async () => {
    const started = Date.now();
    const stage = stageLatch();
    const reader = vi.fn(() => { stage.enter(); return new Promise(() => {}); });
    const result = await atDeadline(runSpecSearchCore(query, { ...deps, companies: reader as never }, 5, {}, { spec, force: true, runBudgetMs: 300 }), stage);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.outcome).toBe("SEARCH_FAILED");
    expect(result.diagnostics?.some((d) => d.detail?.includes("SEARCH_DEADLINE"))).toBe(true);
    expect(reader).toHaveBeenCalled();
  });

  it("aborts hanging discovery and never starts a browser after late source completion", async () => {
    let observed: AbortSignal | null | undefined;
    let resolveSource!: (value: []) => void;
    const stage = stageLatch();
    const browser = vi.fn(async () => []);
    const web = vi.fn((_q, _loc, _entity, _spec, options) => {
      observed = options?.signal;
      stage.enter();
      return new Promise<[]>(resolve => { resolveSource = resolve; });
    });
    const result = await atDeadline(runSpecSearchCore(query, { ...deps, liveGapfill: { web, browser } }, 5, {}, { spec, force: true, runBudgetMs: 300 }), stage);
    expect(web).toHaveBeenCalled();
    expect(observed?.aborted).toBe(true);
    expect(observed?.reason).toEqual({ code: "SEARCH_DEADLINE" });
    expect(result.outcome).toBe("SEARCH_FAILED");
    expect(result.candidateLedger?.accounting?.ok).toBe(true);
    expect(result.candidateLedger?.counts.returned).toBe(result.rows.length);
    resolveSource([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(browser).not.toHaveBeenCalled();
  });

  it("aborts a hanging browser and ignores its late progress", async () => {
    let observed: AbortSignal | null | undefined;
    let lateProgress: (() => void) | undefined;
    const progress = vi.fn();
    const stage = stageLatch();
    const browser = vi.fn((_spec, options) => {
      observed = options.signal;
      stage.enter();
      lateProgress = () => options.onProgress?.({ action: "late" });
      return new Promise<[]>(() => {});
    });
    await atDeadline(runSpecSearchCore(query, { ...deps, browserProgress: progress, liveGapfill: { web: async () => [], browser } }, 5, {}, { spec, force: true, runBudgetMs: 300 }), stage);
    expect(browser).toHaveBeenCalled();
    expect(observed?.aborted).toBe(true);
    const calls = progress.mock.calls.length;
    lateProgress?.();
    expect(progress).toHaveBeenCalledTimes(calls);
  });

  it("preserves external cancellation and request isolation", async () => {
    const controller = new AbortController();
    const pending = runSpecSearchCore(query, { ...deps, signal: controller.signal, companies: (() => new Promise(() => {})) as never }, 5, {}, { spec, force: true, runBudgetMs: 5000 });
    controller.abort({ code: "SEARCH_STALE_RUN" });
    const result = await pending;
    expect(result.outcome).toBe("SEARCH_CANCELLED");
    expect(result.rows).toEqual([]);
    const next = await runSpecSearchCore("businesses", {}, 5);
    expect(next.search_run_id).not.toBe(result.search_run_id);
    expect(next.outcome).not.toBe("SEARCH_CANCELLED");
  });

  it("returns previously qualified rows with a complete terminal ledger on timeout", async () => {
    const stage = stageLatch();
    const companies = async () => ({
      rows: [{ company_name: "Acme SaaS", category: "SaaS", location: "Toronto", country: "CA", website: "https://acme.example", email: "hello@acme.example", phone: null }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
    });
    const result = await atDeadline(runSpecSearchCore(query, { ...deps, companies: companies as never, liveGapfill: { web: async () => { stage.enter(); return new Promise(() => {}); }, browser: null } }, 5, {}, { spec, force: true, runBudgetMs: 300 }), stage);
    expect(result.rows).toHaveLength(1);
    expect(result.outcome).toBe("QUALIFIED_RESULTS");
    expect(result.totalAvailable).toBeNull();
    expect(result.candidateLedger?.accounting).toMatchObject({ ok: true, unaccounted: 0 });
    expect(result.candidateLedger?.accounting?.retrieved).toBe(result.candidateLedger?.accounting?.fated);
    expect(result.candidateLedger?.counts.returned).toBe(result.rows.length);
  });

  it("propagates the root deadline through the default OSM adapter to its HTTP request", async () => {
    let httpSignal: AbortSignal | null | undefined;
    const stage = stageLatch();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_input, options) => {
      httpSignal = options?.signal;
      stage.enter();
      return new Promise<Response>((_resolve, reject) => {
        httpSignal?.addEventListener("abort", () => reject(httpSignal?.reason), { once: true });
      });
    });
    try {
      const localQuery = "plumbers in Austin";
      const result = await atDeadline(runSpecSearchCore(localQuery, {
        index: null, businesses: emptyDb as never, providerBusinesses: null, enrichFn: null,
        liveGapfill: { web: null, browser: null },
      }, 5, {}, { spec: extractSearchSpec(localQuery), force: true, runBudgetMs: 300 }), stage);
      expect(fetch).toHaveBeenCalled();
      expect(httpSignal?.aborted).toBe(true);
      expect(httpSignal?.reason).toEqual({ code: "SEARCH_DEADLINE" });
      expect(result.outcome).toBe("SEARCH_FAILED");
    } finally {
      fetch.mockRestore();
    }
  });
});

