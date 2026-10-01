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
