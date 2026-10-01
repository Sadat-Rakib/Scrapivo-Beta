import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every guarded write site goes through the service-role admin client. The
// mock records table writes so the test proves no DB call happens locally.
const writes: string[] = [];
const builder = (table: string) => {
  const chain: Record<string, unknown> = {};
  const record = (op: string) => () => {
    writes.push(`${op}:${table}`);
    return Promise.resolve({ data: null, error: null });
  };
  chain.insert = record("insert");
  chain.upsert = record("upsert");
  chain.update = () => ({ eq: () => ({ in: record("update") }) });
  chain.select = () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) });
  return chain;
};
vi.mock("@/integrations/my-supabase/admin.server", () => ({ getAdmin: () => ({ from: builder }) }));

const { __resetPersistencePolicyForTests } = await import("@/lib/persistence-policy.server");
const { logSourceHealth } = await import("@/lib/search/observability.server");
const { putCached } = await import("@/lib/ai/cache.server");
const { recordSourceOutcome } = await import("@/lib/search/source-yield.server");

const row = { run_id: "r", source: "s", status: "ok", results: 1 } as unknown as Parameters<typeof logSourceHealth>[0][number];

describe("local no-persist write sites", () => {
  beforeEach(() => {
    writes.length = 0;
    __resetPersistencePolicyForTests();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("skips source_health, ai_cache and source_yield_stats writes when active locally", async () => {
    vi.stubEnv("SCRAPIVO_LOCAL_NO_PERSIST", "true");
    vi.stubEnv("NODE_ENV", "development");
    await logSourceHealth([row]);
    await putCached("k", "extract", "{}");
    expect(await recordSourceOutcome("general", "business", "osm", { attempts: 1 })).toBe(false);
    expect(writes).toEqual([]);
  });

  it("still writes in a production runtime even when the local flag is set", async () => {
    vi.stubEnv("SCRAPIVO_LOCAL_NO_PERSIST", "true");
    vi.stubEnv("NODE_ENV", "production");
    await logSourceHealth([row]);
    await putCached("k", "extract", "{}");
    expect(writes).toEqual(["insert:source_health", "upsert:ai_cache"]);
  });

  it("still writes on Vercel even when the local flag is set", async () => {
    vi.stubEnv("SCRAPIVO_LOCAL_NO_PERSIST", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    await logSourceHealth([row]);
    expect(writes).toEqual(["insert:source_health"]);
  });

  it("writes normally when the flag is off", async () => {
    vi.stubEnv("SCRAPIVO_LOCAL_NO_PERSIST", "");
    vi.stubEnv("NODE_ENV", "development");
    await logSourceHealth([row]);
    await putCached("k", "extract", "{}");
    expect(writes).toEqual(["insert:source_health", "upsert:ai_cache"]);
  });
});
