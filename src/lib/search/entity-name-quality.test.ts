import { describe, expect, it } from "vitest";
import { browserEntitiesToRows } from "./browser-live.server";
import { isJunkEntityName } from "./entity-name-quality";
import type { SearchSpec } from "./search-spec";

describe("captured Q11 navigation identities", () => {
  it("rejects Censys menu fragments as company identities before further research", () => {
    // Literal adjacent fragments retained in the Q11 provisional-row quotes.
    const pages = [{
      url: "https://censys.com/case-studies/data-cybersecurity-company-case-study/",
      title: "Why a Cybersecurity Company Chose Censys over Competitors - Censys",
      text: "Platform\nPlatform\nPlatform Overview\nInternet Map",
    }];
    const spec: SearchSpec = {
      entity: "company", criteria: [{ field: "industry", value: "cybersecurity company", stated: true, confidence: 1 }],
      missing: [], status: "ready_to_search", signal_required: false, signal_types: [],
      signal_recency: null, raw_query: "cybersecurity companies",
    };
    const extracted = [
      { page: 0, kind: "company" as const, name: "Platform", identityQuote: "Platform Platform", fields: {} },
      { page: 0, kind: "company" as const, name: "Platform Overview", identityQuote: "Platform Overview Internet Map", fields: {} },
    ];
    const reasons: string[] = [];
    const rows = browserEntitiesToRows(extracted, pages, event => {
      if (event.kind === "entity" && event.reason) reasons.push(event.reason);
    }, spec);
    expect(rows).toEqual([]);
    expect(reasons.filter(reason => reason === "LIST_PAGE_AS_ENTITY")).toHaveLength(2);
  });

  it.each(["Platform.sh", "PlatformScience", "OverviewAI"])("preserves observed proper brand %s", name => {
    expect(isJunkEntityName(name)).toBe(false);
    const quote = `${name} is a software company building its own developer platform.`;
    const rows = browserEntitiesToRows([{ page: 0, kind: "company", name, identityQuote: quote, fields: {} }],
      [{ url: "https://example.org/about", title: name, text: quote }]);
    expect(rows.map(row => row.title)).toEqual([name]);
  });
});
