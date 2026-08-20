/**
 * Scrapivo — Cache Manager
 *
 * Multi-tier caching layer for expensive external operations.
 * In-memory LRU with TTL expiry and provenance tracking.
 *
 * §27: Cache company enrichment, website enrichment, tech stack lookup,
 * email verification, Google Maps results, and demand signals.
 */

interface CacheEntry<T> {
  value: T;
  source: string;
  fetched_at: number;
  expires_at: number;
}

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_ENTRIES = 2000;

class CacheManagerImpl {
  private store = new Map<string, CacheEntry<unknown>>();

  /** Get a cached value by key. Returns null on miss or expiry. */
  get<T>(key: string): { value: T; source: string; fetched_at: string } | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expires_at) {
      this.store.delete(key);
      return null;
    }

    return {
      value: entry.value,
      source: entry.source,
      fetched_at: new Date(entry.fetched_at).toISOString(),
    };
  }

  /** Set a cached value with source provenance and optional TTL. */
  set<T>(key: string, value: T, source: string, ttlMs = DEFAULT_TTL_MS): void {
    // Evict oldest entries if at capacity
    if (this.store.size >= MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value,
      source,
      fetched_at: Date.now(),
      expires_at: Date.now() + ttlMs,
    });
  }

  /** Check if a valid (non-expired) entry exists. */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /** Remove a specific entry. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate all entries from a specific source. */
  invalidateBySource(source: string): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.source === source) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Clear all cached entries. */
  clear(): void {
    this.store.clear();
  }

  /** Get cache statistics. */
  stats(): { size: number; max: number } {
    return { size: this.store.size, max: MAX_ENTRIES };
  }
}

/** Singleton cache manager. */
export const cacheManager = new CacheManagerImpl();

// ─── Cache key helpers ──────────────────────────────────────────────────────

export function businessSearchKey(query: string, location: string): string {
  return `biz:${query.toLowerCase().trim()}:${location.toLowerCase().trim()}`;
}

export function techStackKey(domain: string): string {
  return `tech:${domain.toLowerCase().trim()}`;
}

export function websiteKey(url: string): string {
  return `web:${url.toLowerCase().trim()}`;
}

export function emailVerifyKey(email: string): string {
  return `email:${email.toLowerCase().trim()}`;
}

export function demandSignalKey(query: string, platform: string): string {
  return `demand:${platform}:${query.toLowerCase().trim()}`;
}
