/**
 * Scrapivo — Telemetry & Observability Service
 *
 * Tracks provider execution metrics: request count, success/failure rates,
 * latency, cache hit rates, and enrichment completion status.
 *
 * §41: For each pipeline run, store enough metadata to debug failures.
 */

export interface ProviderMetrics {
  provider: string;
  request_count: number;
  success_count: number;
  failure_count: number;
  total_latency_ms: number;
  avg_latency_ms: number;
  cache_hits: number;
  cache_misses: number;
  total_results: number;
  last_error?: string;
  last_execution_at?: string;
}

export interface TelemetrySummary {
  providers: Record<string, ProviderMetrics>;
  total_requests: number;
  total_successes: number;
  total_failures: number;
  overall_cache_hit_rate: number;
  uptime_seconds: number;
}

class TelemetryServiceImpl {
  private metrics = new Map<string, ProviderMetrics>();
  private startedAt = Date.now();

  private ensureProvider(provider: string): ProviderMetrics {
    if (!this.metrics.has(provider)) {
      this.metrics.set(provider, {
        provider,
        request_count: 0,
        success_count: 0,
        failure_count: 0,
        total_latency_ms: 0,
        avg_latency_ms: 0,
        cache_hits: 0,
        cache_misses: 0,
        total_results: 0,
      });
    }
    return this.metrics.get(provider)!;
  }

  /** Log a provider execution (success or failure). */
  logProviderExecution(
    provider: string,
    durationMs: number,
    success: boolean,
    resultsCount: number,
    error?: string,
  ): void {
    const m = this.ensureProvider(provider);
    m.request_count++;
    m.total_latency_ms += durationMs;
    m.avg_latency_ms = Math.round(m.total_latency_ms / m.request_count);
    m.last_execution_at = new Date().toISOString();

    if (success) {
      m.success_count++;
      m.total_results += resultsCount;
    } else {
      m.failure_count++;
      m.last_error = error || "Unknown error";
    }
  }

  /** Log a cache hit. */
  logCacheHit(provider: string): void {
    this.ensureProvider(provider).cache_hits++;
  }

  /** Log a cache miss. */
  logCacheMiss(provider: string): void {
    this.ensureProvider(provider).cache_misses++;
  }

  /** Get metrics for a specific provider. */
  getProviderMetrics(provider: string): ProviderMetrics | null {
    return this.metrics.get(provider) ?? null;
  }

  /** Get full telemetry summary across all providers. */
  getSummary(): TelemetrySummary {
    const providers: Record<string, ProviderMetrics> = {};
    let totalRequests = 0;
    let totalSuccesses = 0;
    let totalFailures = 0;
    let totalCacheHits = 0;
    let totalCacheMisses = 0;

    for (const [key, m] of this.metrics) {
      providers[key] = { ...m };
      totalRequests += m.request_count;
      totalSuccesses += m.success_count;
      totalFailures += m.failure_count;
      totalCacheHits += m.cache_hits;
      totalCacheMisses += m.cache_misses;
    }

    const totalCacheAttempts = totalCacheHits + totalCacheMisses;

    return {
      providers,
      total_requests: totalRequests,
      total_successes: totalSuccesses,
      total_failures: totalFailures,
      overall_cache_hit_rate:
        totalCacheAttempts > 0 ? totalCacheHits / totalCacheAttempts : 0,
      uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Reset all metrics (primarily for testing). */
  reset(): void {
    this.metrics.clear();
    this.startedAt = Date.now();
  }
}

/** Singleton telemetry service. */
export const telemetry = new TelemetryServiceImpl();
