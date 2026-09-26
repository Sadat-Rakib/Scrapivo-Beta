import { spawn } from "node:child_process";
import { awaitSearchWork, throwIfAborted } from "./search-run";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHROME_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export type ResilientFetchOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Optional curl-impersonate subprocess when CURL_IMPERSONATE_BIN is set. */
async function curlImpersonateFetch(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal | null,
): Promise<Response | null> {
  const bin = process.env.CURL_IMPERSONATE_BIN;
  if (!bin) return null;

  return new Promise((resolve) => {
    const args = ["-s", "-L", "--compressed", "-w", "\n%{http_code}", url];
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: signal ?? undefined, windowsHide: true });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const nl = raw.lastIndexOf("\n");
      const status = nl >= 0 ? parseInt(raw.slice(nl + 1), 10) : 200;
      const body = nl >= 0 ? raw.slice(0, nl) : raw;
      resolve(
        new Response(body, {
          status: Number.isFinite(status) ? status : 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    });
    proc.on("error", () => resolve(null));
  });
}

/**
 * HTTP fetch with Chrome-like headers, exponential backoff, and optional
 * curl-impersonate (set CURL_IMPERSONATE_BIN to curl_chrome120 path).
 */
export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const { retries = 2, retryDelayMs = 400, headers: extraHeaders, ...init } = options;
  const headers = { ...CHROME_HEADERS, ...(extraHeaders as Record<string, string>) };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(init.signal);
    if (attempt > 0) await awaitSearchWork(sleep(retryDelayMs * 2 ** (attempt - 1)), init.signal);

    try {
      const viaCurl = await curlImpersonateFetch(url, headers, init.signal);
      throwIfAborted(init.signal);
      if (viaCurl && viaCurl.ok) return viaCurl;

      const res = await fetch(url, { ...init, headers });
      if (res.ok || res.status === 404) return res;
      if (res.status === 403 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      throwIfAborted(init.signal);
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function resilientText(url: string, options?: ResilientFetchOptions): Promise<string> {
  const res = await resilientFetch(url, options);
  if (!res.ok) return "";
  return res.text();
}

export async function resilientJson<T>(
  url: string,
  options?: ResilientFetchOptions,
): Promise<T | null> {
  const res = await resilientFetch(url, {
    ...options,
    headers: { Accept: "application/json", ...options?.headers },
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
