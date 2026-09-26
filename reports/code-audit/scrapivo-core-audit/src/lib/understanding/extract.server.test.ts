import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyFrame } from "./frame";

describe("LLM extraction transport reliability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLOUDFLARE_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  it("leaves transient retries to the router and preserves output headroom", async () => {
    process.env.CLOUDFLARE_API_KEY = "test-token";
    process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { extractFrameLLM } = await import("./extract.server");

    const result = await extractFrameLLM("dentists in Graz", {
      bypassCache: true,
      pin: { gateway: "cloudflare", model: "@cf/zai-org/glm-4.7-flash" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.max_tokens).toBe(4000);
    expect(result.frame.meta.fallback_used).toBe(true);
    expect(result.error).toBe("fetch failed");
  });

  it("records one successful truncated-JSON repair", async () => {
    process.env.CLOUDFLARE_API_KEY = "test-token";
    process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
    const valid = JSON.stringify(emptyFrame(""));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"task_type":' } }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: valid } }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { extractFrameLLM } = await import("./extract.server");

    const result = await extractFrameLLM("dentists in Graz", { bypassCache: true, pin: { gateway: "cloudflare", model: "@cf/zai-org/glm-4.7-flash" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.frame.meta.fallback_used).toBe(false);
    expect(result.frame.meta.repair).toEqual({
      initial_parse_status: "invalid_json",
      initial_failure_class: "truncated_json",
      repair_attempted: true,
      repair_reason: "truncated_json",
      repair_success: true,
    });
  });

  it("falls back after one failed repair without a repair loop", async () => {
    process.env.CLOUDFLARE_API_KEY = "test-token";
    process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { extractFrameLLM } = await import("./extract.server");

    const result = await extractFrameLLM("dentists in Graz", { bypassCache: true, pin: { gateway: "cloudflare", model: "@cf/zai-org/glm-4.7-flash" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.frame.meta.fallback_used).toBe(true);
    expect(result.frame.meta.repair).toEqual({
      initial_parse_status: "invalid_json",
      initial_failure_class: "non_json_response",
      repair_attempted: true,
      repair_reason: "non_json_response",
      repair_success: false,
    });
  });
});
