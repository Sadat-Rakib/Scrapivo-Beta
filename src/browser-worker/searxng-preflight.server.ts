/**
 * SearXNG startup preflight (PRD §16).
 *
 * One-shot, log-only reachability probe for the configured SEARXNG_URL.
 * Fired once at browser-worker startup (research-worker/server.ts) and once
 * per app-server instance (src/server.ts). It must never block startup and
 * never throw — every failure path ends in a single JSON log line.
 */

const PREFLIGHT_TIMEOUT_MS = 3_000;

/** Strip credentials (`user:pass@`) and key-ish query params before logging. */
export function redactEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    const hasCredentials = Boolean(url.username || url.password);
    const keyParams = [...url.searchParams.keys()].filter((name) =>
      /key|token|secret|password|auth/i.test(name),
    );
    if (!hasCredentials && keyParams.length === 0) return raw;
    if (hasCredentials) {
      url.username = "***";
      url.password = "***";
    }
    for (const name of keyParams) url.searchParams.set(name, "***");
    return url.toString();
  } catch {
    return "<unparseable-endpoint>";
  }
}

function redactDetail(detail: string, rawEndpoint: string, redactedEndpoint: string): string {
  return detail
    .split(rawEndpoint)
    .join(redactedEndpoint)
    .replace(/:\/\/[^@/\s]*@/g, "://***@");
}

export async function runSearxngStartupPreflight(
  now: () => number = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const raw = process.env.SEARXNG_URL;
    if (!raw) {
      console.log(
        JSON.stringify({ event: "searxng_preflight", status: "skipped", reason: "SEARXNG_URL not set" }),
      );
      return;
    }
    // Mirror searxng.server.ts: Docker on Windows binds IPv4 only, so pin
    // localhost to 127.0.0.1 exactly like the search path does.
    const endpoint = raw.replace(/:\/\/localhost(?=[:/]|$)/i, "://127.0.0.1");
    const redacted = redactEndpoint(endpoint);
    // A laptop Docker SearXNG is unreachable from Vercel/serverless — the
    // search path skips it there, so the preflight must not waste a request.
    if (process.env.VERCEL === "1" && /:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(?=[:/]|$)/i.test(endpoint)) {
      console.log(
        JSON.stringify({
          event: "searxng_preflight",
          status: "skipped",
          reason: "localhost endpoint on Vercel",
          endpoint: redacted,
        }),
      );
      return;
    }

    const started = now();
    try {
      const res = await fetchImpl(`${endpoint.replace(/\/$/, "")}/healthz`, {
        signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
      });
      const latencyMs = now() - started;
      if (res.ok) {
        console.log(
          JSON.stringify({ event: "searxng_preflight", status: "healthy", latencyMs, endpoint: redacted }),
        );
      } else {
        console.log(
          JSON.stringify({
            event: "searxng_preflight",
            status: "unhealthy",
            latencyMs,
            endpoint: redacted,
            detail: `HTTP ${res.status}`,
          }),
        );
      }
    } catch (error) {
      const latencyMs = now() - started;
      const detail = error instanceof Error ? error.message : String(error);
      console.log(
        JSON.stringify({
          event: "searxng_preflight",
          status: "unhealthy",
          latencyMs,
          endpoint: redacted,
          detail: redactDetail(detail, endpoint, redacted),
        }),
      );
    }
  } catch {
    // The preflight itself must never take the process down.
    console.log(JSON.stringify({ event: "searxng_preflight", status: "skipped", reason: "preflight error" }));
  }
}
