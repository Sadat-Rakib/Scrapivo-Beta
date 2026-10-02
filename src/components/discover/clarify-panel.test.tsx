import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClarifyPanel } from "./clarify-panel";

describe("mobile clarification layout", () => {
  it("bounds the panel and keeps choices scrollable below a visible question", () => {
    const html = renderToStaticMarkup(
      createElement(ClarifyPanel, {
        questions: [
          {
            id: "entity_category",
            question: "What kind of businesses?",
            options: Array.from({ length: 8 }, (_, i) => ({
              id: `option-${i}`,
              label: `Option ${i}`,
              hint: "Example",
            })),
            allowOther: true,
          },
        ],
        onApply: () => {},
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("max-h-[65dvh]");
    expect(html).toContain("safe-area-inset-bottom");
    expect(html).toContain("min-h-0 flex-1 space-y-1.5 overflow-y-auto");
    expect(html.indexOf("What kind of businesses?")).toBeLessThan(html.indexOf("overflow-y-auto"));
    expect(html.indexOf("overflow-y-auto")).toBeLessThan(html.indexOf("Search with defaults"));
  });
});

describe("multi-question clarification layout (BUG-09 / PRD §30–31)", () => {
  const manyQuestions = Array.from({ length: 6 }, (_, i) => ({
    id: "entity_category" as const,
    question: `Question ${i + 1}: what matters here?`,
    options: Array.from({ length: 6 }, (_, j) => ({
      id: `option-${i}-${j}`,
      label: `Option ${j}`,
      hint: "Example",
    })),
    allowOther: i === 0,
  }));

  it("renders a long question set inside a bounded, scrollable container", () => {
    const html = renderToStaticMarkup(
      createElement(ClarifyPanel, {
        questions: manyQuestions,
        onApply: () => {},
        onDismiss: () => {},
      }),
    );
    // Panel itself is height-bounded and clips; the option list scrolls
    // independently (viewport-relative caps, never fixed px).
    expect(html).toContain("max-h-[65dvh]");
    expect(html).toContain("min-h-0");
    expect(html).toContain("overflow-y-auto overscroll-contain");
    // All six questions are accounted for in the step machinery...
    expect(html).toContain("Question 1 of 6");
    expect(html).toContain('aria-valuemax="6"');
    // ...and only the current one is visible (one-at-a-time flow).
    expect(html).not.toContain("Question 2: what matters here?");
    // Reading order stays: question text, then the scroll region, then actions.
    expect(html.indexOf("Question 1: what matters here?")).toBeLessThan(
      html.indexOf("overflow-y-auto overscroll-contain"),
    );
    expect(html.indexOf("overflow-y-auto overscroll-contain")).toBeLessThan(html.indexOf("Skip"));
  });
});
