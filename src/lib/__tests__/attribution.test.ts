import { describe, expect, it } from "vitest";
import { withScrapivoAttribution } from "../attribution";

describe("withScrapivoAttribution", () => {
  it("appends utm_source with ? when no params exist", () => {
    expect(withScrapivoAttribution("https://example.com/post/123")).toBe(
      "https://example.com/post/123?utm_source=scrapivo.com",
    );
  });
  it("appends with & when params exist, preserving them", () => {
    expect(withScrapivoAttribution("https://example.com/post?id=123")).toBe(
      "https://example.com/post?id=123&utm_source=scrapivo.com",
    );
  });
  it("preserves fragments", () => {
    const out = withScrapivoAttribution("https://example.com/p#section");
    expect(out).toContain("utm_source=scrapivo.com");
    expect(out.endsWith("#section")).toBe(true);
  });
  it("supports medium/campaign/content", () => {
    const out = withScrapivoAttribution("https://linkedin.com/posts/abc", {
      medium: "lead",
      campaign: "signal-discovery",
      content: "linkedin-post",
    });
    expect(out).toContain("utm_medium=lead");
    expect(out).toContain("utm_campaign=signal-discovery");
    expect(out).toContain("utm_content=linkedin-post");
  });
  it("never corrupts unparseable input", () => {
    expect(withScrapivoAttribution("not a url")).toBe("not a url");
  });
  it("overwrites a foreign utm_source instead of duplicating", () => {
    const out = withScrapivoAttribution("https://x.com/?utm_source=evil.com");
    expect(out).toContain("utm_source=scrapivo.com");
    expect(out).not.toContain("evil.com");
  });
});
