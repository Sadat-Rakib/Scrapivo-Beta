/**
 * Browser-worker configuration (server-only).
 *
 * Canonical names: SCRAPIVO_BROWSER_WORKER_TOKEN / SCRAPIVO_BROWSER_WORKER_URL.
 * Legacy aliases BROWSER_WORKER_TOKEN / BROWSER_WORKER_URL are read second on
 * BOTH sides, so an app and a worker configured with either name agree.
 * The token is never sent to a browser and never logged.
 */
export function workerToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = (env.SCRAPIVO_BROWSER_WORKER_TOKEN || env.BROWSER_WORKER_TOKEN || "").trim();
  return token.length >= 32 ? token : null;
}

export function workerUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.SCRAPIVO_BROWSER_WORKER_URL || env.BROWSER_WORKER_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export type BrowserRuntimeName = "playwright" | "cli" | "worker";
export function requestedRuntime(env: NodeJS.ProcessEnv = process.env): BrowserRuntimeName {
  const value = (env.SCRAPIVO_BROWSER_ADAPTER ?? "playwright").trim().toLowerCase();
  return value === "cli" || value === "worker" ? value : "playwright";
}
