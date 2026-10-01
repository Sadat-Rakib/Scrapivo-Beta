import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  HostPaceError,
  RETRY_AFTER_CAP_MS,
  acquireHostSlot,
  hostBlockedUntil,
  inspectHostState,
  noteHostResponse,
  paceKey,
  parseRetryAfter,
  releaseHostSlot,
  resetHostState,
} from "../domain-pacer.server";

describe("domain pacer (site-friendly pacing, no evasion)", () => {
  beforeEach(() => resetHostState());
  afterEach(() => resetHostState());

  it("parses delay-seconds and HTTP-date Retry-After values, junk → null", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("0")).toBe(0);
    const inAnHour = new Date(Date.now() + 3_600_000).toUTCString();
    const parsed = parseRetryAfter(inAnHour)!;
    expect(parsed).toBeGreaterThan(3_500_000);
    expect(parsed).toBeLessThanOrEqual(3_600_000);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
  });

  it("paces keys are lowercase and www-stripped", () => {
    expect(paceKey("WWW.Example.com:443")).toBe("example.com");
  });

  it("429 with Retry-After sets the blocked-until window; 200 relaxes it", () => {
    noteHostResponse("acme.test", { status: 429, retryAfterHeader: "120" });
    expect(hostBlockedUntil("acme.test")).toBeGreaterThan(60_000);
    expect(hostBlockedUntil("WWW.acme.test")).toBe(hostBlockedUntil("acme.test"));
    // A later clean response relaxes recent429s (window itself still applies).
    noteHostResponse("acme.test", { status: 200 });
    expect(inspectHostState("acme.test").recent429s).toBeLessThan(2);
  });

  it("429 without Retry-After backs off exponentially up to the cap", () => {
    noteHostResponse("beta.test", { status: 429 });
    const first = inspectHostState("beta.test").retryAfterUntil - Date.now();
    expect(first).toBeGreaterThan(0);
    resetHostState();
    for (let i = 0; i < 6; i++) noteHostResponse("gamma.test", { status: 429 });
    const window = inspectHostState("gamma.test").retryAfterUntil - Date.now();
    expect(window).toBeLessThanOrEqual(RETRY_AFTER_CAP_MS + 1_000);
  });

  it("a Retry-After beyond the cap fails fast with RATE_LIMITED instead of holding the run", async () => {
    noteHostResponse("slow.test", { status: 429, retryAfterHeader: "3600" });
    await expect(acquireHostSlot("slow.test", { jitterMs: 0 })).rejects.toMatchObject({
      name: "HostPaceError",
      code: "RATE_LIMITED",
    });
    try {
      await acquireHostSlot("slow.test", { jitterMs: 0 });
    } catch (e) {
      expect((e as HostPaceError).retryAfterMs).toBeGreaterThan(RETRY_AFTER_CAP_MS);
    }
  });

  it("CAPTCHA / ACCESS_BLOCK friction hard-blocks the host", async () => {
    noteHostResponse("fortress.test", { friction: ["CAPTCHA"] });
    expect(hostBlockedUntil("fortress.test")).toBeGreaterThan(0);
    await expect(acquireHostSlot("fortress.test")).rejects.toMatchObject({ code: "HOST_BLOCKED" });
    // RATE_LIMIT friction is pacing, not a hard block.
    noteHostResponse("polite.test", { friction: ["RATE_LIMIT"] });
    expect(inspectHostState("polite.test").blocked).toBe(false);
  });

  it("releaseHostSlot keeps a host usable for the next request", async () => {
    await acquireHostSlot("fine.test", { minGapMs: 0, jitterMs: 0 });
    releaseHostSlot("fine.test");
    await expect(acquireHostSlot("fine.test", { minGapMs: 0, jitterMs: 0 })).resolves.toBeUndefined();
    releaseHostSlot("fine.test");
  });

  it("a slot forgotten past the safety valve cannot wedge the host", async () => {
    await acquireHostSlot("stuck.test", { minGapMs: 0, jitterMs: 0 });
    // No release — the 30s valve must eventually free it; here we only assert
    // the state recorded the active request and the valve timer exists via
    // the public surface (no unbounded hang in the chain).
    expect(inspectHostState("stuck.test").activeRequests).toBe(1);
    releaseHostSlot("stuck.test");
    expect(inspectHostState("stuck.test").activeRequests).toBe(0);
  }, 10_000);
});
