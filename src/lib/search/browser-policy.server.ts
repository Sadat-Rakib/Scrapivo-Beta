/**
 * BrowserNavigationPolicy — Workstream E: one place for how fast, how often
 * and how much the browser may navigate.
 *
 * The old behavior was double-broken: individual actions fired as fast as
 * Chromium allowed (same-domain pages hammering each other), while the run as
 * a whole leaked time into irrelevant pages because budgets lived as magic
 * numbers scattered across modules (40 here, 42 there, 6 somewhere else).
 * Centralizing the policy fixes both: pacing becomes explicit and
 * site-friendly, budgets become auditable.
 *
 * Site-friendly, not evasive: spacing and backoff exist so we stop pressuring
 * servers and stop wasting the run budget on blocked sources — never to dodge
 * protections. Defaults are conservative; env overrides exist for ops.
 */

export type BrowserNavigationPolicy = {
  /** Minimum spacing between two navigations to the same registrable domain. */
  minDomainIntervalMs: number;
  /** Hard navigation timeout. */
  navigationTimeoutMs: number;
  /** Extra wait for useful content after domcontentloaded. */
  contentReadyTimeoutMs: number;
  /** Base for exponential retry backoff (base * 2^attempt). */
  retryBackoffBaseMs: number;
  maxRetriesPerNavigation: number;
  /** Cooldown after rate-limit / block signals from a domain. */
  domainCooldownMs: number;
  /** Server-supplied Retry-After is capped so one hostile header cannot stall a run. */
  maxRetryAfterMs: number;
  maxPagesPerDomain: number;
  maxPagesPerCandidate: number;
  maxPagesPerRun: number;
  maxQueriesPerRun: number;
};

export const DEFAULT_NAVIGATION_POLICY: BrowserNavigationPolicy = {
  minDomainIntervalMs: 1_500,
  navigationTimeoutMs: 20_000,
  contentReadyTimeoutMs: 4_000,
  retryBackoffBaseMs: 1_000,
  maxRetriesPerNavigation: 2,
  domainCooldownMs: 30_000,
  maxRetryAfterMs: 60_000,
  maxPagesPerDomain: 4,
  maxPagesPerCandidate: 3,
  maxPagesPerRun: 30,
  maxQueriesPerRun: 24,
};

const NUMERIC_ENV: Array<{ key: string; field: keyof BrowserNavigationPolicy; min: number; max: number }> = [
  { key: "SCRAPIVO_NAV_MIN_DOMAIN_INTERVAL_MS", field: "minDomainIntervalMs", min: 0, max: 60_000 },
  { key: "SCRAPIVO_NAV_TIMEOUT_MS", field: "navigationTimeoutMs", min: 2_000, max: 120_000 },
  { key: "SCRAPIVO_NAV_CONTENT_READY_MS", field: "contentReadyTimeoutMs", min: 0, max: 30_000 },
  { key: "SCRAPIVO_NAV_BACKOFF_BASE_MS", field: "retryBackoffBaseMs", min: 0, max: 30_000 },
  { key: "SCRAPIVO_NAV_MAX_RETRIES", field: "maxRetriesPerNavigation", min: 0, max: 6 },
  { key: "SCRAPIVO_NAV_DOMAIN_COOLDOWN_MS", field: "domainCooldownMs", min: 0, max: 600_000 },
  { key: "SCRAPIVO_NAV_MAX_RETRY_AFTER_MS", field: "maxRetryAfterMs", min: 1_000, max: 600_000 },
  { key: "SCRAPIVO_NAV_MAX_PAGES_PER_DOMAIN", field: "maxPagesPerDomain", min: 1, max: 40 },
  { key: "SCRAPIVO_NAV_MAX_PAGES_PER_CANDIDATE", field: "maxPagesPerCandidate", min: 1, max: 20 },
  { key: "SCRAPIVO_NAV_MAX_PAGES_PER_RUN", field: "maxPagesPerRun", min: 1, max: 120 },
  { key: "SCRAPIVO_NAV_MAX_QUERIES_PER_RUN", field: "maxQueriesPerRun", min: 1, max: 80 },
];

/** Policy with env overrides. Out-of-range values fall back to the default. */
export function resolveNavigationPolicy(env: Record<string, string | undefined> = process.env): BrowserNavigationPolicy {
  const policy: BrowserNavigationPolicy = { ...DEFAULT_NAVIGATION_POLICY };
  for (const { key, field, min, max } of NUMERIC_ENV) {
    const raw = env[key];
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= min && value <= max) {
      policy[field] = value;
    }
  }
  return policy;
}

/** Exponential backoff for attempt n (0-based), capped by the policy. */
export function retryBackoffMs(policy: BrowserNavigationPolicy, attempt: number): number {
  const raw = policy.retryBackoffBaseMs * 2 ** Math.max(0, attempt);
  return Math.min(raw, policy.domainCooldownMs || raw);
}

/**
 * Per-run domain health — which sources answered, which pressed back. Scoped
 * to ONE run: a temporary failure must never permanently blacklist a useful
 * domain (PRD §22).
 */
export type DomainHealthState = "available" | "rate_limited" | "challenge_required" | "auth_required" | "blocked" | "temporary_failure";

export type DomainHealth = {
  pagesOpened: number;
  rateLimitedAt: number | null;
  challengeAt: number | null;
  authRequiredAt: number | null;
  consecutiveFailures: number;
  lastStatus: DomainHealthState;
};

export function createDomainHealthLedger(policy: BrowserNavigationPolicy, now = Date.now) {
  const domains = new Map<string, DomainHealth>();

  const host = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return url;
    }
  };

  const entry = (url: string): DomainHealth => {
    const key = host(url);
    let e = domains.get(key);
    if (!e) {
      e = { pagesOpened: 0, rateLimitedAt: null, challengeAt: null, authRequiredAt: null, consecutiveFailures: 0, lastStatus: "available" };
      domains.set(key, e);
    }
    return e;
  };

  return {
    /** True when the domain has not been hammered and no cooldown is active. */
    canNavigate(url: string, at = now()): boolean {
      const e = entry(url);
      if (e.pagesOpened >= policy.maxPagesPerDomain) return false;
      if (e.lastStatus === "rate_limited" && e.rateLimitedAt != null && at - e.rateLimitedAt < policy.domainCooldownMs) return false;
      if (e.lastStatus === "challenge_required" && e.challengeAt != null && at - e.challengeAt < policy.domainCooldownMs) return false;
      if (e.lastStatus === "blocked") return false;
      return true;
    },
    notePageOpened(url: string, at = now()): void {
      const e = entry(url);
      e.pagesOpened += 1;
      e.consecutiveFailures = 0;
      e.lastStatus = "available";
    },
    noteRateLimited(url: string, retryAfterMs = policy.domainCooldownMs, at = now()): void {
      const e = entry(url);
      e.lastStatus = "rate_limited";
      e.rateLimitedAt = at;
      e.consecutiveFailures += 1;
      void retryAfterMs;
    },
    noteChallenge(url: string, at = now()): void {
      const e = entry(url);
      e.lastStatus = "challenge_required";
      e.challengeAt = at;
    },
    noteAuthRequired(url: string, at = now()): void {
      const e = entry(url);
      e.lastStatus = "auth_required";
      e.authRequiredAt = at;
    },
    noteBlocked(url: string, at = now()): void {
      const e = entry(url);
      e.lastStatus = "blocked";
    },
    noteTemporaryFailure(url: string, at = now()): void {
      const e = entry(url);
      e.lastStatus = "temporary_failure";
      e.consecutiveFailures += 1;
      void at;
    },
    healthOf(url: string): DomainHealth | null {
      return domains.get(host(url)) ?? null;
    },
    /** User-safe summary for the honest-zero screen (no internal names beyond hosts already shown to the user). */
    blockedCount(): number {
      let n = 0;
      for (const e of domains.values()) if (e.lastStatus === "blocked" || e.lastStatus === "rate_limited") n += 1;
      return n;
    },
  };
}

export type DomainHealthLedger = ReturnType<typeof createDomainHealthLedger>;
