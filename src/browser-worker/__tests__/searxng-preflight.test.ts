import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { redactEndpoint, runSearxngStartupPreflight } from "../searxng-preflight.server";

const ENV_KEYS = ["SEARXNG_URL", "VERCEL"] as const;
const savedEnv = new Map<string, string | undefined>();

function loggedLines(): Array<Record<string, unknown>> {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls.map(
    (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
  );
}

beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SEARXNG_URL;
  delete process.env.VERCEL;
});

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("searxng startup preflight", () => {
  it("logs one healthy line with latency and endpoint", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.SEARXNG_URL = "http://127.0.0.1:8888";
    const fetchImpl = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    await runSearxngStartupPreflight(() => 1000, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("http://127.0.0.1:8888/healthz");
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "searxng_preflight",
      status: "healthy",
      latencyMs: 0,
      endpoint: "http://127.0.0.1:8888",
    });
  });

  it("logs unhealthy instead of throwing when the endpoint is down", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.SEARXNG_URL = "http://127.0.0.1:8888";
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      runSearxngStartupPreflight(() => 1000, fetchImpl as unknown as typeof fetch),
    ).resolves.toBeUndefined();

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "searxng_preflight",
      status: "unhealthy",
      detail: "fetch failed",
      endpoint: "http://127.0.0.1:8888",
    });
  });

  it("skips with a single line when SEARXNG_URL is not configured", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn();

    await runSearxngStartupPreflight(() => 0, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "searxng_preflight", status: "skipped" });
  });

  it("redacts credentials and key-ish query params from the logged endpoint", () => {
    expect(redactEndpoint("http://user:hunter2@127.0.0.1:8888")).toBe("http://***:***@127.0.0.1:8888/");
    expect(redactEndpoint("http://searx.example.com/?api_key=abc&x=1")).toBe(
      "http://searx.example.com/?api_key=***&x=1",
    );
  });
});
