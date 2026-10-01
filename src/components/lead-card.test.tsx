import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadCard } from "./lead-card";

// Shape produced by viewToLegacyLead for a browser-verified person row.
const card = (lead: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(LeadCard, {
    lead: {
      title: "Andrew Breen",
      snippet: "Identity · Andrew Breen Founder & CEO Outshine",
      full_post_url: "https://www.capchase.com/blog/saas-founders",
      ...lead,
    } as never,
    onOpen: () => {},
    onSave: () => {},
  }));

describe("LeadCard footer", () => {
  it("never labels a verified entity result as an anonymous post", () => {
    const html = card({ source: "qualified-person", platform: "qualified-lead", platform_label: "Person" });
    expect(html).toContain("Andrew Breen");
    expect(html).not.toContain(">anon<");
  });

  it("shows a known author on verified results", () => {
    expect(card({ source: "qualified-company", platform: "qualified-lead", author: "Acme" })).toContain(">Acme<");
  });

  it("keeps the anon fallback for community posts without an author", () => {
    expect(card({ source: "reddit", platform: "reddit" })).toContain(">anon<");
  });
});
