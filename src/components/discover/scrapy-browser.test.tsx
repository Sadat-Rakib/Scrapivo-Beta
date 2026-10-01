import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrapyBrowserView, scrapyPollDelay, type ScrapyState } from "./scrapy-browser";

const base: ScrapyState = {
  active: true, status: "active", currentUrl: "https://acme.test/contact", currentTitle: "Contact Acme", currentAction: "Navigating to result",
  pagesVisited: 4, actionCount: 9, elapsedMs: 42_000, screenshotDataUrl: "data:image/jpeg;base64,AAAA",
  adapter: "worker", controller: "agent", retained: false, canControl: true,
};
const render = (state: Partial<ScrapyState>, expanded = true) =>
  renderToStaticMarkup(createElement(ScrapyBrowserView, { state: { ...base, ...state }, expanded, onExpand: () => {}, onCollapse: () => {}, onCommand: () => {} }));

describe("Scrapy mini-browser controls", () => {
  it("offers Take control on a live worker session, without closing a running search's browser", () => {
    const html = render({});
    expect(html).toContain("Take control");
    expect(html).not.toContain("Close browser");
    expect(html).not.toContain("coming next");
    expect(html).not.toContain("Type into the page");
  });

  it("turns the frame into a click target and shows typing, keys and give-back while a person controls it", () => {
    const html = render({ controller: "human", status: "user_control" });
    expect(html).toContain('aria-label="Click this point in the page"');
    expect(html).toContain('aria-label="Type into the page"');
    expect(html).toContain("Give control back");
    expect(html).toContain("You&#x27;re in control. Scrapy is paused.");
    expect(html).toContain('aria-label="Scroll down"');
  });

  it("keeps a finished run's browser open for viewing, control and closing", () => {
    const html = render({ active: false, status: "completed", retained: true });
    expect(html).toContain("kept open");
    expect(html).toContain("Take control");
    expect(html).toContain("Close browser");
    const collapsed = render({ active: false, status: "completed", retained: true }, false);
    expect(collapsed).toContain("Scrapy browser kept open");
  });

  it("is view-only for the legacy runtime and after the browser was closed", () => {
    const legacy = render({ adapter: "playwright", canControl: false });
    expect(legacy).toContain("Viewing only");
    expect(legacy).not.toContain("Take control");
    const closed = render({ active: false, status: "completed", retained: false, canControl: false });
    expect(closed).toContain("Browser closed");
    expect(closed).not.toContain("Take control");
  });

  it("announces control errors", () => {
    const html = renderToStaticMarkup(createElement(ScrapyBrowserView, { state: base, expanded: true, error: "Take control of the browser first.", onExpand: () => {}, onCollapse: () => {}, onCommand: () => {} }));
    expect(html).toContain('role="alert"');
  });

  it("polls fast while a person drives and stops once the browser is gone", () => {
    expect(scrapyPollDelay({ ...base, controller: "human" })).toBe(1_000);
    expect(scrapyPollDelay(base)).toBe(1_500);
    expect(scrapyPollDelay({ ...base, active: false, status: "completed", retained: true })).toBe(4_000);
    expect(scrapyPollDelay({ ...base, active: false, status: "completed", retained: false })).toBeNull();
  });
});
