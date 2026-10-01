import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamedReconciliationNote } from "./streamed-reconciliation-note";

describe("streamed-vs-final reconciliation note", () => {
  it("names each streamed lead missing from the final list with its reason", () => {
    const html = renderToStaticMarkup(createElement(StreamedReconciliationNote, {
      items: [
        { key: "a", title: "Ben Okafor", label: "on the next page" },
        { key: "b", title: "Chloe Martin", label: "missing a detail you asked for" },
      ],
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain("2 leads seen while researching aren&#x27;t in this list");
    expect(html).toContain("Ben Okafor · on the next page");
    expect(html).toContain("Chloe Martin · missing a detail you asked for");
  });

  it("renders nothing when every streamed lead was delivered", () => {
    expect(renderToStaticMarkup(createElement(StreamedReconciliationNote, { items: [] }))).toBe("");
  });
});
