/**
 * WS7B — Custom Signal Compiler V1, offline unit battery.
 *
 * Contract: schema guards the shape; the deterministic fallback is stable
 * and never empty for input >=3 chars; ANY LLM failure (throw, timeout,
 * unparseable, schema-invalid) lands on the fallback — never a fabricated
 * compile, never a hard error. Output is SEARCH HYPOTHESES only.
 */
import { describe, expect, it } from "vitest";
import {
  CustomSignalCompileError,
  CustomSignalSchema,
  compileCustomSignal,
} from "../custom-compiler";

const VALID = {
  observableIndicators: ["manual onboarding", "manual process"],
  searchQueries: ['"manual onboarding" hiring', 'companies "manual onboarding"'],
  evidenceRules: ["public post or page states the indicator for the subject"],
  negativeIndicators: ["switched to automation"],
};

describe("CustomSignalSchema", () => {
  it("accepts a well-formed compiled signal", () => {
    const parsed = CustomSignalSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing required array", () => {
    const { observableIndicators: _dropped, ...withoutIndicators } = VALID;
    expect(CustomSignalSchema.safeParse(withoutIndicators).success).toBe(false);
  });

  it("rejects more than the caps (12 indicators, 10 queries, 8 rules, 8 negatives)", () => {
    expect(
      CustomSignalSchema.safeParse({
        ...VALID,
        observableIndicators: Array.from({ length: 13 }, (_, i) => `indicator ${i}`),
      }).success,
    ).toBe(false);
    expect(
      CustomSignalSchema.safeParse({
        ...VALID,
        searchQueries: Array.from({ length: 11 }, (_, i) => `query number ${i}`),
      }).success,
    ).toBe(false);
    expect(
      CustomSignalSchema.safeParse({
        ...VALID,
        evidenceRules: Array.from({ length: 9 }, (_, i) => `rule number ${i}`),
      }).success,
    ).toBe(false);
    expect(
      CustomSignalSchema.safeParse({
        ...VALID,
        negativeIndicators: Array.from({ length: 9 }, (_, i) => `negative ${i}`),
      }).success,
    ).toBe(false);
  });

  it("rejects indicators shorter than 3 characters", () => {
    expect(
      CustomSignalSchema.safeParse({ ...VALID, observableIndicators: ["ab", "ok"] }).success,
    ).toBe(false);
  });
});

describe("compileCustomSignal — input discipline", () => {
  it.each(["", "   ", "ab"])("throws the typed error for %j (<3 chars)", async (input) => {
    await expect(compileCustomSignal(input)).rejects.toBeInstanceOf(CustomSignalCompileError);
  });

  it("the typed error carries a stable code and name", async () => {
    const err = await compileCustomSignal("").catch((e) => e);
    expect(err).toBeInstanceOf(CustomSignalCompileError);
    expect((err as CustomSignalCompileError).code).toBe("custom_signal_input_invalid");
    expect((err as CustomSignalCompileError).name).toBe("CustomSignalCompileError");
  });
});

describe("compileCustomSignal — deterministic fallback", () => {
  it("companies with manual onboarding: runs + lexicon, stable and capped", async () => {
    const out = await compileCustomSignal("companies with manual onboarding");
    expect(out.observableIndicators).toContain("manual onboarding");
    expect(out.observableIndicators).toContain("manual process");
    expect(out.observableIndicators).toContain("onboarding step");
    expect(out.observableIndicators.length).toBeLessThanOrEqual(12);
    expect(out.searchQueries[0]).toBe("companies with manual onboarding");
    expect(out.searchQueries.length).toBeGreaterThan(1);
    expect(out.searchQueries.length).toBeLessThanOrEqual(10);
    expect(out.evidenceRules).toEqual([
      "public post or page states the indicator for the subject",
    ]);
    expect(out.negativeIndicators).toEqual([]);
  });

  it("founders complaining about spreadsheets: run + singularized lexicon", async () => {
    const out = await compileCustomSignal("founders complaining about spreadsheets");
    expect(out.observableIndicators).toContain("founders complaining");
    expect(out.observableIndicators).toContain("spreadsheets");
    expect(out.observableIndicators).toContain("excel");
    expect(out.observableIndicators).toContain("google sheets");
    expect(out.searchQueries.length).toBeGreaterThan(1);
  });

  it("quoted phrases become indicators verbatim (lowercased)", async () => {
    const out = await compileCustomSignal('companies needing "same-day delivery"');
    expect(out.observableIndicators).toContain("same-day delivery");
  });

  it("output is byte-stable across calls (no randomness, no clock)", async () => {
    const text = "agencies chasing invoices and doing manual quoting";
    const a = await compileCustomSignal(text);
    const b = await compileCustomSignal(text);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("nonsense input (>=3 chars) still compiles non-empty from the verbatim text", async () => {
    const out = await compileCustomSignal("???");
    expect(out.observableIndicators.length).toBeGreaterThan(0);
    expect(out.searchQueries.length).toBeGreaterThan(0);
    expect(out.evidenceRules.length).toBeGreaterThan(0);
  });
});

describe("compileCustomSignal — LLM path", () => {
  it("returns the parsed LLM JSON when it matches the schema", async () => {
    const prompts: string[] = [];
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify({
          observableIndicators: ["live chat widget missing"],
          searchQueries: ['"live chat" site:reddit.com'],
          evidenceRules: ["post states there is no live chat"],
          negativeIndicators: ["we added live chat"],
        });
      },
    });
    expect(prompts[0]).toContain("companies with manual onboarding");
    expect(out.observableIndicators).toEqual(["live chat widget missing"]);
    expect(out.searchQueries).toEqual(['"live chat" site:reddit.com']);
    expect(out.negativeIndicators).toEqual(["we added live chat"]);
    // The deterministic lexicon must NOT leak into a successful LLM compile.
    expect(out.observableIndicators).not.toContain("manual onboarding");
  });

  it("markdown-fenced JSON still parses", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async () =>
        "```json\n" +
        JSON.stringify({
          observableIndicators: ["manual onboarding"],
          searchQueries: ['"manual onboarding"'],
          evidenceRules: ["page states it"],
          negativeIndicators: [],
        }) +
        "\n```",
    });
    expect(out.observableIndicators).toEqual(["manual onboarding"]);
  });

  it("unparseable LLM output falls back to the deterministic compile", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async () => "I cannot answer that in JSON, sorry!",
    });
    expect(out.observableIndicators).toContain("manual onboarding");
    expect(out.evidenceRules).toEqual([
      "public post or page states the indicator for the subject",
    ]);
  });

  it("schema-invalid LLM JSON (wrong keys) falls back", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async () => JSON.stringify({ foo: 1, bar: [1, 2, 3] }),
    });
    expect(out.observableIndicators).toContain("manual onboarding");
  });

  it("LLM arrays are normalized: junk dropped, caps enforced", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async () =>
        JSON.stringify({
          observableIndicators: ["ab", "ok indicator phrase", ...Array.from({ length: 14 }, (_, i) => `long indicator ${i}`)],
          searchQueries: [42, "real query about onboarding"],
          evidenceRules: [""],
          negativeIndicators: ["", "already automated"],
        }),
    });
    expect(out.observableIndicators).not.toContain("ab");
    expect(out.observableIndicators.length).toBeLessThanOrEqual(12);
    expect(out.observableIndicators).toContain("ok indicator phrase");
    expect(out.searchQueries).toEqual(["real query about onboarding"]);
    expect(out.negativeIndicators).toEqual(["already automated"]);
  });

  it("timeout falls back to the deterministic compile", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: () =>
        new Promise<string>((resolve) =>
          setTimeout(
            () =>
              resolve(
                JSON.stringify({
                  observableIndicators: ["late answer"],
                  searchQueries: ['"late answer"'],
                  evidenceRules: [],
                  negativeIndicators: [],
                }),
              ),
            200,
          ),
        ),
      signalTimeoutMs: 50,
    });
    expect(out.observableIndicators).not.toContain("late answer");
    expect(out.observableIndicators).toContain("manual onboarding");
  });

  it("a throwing LLM falls back to the deterministic compile", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async () => {
        throw new Error("provider down");
      },
    });
    expect(out.observableIndicators).toContain("manual onboarding");
  });

  it("a uselessly empty LLM compile (no indicators) falls back", async () => {
    const out = await compileCustomSignal("companies with manual onboarding", {
      signal: async () =>
        JSON.stringify({
          observableIndicators: [],
          searchQueries: ['"manual onboarding"'],
          evidenceRules: [],
          negativeIndicators: [],
        }),
    });
    expect(out.observableIndicators).toContain("manual onboarding");
  });
});
