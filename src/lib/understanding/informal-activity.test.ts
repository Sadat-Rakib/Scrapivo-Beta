import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { frameToSearchSpec } from "./to-search-spec";

/** PRD V2 Phase 9: informal do-verb shapes must resolve the activity into the
 *  spec BEFORE clarification evaluation — no "what should they be doing?" for
 *  an activity the user already stated. */
describe("informal activity shapes resolve before clarification", () => {
  const cases: Array<{ query: string; entity: string; activity: string; location: string }> = [
    { query: "anyone doing solar installation around Windhoek? get me as many decent ones as you can with numbers", entity: "business", activity: "solar installation", location: "Windhoek" },
    { query: "companies doing solar installation in Windhoek", entity: "company", activity: "solar installation", location: "Windhoek" },
    { query: "businesses that do solar installation near Windhoek", entity: "business", activity: "solar installation", location: "Windhoek" },
    { query: "who does solar installation around Windhoek", entity: "business", activity: "solar installation", location: "Windhoek" },
  ];

  for (const c of cases) {
    it(`resolves "${c.query.slice(0, 44)}…" without clarifying the activity`, () => {
      const spec = frameToSearchSpec(extractFrameDeterministic(c.query));
      expect(spec.entity).toBe(c.entity);
      const values = spec.criteria.filter((x) => ["category", "industry"].includes(x.field)).map((x) => x.value.toLowerCase());
      expect(values.some((v) => v.includes(c.activity.toLowerCase()))).toBe(true);
      expect(spec.criteria.some((x) => x.field === "location" && x.value.toLowerCase().includes(c.location.toLowerCase()))).toBe(true);
      expect(spec.status).toBe("ready_to_search");
      expect(spec.criteria.some((x) => x.field === "activity" && x.value === "unknown")).toBe(false);
    });
  }
});
