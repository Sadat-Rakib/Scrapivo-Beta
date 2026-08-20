/**
 * Shared provider rate limiter — prevents Discover/Local/Jobs from independently
 * blowing Serper / SearXNG / ScrapeCreators budgets.
 */
type Bucket = {
  windowStart: number;
  count: number;
};

const BUCKETS = new Map<string, Bucket>();

export type ProviderBudget = {
  /** Max calls per window. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
};

const DEFAULTS: Record<string, ProviderBudget> = {
  serper: { max: 40, windowMs: 60_000 },
  serpapi: { max: 30, windowMs: 60_000 },
  searxng: { max: 60, windowMs: 60_000 },
  scrapecreators: { max: 20, windowMs: 60_000 },
  greenhouse: { max: 80, windowMs: 60_000 },
  lever: { max: 40, windowMs: 60_000 },
  ashby: { max: 40, windowMs: 60_000 },
  default: { max: 50, windowMs: 60_000 },
};

export function getProviderBudget(provider: string): ProviderBudget {
  return DEFAULTS[provider.toLowerCase()] || DEFAULTS.default;
}

/** Returns true if the call is allowed; increments the counter when allowed. */
export function tryConsumeProvider(provider: string, n = 1): boolean {
  const key = provider.toLowerCase();
  const budget = getProviderBudget(key);
  const now = Date.now();
  let b = BUCKETS.get(key);
  if (!b || now - b.windowStart >= budget.windowMs) {
    b = { windowStart: now, count: 0 };
    BUCKETS.set(key, b);
  }
  if (b.count + n > budget.max) return false;
  b.count += n;
  return true;
}

/** Wait until a slot is available or timeout. */
export async function awaitProviderSlot(
  provider: string,
  opts?: { timeoutMs?: number; n?: number },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const n = opts?.n ?? 1;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (tryConsumeProvider(provider, n)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return tryConsumeProvider(provider, n);
}

export function providerUsageSnapshot(): Record<string, { count: number; max: number }> {
  const out: Record<string, { count: number; max: number }> = {};
  for (const [k, b] of BUCKETS) {
    out[k] = { count: b.count, max: getProviderBudget(k).max };
  }
  return out;
}

/** Test helper */
export function clearProviderBuckets(): void {
  BUCKETS.clear();
}
