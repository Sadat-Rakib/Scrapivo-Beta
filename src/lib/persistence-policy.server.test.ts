import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetPersistencePolicyForTests,
  drainSkippedPersistence,
  localNoPersistActive,
  skipPersistence,
} from "./persistence-policy.server";

const LOCAL = { SCRAPIVO_LOCAL_NO_PERSIST: "true", NODE_ENV: "development" } as NodeJS.ProcessEnv;

describe("local no-persist policy", () => {
  afterEach(() => {
    __resetPersistencePolicyForTests();
    vi.restoreAllMocks();
  });

  it("is active only when the flag is set outside production", () => {
    expect(localNoPersistActive(LOCAL)).toBe(true);
    expect(localNoPersistActive({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(localNoPersistActive({ ...LOCAL, SCRAPIVO_LOCAL_NO_PERSIST: "false" })).toBe(false);
    expect(localNoPersistActive({ ...LOCAL, SCRAPIVO_LOCAL_NO_PERSIST: "1" })).toBe(false);
  });

  it("is ignored in production and on Vercel so real persistence can never be disabled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(localNoPersistActive({ ...LOCAL, NODE_ENV: "production" })).toBe(false);
    expect(localNoPersistActive({ ...LOCAL, VERCEL: "1" })).toBe(false);
    expect(localNoPersistActive({ ...LOCAL, VERCEL_ENV: "preview" })).toBe(false);
    // One warning per process, not per call.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/ignored/i);
  });

  it("skips a write target and records it once per drain window", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(skipPersistence("qualified_leads", LOCAL)).toBe(true);
    expect(skipPersistence("qualified_leads", LOCAL)).toBe(true);
    expect(skipPersistence("source_health", LOCAL)).toBe(true);
    expect(drainSkippedPersistence()).toEqual(["qualified_leads", "source_health"]);
    expect(drainSkippedPersistence()).toEqual([]);
  });

  it("never skips when inactive, so production writes proceed", () => {
    expect(skipPersistence("qualified_leads", { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(skipPersistence("qualified_leads", { ...LOCAL, NODE_ENV: "production" })).toBe(false);
    expect(drainSkippedPersistence()).toEqual([]);
  });

  it("emits a sanitized diagnostic naming only the target", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    skipPersistence("search_history", LOCAL);
    skipPersistence("search_history", LOCAL);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toBe("[persistence] local no-persist active: skipped search_history");
  });
});
