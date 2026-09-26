/** Phase B: thinking lines derive from live input, never fixed ladders. */
import { describe, expect, it } from "vitest";
import { thinkingLines } from "@/components/discover/thinking-steps";

describe("thinkingLines", () => {
  it("echoes the query and understood slots", () => {
    const lines = thinkingLines({
      query: "dentists in Pune",
      tokens: {
        category: "dentists",
        geo: "Pune",
        stage: null,
        sector: null,
      } as never,
      entityLabel: null,
    });
    expect(lines[0]).toBe("Thinking");
    expect(lines[1]).toContain("dentists in Pune");
    expect(lines.join("\n")).toContain("dentists · Pune");
    expect(lines.join("\n")).not.toContain("hot index");
    expect(lines.join("\n")).not.toMatch(/Researching:/i);
  });
  it("falls back to entity label, then generic", () => {
    const withEntity = thinkingLines({ query: "x", tokens: null, entityLabel: "businesses" });
    expect(withEntity.join("\n")).toContain("Understanding: businesses");
    const bare = thinkingLines({ query: "", tokens: null, entityLabel: null });
    expect(bare.join("\n")).toContain("Understanding your request");
  });
  it("never narrates job boards for non-job hunts", () => {
    const lines = thinkingLines({
      query: "plumbers in Austin",
      tokens: { category: "plumbers", geo: "Austin" } as never,
      entityLabel: "businesses",
    }).join("\n");
    expect(lines).not.toMatch(/job board/i);
    expect(lines).not.toMatch(/social platform/i);
  });
});
