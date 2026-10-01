/**
 * Source health for one search run (Task 14). Pure: it reads the provider
 * diagnostics the run already produced and says which sources answered,
 * which came back empty, and which were down, blocked or degraded.
 *
 * The user-facing summary names sources only through `publicSourceLabel`, and
 * only when no healthy source covered the same kind of source: a down search
 * index is not news when the browser searched the web instead.
 */
import { publicSourceLabel } from "./activity-presenter";

export type SourceHealthState = "healthy" | "empty" | "degraded" | "unavailable" | "blocked";
export type SourceHealthReason = "OK" | "NO_RESULTS" | "UNREACHABLE" | "BLOCKED" | "RATE_LIMITED" | "TIMEOUT" | "ERROR";
export type SourceHealth = { source: string; label: string; state: SourceHealthState; reason: SourceHealthReason };

type ProviderAttempt = { provider: string; attempted: boolean; succeeded: boolean; artifactsFound: number; error?: string | null; outcome?: string | null };
type RouteDiagnostic = { code?: string | null; source?: string | null; detail?: string | null };

const ERROR_RULES: Array<[RegExp, SourceHealthState, SourceHealthReason]> = [
  [/captcha|challenge|\bblocked\b|forbidden|\b403\b|bot check/i, "blocked", "BLOCKED"],
  [/rate.?limit|\b429\b|quota|too many requests/i, "degraded", "RATE_LIMITED"],
  [/timeout|timed out|deadline/i, "degraded", "TIMEOUT"],
  [/unreachable|econnrefused|enotfound|fetch failed|not configured|unconfigured|missing .*key|unavailable/i, "unavailable", "UNREACHABLE"],
];

function classifyError(text: string | null | undefined): { state: SourceHealthState; reason: SourceHealthReason } {
  for (const [pattern, state, reason] of ERROR_RULES) if (pattern.test(text ?? "")) return { state, reason };
  return { state: "degraded", reason: "ERROR" };
}

const SEVERITY: Record<SourceHealthState, number> = { healthy: 0, empty: 1, degraded: 2, blocked: 3, unavailable: 4 };

export function classifySourceHealth(input: { providers?: ProviderAttempt[] | null; diagnostics?: RouteDiagnostic[] | null }): {
  sources: SourceHealth[];
  /** Any source not healthy or empty. */
  degraded: boolean;
  /** Plain sentence for the user, or null when coverage was not affected. */
  summary: string | null;
} {
  const bySource = new Map<string, SourceHealth>();
  const note = (source: string, state: SourceHealthState, reason: SourceHealthReason) => {
    const key = source.trim().toLowerCase() || "unknown";
    const previous = bySource.get(key);
    // A source that answered at least once was up; otherwise keep the worst.
    if (previous && (previous.state === "healthy" || previous.state === "empty") && state !== "healthy") return;
    if (previous && state !== "healthy" && SEVERITY[previous.state] >= SEVERITY[state]) return;
    bySource.set(key, { source: key, label: publicSourceLabel(key), state, reason });
  };
  for (const attempt of input.providers ?? []) {
    if (!attempt.attempted) continue;
    if (attempt.succeeded) note(attempt.provider, attempt.artifactsFound > 0 ? "healthy" : "empty", attempt.artifactsFound > 0 ? "OK" : "NO_RESULTS");
    else { const { state, reason } = classifyError(attempt.error ?? attempt.outcome); note(attempt.provider, state, reason); }
  }
  for (const item of input.diagnostics ?? []) {
    if (!item.source || (item.code !== "SOURCE_UNAVAILABLE" && item.code !== "SOURCE_ERROR")) continue;
    const { state, reason } = classifyError(item.detail ?? item.code);
    note(item.source, item.code === "SOURCE_UNAVAILABLE" && state === "degraded" ? "unavailable" : state, reason);
  }
  const sources = [...bySource.values()];
  const covered = new Set(sources.filter((item) => item.state === "healthy" || item.state === "empty").map((item) => item.label));
  // The research browser searches the web itself: when it ran, a down search
  // index did not leave the web unsearched.
  if (covered.has("Public websites")) covered.add("The web");
  const missing = [...new Set(sources.filter((item) => SEVERITY[item.state] >= SEVERITY.degraded && !covered.has(item.label)).map((item) => item.label))];
  return {
    sources,
    degraded: sources.some((item) => SEVERITY[item.state] >= SEVERITY.degraded),
    summary: missing.length
      ? `Some sources could not be searched this time (${missing.join(", ")}), so results may be incomplete.`
      : null,
  };
}
