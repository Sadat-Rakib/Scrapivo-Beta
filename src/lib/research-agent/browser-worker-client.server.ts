/**
 * Server-to-server client for the private browser worker. Server-only: the
 * worker token is read here and never reaches a browser bundle or a log.
 */
import { workerToken, workerUrl } from "./browser-worker-config.server";

export class BrowserWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BrowserWorkerError";
  }
}

export function browserWorkerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!workerUrl(env) && !!workerToken(env);
}

export async function callBrowserWorker<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  options: { signal?: AbortSignal | null; timeoutMs?: number; binary?: boolean } = {},
): Promise<T> {
  const base = workerUrl();
  const token = workerToken();
  if (!base || !token) throw new BrowserWorkerError("WORKER_UNCONFIGURED", "The browser worker is not configured.", 503);
  if (options.signal?.aborted) throw new BrowserWorkerError("CANCELLED", "The browser operation was cancelled.", 499);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 45_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    if (options.signal?.aborted) throw new BrowserWorkerError("CANCELLED", "The browser operation was cancelled.", 499);
    if (timeout.aborted) throw new BrowserWorkerError("WORKER_TIMEOUT", "The browser worker did not respond in time.", 504);
    throw new BrowserWorkerError("WORKER_UNAVAILABLE", "The browser worker is unavailable.", 503);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new BrowserWorkerError(payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.message ?? "The browser worker rejected the request.", response.status);
  }
  if (options.binary) return Buffer.from(await response.arrayBuffer()) as T;
  return (await response.json()) as T;
}
