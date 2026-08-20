/**
 * Live health check for Discover / Local API keys.
 * Prints presence + status only — never secret values.
 *
 *   npx tsx scripts/probe-api-keys.mts
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

type Result = {
  name: string;
  present: boolean;
  wired: boolean;
  ok: boolean | null;
  detail: string;
};

const present = (k: string) => !!(process.env[k] || "").trim();

async function timed<T>(
  ms: number,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
    ]);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkSerper(): Promise<Result> {
  const name = "SERPER_API_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(20_000, async () => {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!.trim(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: "need a designer hiring", num: 5, tbs: "qdr:w" }),
    });
    const body = await res.text();
    let organic = 0;
    try {
      organic = (JSON.parse(body).organic ?? []).length;
    } catch {
      /* ignore */
    }
    return { status: res.status, organic };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  const { status, organic } = r.value;
  return {
    name,
    present: true,
    wired: true,
    ok: status === 200 && organic > 0,
    detail: `HTTP ${status}, organic=${organic}`,
  };
}

async function checkScrapingDog(): Promise<Result> {
  const name = "SCRAPINGDOG_API_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(25_000, async () => {
    const params = new URLSearchParams({
      api_key: process.env.SCRAPINGDOG_API_KEY!.trim(),
      query: "looking for a plumber",
      results: "5",
      tbs: "qdr:w",
    });
    const res = await fetch(`https://api.scrapingdog.com/google?${params}`);
    const data = (await res.json()) as {
      organic_results?: unknown[];
      organic_data?: unknown[];
      results?: unknown[];
    };
    const raw = data.organic_results ?? data.organic_data ?? data.results ?? [];
    return { status: res.status, organic: Array.isArray(raw) ? raw.length : 0 };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  return {
    name,
    present: true,
    wired: true,
    ok: r.value.status === 200 && r.value.organic > 0,
    detail: `HTTP ${r.value.status}, organic=${r.value.organic}`,
  };
}

async function checkSerpApi(): Promise<Result> {
  const name = "SERPAPI_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(25_000, async () => {
    const params = new URLSearchParams({
      api_key: process.env.SERPAPI_KEY!.trim(),
      engine: "google",
      q: "need a logo designer",
      num: "5",
      tbs: "qdr:w",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = (await res.json()) as {
      organic_results?: unknown[];
      error?: string;
      search_metadata?: { status?: string };
    };
    return {
      status: res.status,
      organic: data.organic_results?.length ?? 0,
      error: data.error,
      meta: data.search_metadata?.status,
    };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  const { status, organic, error, meta } = r.value;
  if (error) {
    return {
      name,
      present: true,
      wired: true,
      ok: false,
      detail: `HTTP ${status}, error=${error}`,
    };
  }
  return {
    name,
    present: true,
    wired: true,
    ok: status === 200 && organic > 0,
    detail: `HTTP ${status}, status=${meta || "ok"}, organic=${organic}`,
  };
}

async function checkTavily(): Promise<Result> {
  const name = "TAVILY_API_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(20_000, async () => {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY!.trim(),
        query: "companies hiring designers",
        max_results: 3,
      }),
    });
    const data = (await res.json()) as { results?: unknown[]; detail?: { error?: string } };
    return { status: res.status, n: data.results?.length ?? 0, err: data.detail };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  return {
    name,
    present: true,
    wired: true,
    ok: r.value.status === 200 && r.value.n > 0,
    detail: `HTTP ${r.value.status}, results=${r.value.n}`,
  };
}

async function checkGeoapify(): Promise<Result> {
  const name = "GEOAPIFY_API_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(15_000, async () => {
    const key = process.env.GEOAPIFY_API_KEY!.trim();
    const url =
      `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent("Toronto, Canada")}` +
      `&limit=1&format=json&apiKey=${key}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      results?: Array<{ city?: string; country_code?: string }>;
    };
    const hit = data.results?.[0];
    return { status: res.status, city: hit?.city, cc: hit?.country_code };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  const ok = r.value.status === 200 && r.value.cc === "ca";
  return {
    name,
    present: true,
    wired: true,
    ok,
    detail: `HTTP ${r.value.status}, city=${r.value.city}, cc=${r.value.cc}`,
  };
}

async function checkFoursquare(): Promise<Result> {
  const name = "FOURSQUARE_API_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(20_000, async () => {
    const key = process.env.FOURSQUARE_API_KEY!.trim();
    const params = new URLSearchParams({
      near: "Toronto, Canada",
      query: "plumber",
      limit: "5",
    });
    // Same order as foursquare-places.server.ts
    const attempts: Array<{ url: string; headers: Record<string, string> }> = [
      {
        url: `https://places-api.foursquare.com/places/search?${params}`,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${key}`,
          "X-Places-Api-Version": "2025-06-17",
        },
      },
      {
        url: `https://api.foursquare.com/v3/places/search?${params}`,
        headers: { Accept: "application/json", Authorization: key },
      },
    ];
    for (const a of attempts) {
      const res = await fetch(a.url, { headers: a.headers });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: unknown[] };
      const n = data.results?.length ?? 0;
      if (n > 0)
        return { status: res.status, n, via: a.url.includes("places-api") ? "places-api" : "v3" };
    }
    return { status: 401, n: 0, via: "none" };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  return {
    name,
    present: true,
    wired: true,
    ok: r.value.n > 0,
    detail: `HTTP ${r.value.status}, places=${r.value.n}, via=${r.value.via}`,
  };
}

async function checkMillionVerifier(): Promise<Result> {
  const name = "MILLIONVERIFIER_API_KEY";
  if (!present(name)) return { name, present: false, wired: true, ok: null, detail: "missing" };
  const r = await timed(15_000, async () => {
    const key = process.env.MILLIONVERIFIER_API_KEY!.trim();
    const url =
      `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}` +
      `&email=${encodeURIComponent("contact@gmail.com")}&timeout=10`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      result?: string;
      error?: string;
      credits?: number;
    };
    return {
      status: res.status,
      result: data.result,
      error: data.error,
      credits: data.credits,
    };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  const authFail = /invalid|unauthorized|api.?key/i.test(
    `${r.value.error || ""} ${r.value.result || ""}`,
  );
  const noCredits = /insufficient credits/i.test(r.value.error || "") || r.value.credits === 0;
  return {
    name,
    present: true,
    wired: true,
    ok: r.value.status === 200 && !authFail && !noCredits,
    detail: noCredits
      ? `HTTP ${r.value.status}, Insufficient credits (credits=${r.value.credits})`
      : `HTTP ${r.value.status}, result=${r.value.result}, credits=${r.value.credits}`,
  };
}

async function checkScrapingBee(): Promise<Result> {
  const name = "SCRAPINGBEE_API_KEY";
  if (!present(name))
    return { name, present: false, wired: true, ok: null, detail: "missing (Local HTML failover)" };
  const r = await timed(25_000, async () => {
    const key = process.env.SCRAPINGBEE_API_KEY!.trim();
    const api =
      `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(key)}` +
      `&url=${encodeURIComponent("https://example.com")}&render_js=false`;
    const res = await fetch(api);
    const text = await res.text();
    return { status: res.status, len: text.length };
  });
  if (!r.ok) return { name, present: true, wired: true, ok: false, detail: r.error };
  return {
    name,
    present: true,
    wired: true,
    ok: r.value.status === 200 && r.value.len > 100,
    detail: `HTTP ${r.value.status}, bytes=${r.value.len}`,
  };
}

async function checkDeadKeys(): Promise<Result[]> {
  return [
    {
      name: "SCRAPE_DO_TOKEN",
      present: present("SCRAPE_DO_TOKEN"),
      wired: false,
      ok: null,
      detail: present("SCRAPE_DO_TOKEN")
        ? "present in env but NOT wired in code"
        : "missing (unused)",
    },
    {
      name: "ENRICHMENTAPI_KEY",
      present: present("ENRICHMENTAPI_KEY"),
      wired: true,
      ok: null,
      detail: present("ENRICHMENTAPI_KEY")
        ? "present — used for PIE contact enrich only (not Discover SERP)"
        : "missing",
    },
    {
      name: "USE_PAID_SOURCES",
      present: present("USE_PAID_SOURCES"),
      wired: true,
      ok: process.env.USE_PAID_SOURCES === "true",
      detail: `value=${process.env.USE_PAID_SOURCES || "(unset)"} — must be true for Serper/SerpAPI social`,
    },
  ];
}

async function checkSerpChain(): Promise<void> {
  console.log("\n── SERP chain (same path Discover uses) ──");
  process.env.USE_PAID_SOURCES = process.env.USE_PAID_SOURCES || "true";
  const { searchGoogleSerp, hasGoogleSerpProvider } =
    await import("../src/lib/search/serp-providers.server.ts");
  console.log("hasGoogleSerpProvider()", hasGoogleSerpProvider());
  const res = await searchGoogleSerp('site:linkedin.com/posts "looking for a designer"', {
    tbs: "qdr:w",
    num: 8,
  });
  console.log(
    JSON.stringify({
      provider: res?.provider ?? null,
      organic: res?.organic_results?.length ?? 0,
      sample: res?.organic_results?.[0]?.title?.slice(0, 80) ?? null,
    }),
  );
}

const results: Result[] = [];
results.push(await checkSerper());
results.push(await checkScrapingDog());
results.push(await checkSerpApi());
results.push(await checkTavily());
results.push(await checkGeoapify());
results.push(await checkFoursquare());
results.push(await checkMillionVerifier());
results.push(await checkScrapingBee());
results.push(...(await checkDeadKeys()));

console.log("\n── API key health (secrets never printed) ──\n");
console.log(
  "NAME".padEnd(28) + "PRESENT".padEnd(10) + "WIRED".padEnd(8) + "OK".padEnd(8) + "DETAIL",
);
for (const r of results) {
  const ok = r.ok === true ? "PASS" : r.ok === false ? "FAIL" : r.wired === false ? "N/A" : "SKIP";
  console.log(
    r.name.padEnd(28) +
      String(r.present).padEnd(10) +
      String(r.wired).padEnd(8) +
      ok.padEnd(8) +
      r.detail,
  );
}

const critical = ["SERPER_API_KEY", "SERPAPI_KEY", "USE_PAID_SOURCES"];
const failed = results.filter((r) => critical.includes(r.name) && r.ok === false);
const missingPaid = results.find((r) => r.name === "USE_PAID_SOURCES" && r.ok === false);
const warnings = results.filter(
  (r) =>
    ["SCRAPINGDOG_API_KEY", "MILLIONVERIFIER_API_KEY", "FOURSQUARE_API_KEY"].includes(r.name) &&
    r.ok === false,
);

await checkSerpChain();

console.log("\n── Verdict ──");
if (missingPaid) {
  console.log("USE_PAID_SOURCES is not true — Discover social SERP stays off in production path.");
}
if (failed.length) {
  console.log("FAILING critical keys:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
if (warnings.length) {
  console.log("WARNINGS (non-fatal):", warnings.map((w) => `${w.name} — ${w.detail}`).join(" | "));
}
const serper = results.find((r) => r.name === "SERPER_API_KEY");
const serpapi = results.find((r) => r.name === "SERPAPI_KEY");
if (serper?.ok) {
  console.log("Serper is healthy (primary SERP). SerpAPI is reserve-only when Serper+Dog fail.");
}
if (serpapi?.ok) {
  console.log("SerpAPI key responds and returns organic results.");
} else if (serpapi?.present && serpapi.ok === false) {
  console.log("SerpAPI key is present but NOT working — fix/rotate it.");
}
console.log("Done.");
