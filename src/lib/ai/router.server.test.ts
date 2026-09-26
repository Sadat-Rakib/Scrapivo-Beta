import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cache.server", () => ({
  cacheKey: () => "test",
  getCached: async () => null,
  putCached: async () => undefined,
}));

const pin = { gateway: "cloudflare", model: "@cf/zai-org/glm-4.7-flash" };
const omniroutePin = { gateway: "omniroute", model: "gemini/gemini-3.1-flash-lite" };
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("AI router structured output and transient reliability", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CLOUDFLARE_API_KEY = "test-token";
    process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.CLOUDFLARE_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  it("sends JSON mode through the Cloudflare OpenAI-compatible request", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { aiCompleteDetailed } = await import("./router.server");

    const result = await aiCompleteDetailed({
      task: "extract", system: "system", user: "user", json: true, noCache: true, pin,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe(pin.model);
    expect(result.content).toBe('{"ok":true}');
    expect(result.usage).toEqual({ prompt: 12, completion: 4 });
  });

  it("counts an exhausted retry group as one breaker failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<FetchMock>().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { aiCompleteDetailed } = await import("./router.server");
    const call = () => aiCompleteDetailed({ task: "extract", system: "system", user: "user", noCache: true, pin });

    for (let logicalCall = 0; logicalCall < 3; logicalCall++) {
      const rejected = expect(call()).rejects.toThrow("fetch failed");
      await vi.runAllTimersAsync();
      await rejected;
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("OmniRoute OpenAI-compatible pinning", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OMNIROUTE_API_KEY = "omniroute-test-token";
    process.env.OMNIROUTE_BASE_URL = "http://127.0.0.1:20128/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OMNIROUTE_API_KEY;
    delete process.env.OMNIROUTE_BASE_URL;
  });

  it("preserves endpoint, Bearer auth, exact model, JSON mode, and OpenAI response extraction", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { aiCompleteDetailed } = await import("./router.server");

    const result = await aiCompleteDetailed({
      task: "understand", system: "system", user: "user", json: true, noCache: true, pin: omniroutePin,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:20128/v1/chat/completions");
    expect(init?.headers).toMatchObject({ authorization: "Bearer omniroute-test-token" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gemini/gemini-3.1-flash-lite",
      response_format: { type: "json_object" },
    });
    expect(result).toMatchObject({
      content: '{"ok":true}', provider: "omniroute:gemini/gemini-3.1-flash-lite", model: omniroutePin.model,
    });
  });

  it.each([[429, "rate_limited"], [401, "auth"], [403, "auth"], [404, "model_missing"]])(
    "classifies %i without provider or model substitution",
    async (status, kind) => {
      const fetchMock = vi.fn<FetchMock>(async () => new Response("gateway error", { status }));
      vi.stubGlobal("fetch", fetchMock);
      const { aiCompleteDetailed } = await import("./router.server");

      await expect(
        aiCompleteDetailed({ task: "understand", system: "system", user: "user", noCache: true, pin: omniroutePin }),
      ).rejects.toThrow(`omniroute:gemini/gemini-3.1-flash-lite ${status} (${kind})`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).model).toBe(omniroutePin.model);
    },
  );
});
describe("Gemini direct OpenAI-compatible pinning", () => {
  const geminiPin = { gateway: "gemini", model: "gemini-3.1-flash-lite" };

  beforeEach(() => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "gemini-test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
  });

  it("preserves Google's OpenAI-compatible endpoint, Bearer auth, model, JSON mode, and response extraction", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { aiCompleteDetailed } = await import("./router.server");

    const result = await aiCompleteDetailed({
      task: "understand", system: "system", user: "user", json: true, noCache: true, pin: geminiPin,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(init?.headers).toMatchObject({ authorization: "Bearer gemini-test-token" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gemini-3.1-flash-lite",
      response_format: { type: "json_object" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      content: '{"ok":true}', provider: "gemini:gemini-3.1-flash-lite", model: geminiPin.model,
    });
  });
});