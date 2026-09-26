import { describe, expect, it } from "vitest";
import { MAX_TURNS, sanitizeTurns } from "../transcript.functions";

const full = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    text: `q${i}`,
    results: { leads: [{ a: 1 }], companies: [], people: [], local: [] },
    ts: i,
  }));

describe("Step 3 transcript sanitize", () => {
  it("keeps full turn data (results never collapsed to counts)", () => {
    const out = sanitizeTurns(full(3));
    expect(out).toHaveLength(3);
    expect(out[0].results?.leads).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("counts");
  });

  it("caps at MAX_TURNS, keeping the newest", () => {
    const out = sanitizeTurns(full(MAX_TURNS + 10));
    expect(out).toHaveLength(MAX_TURNS);
    expect(out[0].id).toBe(`t10`);
    expect(out[MAX_TURNS - 1].id).toBe(`t${MAX_TURNS + 9}`);
  });

  it("overlong ids/texts pass sanitize intact (server truncates, never throws)", () => {
    const out = sanitizeTurns([{ id: "x".repeat(500), text: "y".repeat(5000) }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toHaveLength(500);
  });

  it("drops malformed turns, never throws", () => {
    expect(sanitizeTurns(null)).toEqual([]);
    expect(sanitizeTurns("nope")).toEqual([]);
    const out = sanitizeTurns([
      { id: "a", text: "ok", results: { leads: [], companies: [], people: [], local: [] } },
      { id: 5, text: "bad id" },
      { text: "no id" },
      null,
      { id: "b", text: "counts-only", counts: { posts: 2, companies: 1, people: 0, local: 3 } },
    ]);
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
    expect(out[1].counts).toMatchObject({ posts: 2, local: 3 });
  });
});
