/** Phase 1.6: website href safety battery. */
import { describe, expect, it } from "vitest";
import { ensureHttpUrl } from "@/lib/search/site-url";

describe("ensureHttpUrl", () => {
  it("passes valid URLs through", () => {
    expect(ensureHttpUrl("https://example.com")).toBe("https://example.com");
    expect(ensureHttpUrl("http://example.com/x?q=1")).toBe("http://example.com/x?q=1");
  });
  it("qualifies schemeless domains (the measured ~1% case)", () => {
    expect(ensureHttpUrl("www.ghpsindiagate.in")).toBe("https://www.ghpsindiagate.in");
    expect(ensureHttpUrl("example.com/path")).toBe("https://example.com/path");
  });
  it("drops non-linkable garbage instead of rendering dead links", () => {
    expect(ensureHttpUrl("")).toBeNull();
    expect(ensureHttpUrl(null)).toBeNull();
    expect(ensureHttpUrl("<<not-applicable>>")).toBeNull();
    expect(ensureHttpUrl("not a url")).toBeNull();
  });
});
