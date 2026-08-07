/**
 * Hosted Google SERP adapters for Discover.
 *
 * Primary: Serper (generous free tier — prefer this)
 * Failover: ScrapingDog
 * Reserve: SerpAPI (250/mo free — burn ONLY when Serper+Dog fail hard)
 *
 * Credit discipline for SerpAPI:
 * - Never call SerpAPI when Serper/Dog returned a response (even empty)
 * - Hard cap SERPAPI_MAX_CALLS_PER_RUN (default 4) across one Discover
 * - Prefer num≤10 on SerpAPI (same 1 credit, less payload)
 *
 * All paths return SerpAPI-shaped organic_results so ingest stays shared.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { paidDiscoveryEnabled } from "./paid-discovery";

export type SerpOrganic = {
  link?: string;
  title?: string;
  snippet?: string;
  date?: string;
  published_date?: string;
};

export type SerpResponse = {
  organic_results: SerpOrganic[];
  provider?: string;
};

type SerpBudget = { serpapiCalls: number };

const serpBudgetAls = new AsyncLocalStorage<SerpBudget>();

/** Wrap one Discover so SerpAPI call caps are scoped to that run. */
export function withSerpApiBudget<T>(fn: () => Promise<T>): Promise<T> {
  return serpBudgetAls.run({ serpapiCalls: 0 }, fn);
}

function serpApiBudget(): SerpBudget {
  return serpBudgetAls.getStore() ?? { serpapiCalls: 0 };
}

function serpApiMaxCalls(): number {
  const n = Number(process.env.SERPAPI_MAX_CALLS_PER_RUN ?? "4");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4;
}

function normalizeOrganic(rows: unknown[]): SerpOrganic[] {
  const out: SerpOrganic[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const link = String(r.link || r.url || r.displayed_link || "").trim();
    if (!link) continue;
    out.push({
      link,
      title: String(r.title || "").trim(),
      snippet: String(r.snippet || r.description || r.content || "").trim(),
      date: r.date ? String(r.date) : undefined,
      published_date: r.published_date
        ? String(r.published_date)
        : r.date
          ? String(r.date)
          : undefined,
    });
  }
  return out;
}

async function fetchSerper(q: string, tbs: string, num: number): Promise<SerpResponse | null> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q, num, tbs }),
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { organic?: unknown[] };
    const organic_results = normalizeOrganic(data.organic ?? []);
    return { organic_results, provider: "serper" };
  } catch {
    return null;
  }
}

async function fetchScrapingDog(q: string, tbs: string, num: number): Promise<SerpResponse | null> {
  const key = process.env.SCRAPINGDOG_API_KEY?.trim();
  if (!key) return null;
  try {
    const params = new URLSearchParams({
      api_key: key,
      query: q,
      results: String(Math.min(num, 20)),
    });
    if (tbs) params.set("tbs", tbs);
    const res = await fetch(`https://api.scrapingdog.com/google?${params}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      organic_results?: unknown[];
      organic_data?: unknown[];
      results?: unknown[];
    };
    const raw = data.organic_results ?? data.organic_data ?? data.results ?? [];
    const organic_results = normalizeOrganic(Array.isArray(raw) ? raw : []);
    return { organic_results, provider: "scrapingdog" };
  } catch {
    return null;
  }
}

async function fetchSerpApi(q: string, tbs: string, num: number): Promise<SerpResponse | null> {
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key) return null;
  const budget = serpApiBudget();
  const max = serpApiMaxCalls();
  if (budget.serpapiCalls >= max) {
    if (process.env.NODE_ENV === "development") {
      console.info(`[serpapi] skip — budget ${budget.serpapiCalls}/${max}`);
    }
    return null;
  }
  budget.serpapiCalls += 1;
  try {
    // SerpAPI bills 1 search credit per request; keep num modest for speed.
    const capped = Math.min(num, 10);
    const url =
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}` +
      `&api_key=${encodeURIComponent(key)}&num=${capped}&tbs=${encodeURIComponent(tbs)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { organic_results?: unknown[]; error?: string };
    if (data.error) {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[serpapi] error: ${data.error}`);
      }
      return null;
    }
    const organic_results = normalizeOrganic(data.organic_results ?? []);
    return { organic_results, provider: "serpapi" };
  } catch {
    return null;
  }
}

/** True when any hosted Google SERP provider key is configured. */
export function hasGoogleSerpProvider(): boolean {
  if (!paidDiscoveryEnabled()) return false;
  return !!(
    process.env.SERPER_API_KEY?.trim() ||
    process.env.SCRAPINGDOG_API_KEY?.trim() ||
    process.env.SERPAPI_KEY?.trim()
  );
}

/**
 * One Google SERP query.
 * Serper → ScrapingDog → SerpAPI (last resort, budget-capped).
 * Empty Serper/Dog results do NOT burn SerpAPI (saves the 250/mo quota).
 */
export async function searchGoogleSerp(
  q: string,
  opts?: { tbs?: string; num?: number },
): Promise<SerpResponse | null> {
  if (!paidDiscoveryEnabled()) return null;
  const tbs = opts?.tbs ?? "qdr:d";
  const num = opts?.num ?? 20;

  const serper = await fetchSerper(q, tbs, num);
  if (serper && serper.organic_results.length > 0) return serper;

  const dog = await fetchScrapingDog(q, tbs, num);
  if (dog && dog.organic_results.length > 0) return dog;

  // Serper/Dog answered but empty — do not spend SerpAPI on the same barren query.
  if (serper) return serper;
  if (dog) return dog;

  // Both providers hard-failed (null) — spend a scarce SerpAPI credit.
  return fetchSerpApi(q, tbs, num);
}
