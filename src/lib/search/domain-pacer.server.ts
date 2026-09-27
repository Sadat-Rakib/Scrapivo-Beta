/**
 * Domain pacer — per-host runtime state so the network layer stays
 * host-respectful (beta spec §49).
 *
 * Pure in-memory, single-process. One request in flight per host by default,
 * minimum spacing between requests (politeness gap or robots crawl-delay,
 * whichever is larger, plus small jitter), Retry-After honored on 429/503
 * (wait up to RETRY_AFTER_CAP_MS — beyond that the attempt fails fast with a
 * typed RATE_LIMITED error instead of holding the run), decaying error rate,
 * and hard blocks/challenges recorded from browser friction.
 *
 * No random mouse motion, no evasion behavior — pacing only.
 */

export type HostPaceErrorCode = "RATE_LIMITED" | "HOST_BLOCKED";

/** Typed pacing failure — callers already treat thrown fetch errors as failures. */
export class HostPaceError extends Error {
  code: HostPaceErrorCode;
  retryAfterMs?: number;
  host: string;

  constructor(code: HostPaceErrorCode, host: string, retryAfterMs?: number) {
    super(code === "RATE_LIMITED"
      ? `Host rate limited: ${host} (retry after ${Math.round((retryAfterMs ?? 0) / 1000)}s)`
      : `Host blocked: ${host}`);
    this.name = "HostPaceError";
    this.code = code;
    this.host = host;
    if (retryAfterMs != null) this.retryAfterMs = retryAfterMs;
  }
}

export interface AcquireHostSlotOptions {
  /** robots.txt crawl-delay override for this request (ms). */
  crawlDelayMs?: number;
  /** Minimum spacing between requests to the same host (ms). */
  minGapMs?: number;
  /** Random jitter added to the wait (ms). */
  jitterMs?: number;
  /** Max concurrent requests to this host (default 1). */
  maxConcurrent?: number;
}

export interface NoteHostResponseInput {
  status?: number;
  /** Raw Retry-After header value: delay-seconds or HTTP-date. */
  retryAfterHeader?: string | null;
  /** Browser friction markers observed on the snapshot (BrowserFriction values). */
  friction?: readonly string[];
  /** Network-level failure (DNS, timeout, abort) with no HTTP status. */
  networkError?: boolean;
}

interface HostPaceState {
  lastRequestAt: number;
  lastBrowserActionAt: number;
  activeRequests: number;
  recent429s: number;
  retryAfterUntil: number;
  crawlDelayMs: number;
  blocked: boolean;
  challenge: boolean;
  blockedUntil: number;
  errorRate: number;
  errorUpdatedAt: number;
  /** Serialization chain: each acquire appends one segment. */
  chain: Promise<void>;
}

const DEFAULT_MIN_GAP_MS = 250;
const DEFAULT_JITTER_MS = 150;
/** Never hold the run longer than this waiting out a Retry-After. */
export const RETRY_AFTER_CAP_MS = 60_000;
/** Backoff for 429/503 without a Retry-After header. */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5_000;
/** How long a CAPTCHA/ACCESS_BLOCK friction mark degrades a host. */
const HOST_BLOCK_MS = 10 * 60_000;
/** Safety valve: a slot held longer than this auto-releases. */
const SLOT_HOLD_TIMEOUT_MS = 30_000;
/** Poll interval while waiting for a held slot. */
const SLOT_WAIT_POLL_MS = 20;

const states = new Map<string, HostPaceState>();

/** Lowercase, www-stripped host key. */
export function paceKey(host: string): string {
  return (host || "").trim().toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
}

function stateFor(host: string): HostPaceState {
  const key = paceKey(host);
  let state = states.get(key);
  if (!state) {
    state = {
      lastRequestAt: 0,
      lastBrowserActionAt: 0,
      activeRequests: 0,
      recent429s: 0,
      retryAfterUntil: 0,
      crawlDelayMs: 0,
      blocked: false,
      challenge: false,
      blockedUntil: 0,
      errorRate: 0,
      errorUpdatedAt: 0,
      chain: Promise.resolve(),
    };
    states.set(key, state);
  }
  return state;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Parse a Retry-After value: delay-seconds OR HTTP-date. Returns ms, or null. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, date - now);
  }
  return null;
}

/** Time-decayed error rate (halves every ~30s). */
function decayedErrorRate(state: HostPaceState, now: number): number {
  if (!state.errorUpdatedAt) return state.errorRate;
  const elapsed = Math.max(0, now - state.errorUpdatedAt);
  return state.errorRate * Math.exp(-elapsed / 30_000);
}

function releaseSlot(state: HostPaceState): void {
  state.activeRequests = Math.max(0, state.activeRequests - 1);
}

/**
 * Reserve the next request slot for `host`. Resolves when the caller may send:
 * at most `maxConcurrent` (default 1) requests in flight, spaced at least
 * max(minGapMs, crawlDelayMs) + jitter after the previous request.
 *
 * Throws HostPaceError when the host must not be contacted right now:
 *   - RATE_LIMITED with retryAfterMs when a Retry-After window extends beyond
 *     RETRY_AFTER_CAP_MS (fail the attempt instead of holding the run);
 *   - HOST_BLOCKED when friction marked the host blocked/challenged.
 * Callers MUST eventually call releaseHostSlot(host) (try/finally); unreleased
 * slots auto-expire after SLOT_HOLD_TIMEOUT_MS so a forgotten release cannot
 * wedge the host.
 */
export async function acquireHostSlot(host: string, opts: AcquireHostSlotOptions = {}): Promise<void> {
  const state = stateFor(host);
  const minGapMs = Math.max(0, opts.minGapMs ?? DEFAULT_MIN_GAP_MS);
  const jitterMs = Math.max(0, opts.jitterMs ?? DEFAULT_JITTER_MS);
  const maxConcurrent = Math.max(1, opts.maxConcurrent ?? 1);
  if (opts.crawlDelayMs != null && opts.crawlDelayMs >= 0) state.crawlDelayMs = opts.crawlDelayMs;

  const segment = state.chain.then(async () => {
    // Hard block / challenge recorded from browser friction.
    const now0 = Date.now();
    if (state.blocked && state.blockedUntil > now0) {
      throw new HostPaceError("HOST_BLOCKED", paceKey(host), state.blockedUntil - now0);
    }
    if (state.blocked && state.blockedUntil <= now0) state.blocked = false;

    // Retry-After window: wait up to the cap; beyond it, fail fast.
    const now1 = Date.now();
    if (state.retryAfterUntil > now1) {
      const remaining = state.retryAfterUntil - now1;
      if (remaining > RETRY_AFTER_CAP_MS) {
        throw new HostPaceError("RATE_LIMITED", paceKey(host), remaining);
      }
      await sleep(remaining + (jitterMs ? Math.random() * jitterMs : 0));
    }

    // Concurrency: wait for a held slot (with a stale-slot safety valve).
    const waitStart = Date.now();
    while (state.activeRequests >= maxConcurrent) {
      await sleep(SLOT_WAIT_POLL_MS);
      if (Date.now() - waitStart > SLOT_HOLD_TIMEOUT_MS) break; // stale holder — proceed politely
    }

    // Spacing: honor max(min gap, crawl delay) since the last admitted request.
    const now2 = Date.now();
    const gap = Math.max(minGapMs, state.crawlDelayMs);
    const elapsed = now2 - state.lastRequestAt;
    if (state.lastRequestAt > 0 && elapsed < gap) {
      await sleep(gap - elapsed + (jitterMs ? Math.random() * jitterMs : 0));
    }

    state.lastRequestAt = Date.now();
    state.activeRequests += 1;
    // Safety valve: a forgotten release must not wedge the host forever.
    const heldAt = state.lastRequestAt;
    const valve = setTimeout(() => {
      if (state.activeRequests > 0 && Date.now() - heldAt >= SLOT_HOLD_TIMEOUT_MS) releaseSlot(state);
    }, SLOT_HOLD_TIMEOUT_MS + 1_000) as unknown as { unref?: () => void };
    valve.unref?.();
  });

  // Keep the chain alive even when a segment throws (blocked hosts).
  state.chain = segment.catch(() => undefined);
  return segment;
}

/** Release a slot acquired by acquireHostSlot. Always call in finally. */
export function releaseHostSlot(host: string): void {
  releaseSlot(stateFor(host));
}

/**
 * Record a response/failure for `host`. Parses Retry-After (seconds or
 * HTTP-date) on 429/503 and sets the retryAfterUntil window; tracks a decaying
 * error rate; records hard blocks/challenges from browser friction.
 */
export function noteHostResponse(host: string, input: NoteHostResponseInput = {}): void {
  const state = stateFor(host);
  const now = Date.now();
  const status = input.status ?? 0;

  if (input.friction?.length) {
    for (const raw of input.friction) {
      const f = String(raw).trim().toUpperCase();
      if (f === "CAPTCHA" || f === "ACCESS_BLOCK") {
        state.blocked = true;
        state.challenge = true;
        state.blockedUntil = now + HOST_BLOCK_MS;
      } else if (f === "RATE_LIMIT") {
        state.recent429s += 1;
        state.retryAfterUntil = Math.max(state.retryAfterUntil, now + DEFAULT_RATE_LIMIT_BACKOFF_MS);
      }
      // LOGIN_WALL / MODAL / COOKIE_BANNER are page-level, not host pacing.
    }
  }

  if (status === 429 || status === 503) {
    state.recent429s += 1;
    const parsed = parseRetryAfter(input.retryAfterHeader, now);
    const window = parsed != null
      ? parsed
      : Math.min(DEFAULT_RATE_LIMIT_BACKOFF_MS * 2 ** (state.recent429s - 1), RETRY_AFTER_CAP_MS);
    state.retryAfterUntil = Math.max(state.retryAfterUntil, now + window);
  }

  const isError = input.networkError || status === 0 || status >= 400;
  state.errorRate = decayedErrorRate(state, now) * 0.5 + (isError ? 0.5 : 0);
  state.errorUpdatedAt = now;
  if (!isError) state.recent429s = Math.floor(state.recent429s / 2);
}

/** Record a browser navigation against the host's pacing state. */
export function noteBrowserAction(host: string, input: NoteHostResponseInput = {}): void {
  const state = stateFor(host);
  state.lastBrowserActionAt = Date.now();
  noteHostResponse(host, input);
}

/** Epoch ms until which the host should not be contacted (0 = free now). */
export function hostBlockedUntil(host: string): number {
  const state = states.get(paceKey(host));
  if (!state) return 0;
  const now = Date.now();
  const blockedUntil = state.blocked && state.blockedUntil > now ? state.blockedUntil : 0;
  const retryUntil = state.retryAfterUntil > now ? state.retryAfterUntil : 0;
  return Math.max(blockedUntil, retryUntil);
}

/** Read-only copy of a host's pacing state (diagnostics/tests). */
export function inspectHostState(host: string): Readonly<HostPaceState> {
  return { ...stateFor(host) };
}

/** Clear all pacing state (tests only). */
export function resetHostState(): void {
  states.clear();
}

/** Hosts that must never be paced or contacted — refused before any I/O. */
export function isLoopbackHost(host: string): boolean {
  const h = (host || "").trim().toLowerCase();
  return !h || h === "localhost" || h === "::1" || h === "[::1]" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /\.(local|internal|localhost)$/i.test(h);
}
