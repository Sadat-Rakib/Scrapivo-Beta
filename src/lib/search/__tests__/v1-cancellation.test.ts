import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveSearchSession } from "../search-run-client";
import { beginRegisteredSearchRun, cancelRegisteredSearchRun } from "../search-run.server";
import { SEARCH_DEADLINE_REASON, SEARCH_STALE_RUN_REASON, searchAbortCode } from "../search-run";
import { enrichIncompleteRows } from "../enrich-incomplete";
import { resilientFetch } from "../http-fetch.server";
import type { SpecRow } from "@/lib/spec-search.functions";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("V1 cancellation boundaries", () => {
  it("rejects a late response after explicit stop even when the id remains active", () => {
    const session = new ActiveSearchSession();
    const { run, signal } = session.begin();
    session.cancel();
    expect(signal.aborted).toBe(true);
    expect(session.accept(run)).toMatchObject({ ok: false, reason: "CANCELLED" });
    expect(session.applyIfActive(run, () => "stale repaint").applied).toBe(false);
  });

  it("isolates cancellation by authenticated owner", () => {
    const one = beginRegisteredSearchRun({ ownerId: "one", runId: "same" });
    const two = beginRegisteredSearchRun({ ownerId: "two", runId: "same" });
    cancelRegisteredSearchRun("one", "same");
    expect(one.signal.aborted).toBe(true);
    expect(two.signal.aborted).toBe(false);
    two.finish();
  });

  it("honors stop arriving before the delayed search request", () => {
    cancelRegisteredSearchRun("early", "delayed");
    const delayed = beginRegisteredSearchRun({ ownerId: "early", runId: "delayed" });
    expect(delayed.signal.aborted).toBe(true);
  });

  it.each([
    ["deadline", SEARCH_DEADLINE_REASON],
    ["stale run", SEARCH_STALE_RUN_REASON],
  ] as const)("preserves a later external %s abort reason", (_label, reason) => {
    const external = new AbortController();
    const registered = beginRegisteredSearchRun({ ownerId: `external-${reason.code}`, runId: crypto.randomUUID(), signal: external.signal });
    external.abort(reason);
    expect(searchAbortCode(registered.signal)).toBe(reason.code);
    registered.finish();
  });

  it("new run in the same conversation stops old work but leaves other conversations alone", () => {
    const first = beginRegisteredSearchRun({ ownerId: "new", runId: "first", conversationId: "chat" });
    const other = beginRegisteredSearchRun({ ownerId: "new", runId: "other", conversationId: "other" });
    const next = beginRegisteredSearchRun({ ownerId: "new", runId: "next", conversationId: "chat" });
    expect(first.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(next.signal.aborted).toBe(false);
    next.finish(); other.finish();
  });

  it("also propagates request disconnect and prevents duplicate work", () => {
    const controller = new AbortController();
    const run = beginRegisteredSearchRun({ ownerId: "request", runId: "active", signal: controller.signal });
    const duplicate = beginRegisteredSearchRun({ ownerId: "request", runId: "active" });
    expect(duplicate.signal.aborted).toBe(true);
    expect(run.signal.aborted).toBe(false);
    controller.abort();
    expect(run.signal.aborted).toBe(true);
    run.finish();
  });
});

const row = (title: string): SpecRow => ({ kind: "person", title, detail: "Founder", email: null, url: null });

describe("V1 enrichment cancellation and failure isolation", () => {
  it("preserves failed candidates while retaining successful enrichment", async () => {
    const result = await enrichIncompleteRows([row("Unavailable"), row("Available")], {
      enrichFn: async (candidate) => {
        if (candidate.title === "Unavailable") throw new Error("provider down");
        return { ...candidate, email: "person@example.com" };
      },
    });
    expect(result.complete.map((candidate) => candidate.title)).toEqual(["Available"]);
    expect(result.stillIncomplete.map((candidate) => candidate.title)).toEqual(["Unavailable"]);
  });

  it("does not launch enrichment when already cancelled", async () => {
    const enrichFn = vi.fn();
    await expect(enrichIncompleteRows([row("Stop")], { signal: AbortSignal.abort(), enrichFn }))
      .rejects.toThrow("SEARCH_CANCELLED");
    expect(enrichFn).not.toHaveBeenCalled();
  });

  it("stops waiting for an adapter that ignores cancellation and discards its late result", async () => {
    const controller = new AbortController();
    let finish!: (candidate: SpecRow) => void;
    let adapterSignal: AbortSignal | null | undefined;
    const pending = enrichIncompleteRows([row("Slow")], {
      signal: controller.signal,
      enrichFn: (_candidate, signal) => {
        adapterSignal = signal;
        return new Promise((resolve) => { finish = resolve; });
      },
    });
    const rejected = expect(pending).rejects.toThrow("SEARCH_CANCELLED");
    controller.abort();
    await rejected;
    expect(adapterSignal?.aborted).toBe(true);
    finish({ ...row("Slow"), email: "late@example.com" });
  });

  it("does not retry HTTP calls after cancellation", async () => {
    vi.stubEnv("CURL_IMPERSONATE_BIN", "");
    const controller = new AbortController();
    const fetch = vi.fn(async () => { controller.abort(); throw new Error("cancelled fetch"); });
    vi.stubGlobal("fetch", fetch);
    await expect(resilientFetch("https://example.com", { retries: 3, signal: controller.signal }))
      .rejects.toThrow("SEARCH_CANCELLED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
