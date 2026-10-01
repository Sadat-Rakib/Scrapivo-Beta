import { describe, expect, it } from "vitest";
import { classifyFailure, shouldFailOver } from "../providers";

describe("provider failure classification", () => {
  it("a model that failed to generate JSON fails over to the next provider", () => {
    const body = '{"error":{"message":"Failed to generate JSON. Please adjust your prompt. See \'failed_generation\' for more details.","type":"invalid_request_error","code":"json_validate_failed"}}';
    const kind = classifyFailure(400, body);
    expect(kind).toBe("empty");
    expect(shouldFailOver(kind)).toBe(true);
  });

  it("a genuinely malformed payload still stops the ladder", () => {
    const kind = classifyFailure(400, '{"error":{"message":"messages: field required"}}');
    expect(kind).toBe("bad_request");
    expect(shouldFailOver(kind)).toBe(false);
  });
});
