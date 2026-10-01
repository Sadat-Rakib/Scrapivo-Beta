import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAVIGATION_POLICY,
  createDomainHealthLedger,
  resolveNavigationPolicy,
  retryBackoffMs,
} from "../browser-policy.server";

describe("BrowserNavigationPolicy", () => {
  it("defaults are conservative and site-friendly", () => {
    const p = resolveNavigationPolicy({});
    expect(p).toEqual(DEFAULT_NAVIGATION_POLICY);
    expect(p.minDomainIntervalMs).toBeGreaterThan(0);
    expect(p.maxPagesPerDomain).toBeLessThanOrEqual(p.maxPagesPerRun);
  });

  it("applies in-range env overrides and rejects out-of-range junk", () => {
    const p = resolveNavigationPolicy({
      SCRAPIVO_NAV_MIN_DOMAIN_INTERVAL_MS: "5000",
      SCRAPIVO_NAV_MAX_PAGES_PER_RUN: "17",
      SCRAPIVO_NAV_MAX_PAGES_PER_DOMAIN: "9999",
      SCRAPIVO_NAV_TIMEOUT_MS: "not-a-number",
    });
    expect(p.minDomainIntervalMs).toBe(5_000);
    expect(p.maxPagesPerRun).toBe(17);
    expect(p.maxPagesPerDomain).toBe(DEFAULT_NAVIGATION_POLICY.maxPagesPerDomain);
    expect(p.navigationTimeoutMs).toBe(DEFAULT_NAVIGATION_POLICY.navigationTimeoutMs);
  });

  it("backoff grows exponentially and is capped by the domain cooldown", () => {
    const p = { ...DEFAULT_NAVIGATION_POLICY, retryBackoffBaseMs: 1_000, domainCooldownMs: 30_000 };
    expect(retryBackoffMs(p, 0)).toBe(1_000);
    expect(retryBackoffMs(p, 2)).toBe(4_000);
    expect(retryBackoffMs(p, 10)).toBe(30_000);
  });
});

describe("domain health ledger (scoped to one run)", () => {
  const policy = DEFAULT_NAVIGATION_POLICY;

  it("blocks navigation past the per-domain page budget", () => {
    const ledger = createDomainHealthLedger(policy);
    for (let i = 0; i < policy.maxPagesPerDomain; i++) ledger.notePageOpened("https://acme.example/a");
    expect(ledger.canNavigate("https://acme.example/b")).toBe(false);
    expect(ledger.canNavigate("https://other.example/")).toBe(true);
  });

  it("cools down a rate-limited domain, then recovers", () => {
    const ledger = createDomainHealthLedger(policy);
    ledger.noteRateLimited("https://acme.example/", policy.domainCooldownMs, 1_000);
    expect(ledger.canNavigate("https://acme.example/x", 2_000)).toBe(false);
    expect(ledger.canNavigate("https://acme.example/x", 1_000 + policy.domainCooldownMs + 1)).toBe(true);
  });

  it("hard-stops blocked domains but not the whole run", () => {
    const ledger = createDomainHealthLedger(policy);
    ledger.noteBlocked("https://blocked.example/", 1_000);
    expect(ledger.canNavigate("https://blocked.example/x", 999_999_999)).toBe(false);
    expect(ledger.canNavigate("https://fine.example/", 1_000)).toBe(true);
    expect(ledger.blockedCount()).toBe(1);
  });

  it("tracks challenge and auth states without blacklisting", () => {
    const ledger = createDomainHealthLedger(policy);
    ledger.noteChallenge("https://c.example/", 1_000);
    expect(ledger.canNavigate("https://c.example/", 2_000)).toBe(false);
    ledger.noteAuthRequired("https://a.example/", 1_000);
    expect(ledger.healthOf("https://a.example/")?.lastStatus).toBe("auth_required");
    ledger.noteTemporaryFailure("https://t.example/", 1_000);
    expect(ledger.canNavigate("https://t.example/", 2_000)).toBe(true);
  });
});
