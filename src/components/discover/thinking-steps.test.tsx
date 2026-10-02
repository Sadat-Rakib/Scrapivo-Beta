/**
 * Defect C regression net: ThinkingSteps must never call onDone (the parent's
 * setState) during render. The fresh P04/I01 evidence logged
 * "Cannot update a component (`DiscoverPage ThinkingSteps`) while rendering a
 * different component (`ThinkingSteps`)" and P02/S01 logged
 * "Can't perform a React state update on a component that hasn't mounted yet" —
 * both traced to onDone being invoked from inside the setRevealed updater
 * (updaters re-run during render) and from the mount effect.
 *
 * The vitest project runs in the node environment (no jsdom), so effects and
 * timers cannot run here; renderToStaticMarkup exercises exactly the render
 * phase. Any onDone call or console.error during that render is a defect.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingSteps } from "./thinking-steps";

const input = {
  query: "web designers in New York",
  tokens: { category: "web designers", geo: "New York", stage: null, sector: null } as never,
  entityLabel: null,
};

describe("ThinkingSteps render-phase purity (Defect C)", () => {
  it("never calls onDone and never logs console.error while rendering", () => {
    const onDone = vi.fn();
    const errors: unknown[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const html = renderToStaticMarkup(
        createElement(ThinkingSteps, {
          inputKey: "q1",
          input,
          pending: true,
          compact: false,
          onDone,
        }),
      );
      expect(onDone).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
      // Static render shows the first revealed line only (effects never run).
      expect(html).toContain("Thinking");
      expect(html).toContain('aria-live="polite"');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stays pure across a remount with a new input key (per-query reset path)", () => {
    const onDone = vi.fn();
    const errors: unknown[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      for (const key of ["q1", "q2"]) {
        renderToStaticMarkup(
          createElement(ThinkingSteps, {
            inputKey: key,
            input: { ...input, query: `query ${key}` },
            pending: false,
            compact: false,
            onDone,
          }),
        );
      }
      expect(onDone).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("compact mode renders the slim status row without touching parent state", () => {
    const onDone = vi.fn();
    const html = renderToStaticMarkup(
      createElement(ThinkingSteps, {
        inputKey: "q1",
        input,
        pending: true,
        compact: true,
        onDone,
      }),
    );
    expect(onDone).not.toHaveBeenCalled();
    // Compact collapses to the last narration line (the live status).
    expect(html).toContain("Understanding: web designers · New York");
  });
});
