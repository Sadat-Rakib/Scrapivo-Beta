import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { validateFrame } from "./validate";
import { applyClarificationToFrame, frameToSearchSpec } from "./to-search-spec";
import { decideSpecClarification } from "@/lib/stage1/stage1-adapter";

const understand = (query: string) =>
  frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));
const topic = (query: string) => understand(query).criteria.find((c) => c.field === "content_topic")?.value;

describe("social discussion topics", () => {
  it("reads an explicit discussion clause as a content topic", () => {
    expect(topic("copywriters in New York who write about AI slop")).toMatch(/ai slop/i);
    expect(topic("founders in Lagos posting about fundraising")).toMatch(/fundraising/i);
    expect(topic("marketers in Austin talking about churn")).toMatch(/churn/i);
  });

  it("does not turn compound category nouns into a discussion topic", () => {
    expect(topic("grant writing agencies in Split")).toBeUndefined();
    expect(topic("job posting services in Leeds")).toBeUndefined();
    expect(topic("Find pre-seed AI investors in Singapore actively writing checks")).toBeUndefined();
    expect(understand("grant writing agencies in Split").criteria.some((c) => c.field === "needs_live")).toBe(false);
  });

  it("keeps posting-freshness wording out of topics", () => {
    expect(topic("gotta find physio clinics in Surabaya no site but posts this month need phone")).toBeUndefined();
    expect(topic("I sell SEO. find active shops in Alberta that could use SEO help, verify last social post and emails")).toBeUndefined();
  });
});

describe("tentative fit phrasing", () => {
  it("treats 'could use X' as fit, not an unreadable relation, and keeps the stated offer", () => {
    const spec = understand("I sell SEO. find active shops in Alberta that could use SEO help, verify last social post and emails");
    expect(spec.understanding?.relation.type.value).toBe("none");
    expect(spec.understanding?.clarification.needed).toBe(false);
    expect(spec.purpose).toBe("prospecting");
    expect(decideSpecClarification(spec)).toBeNull();
    expect(spec.understanding?.user_context.selling?.service?.value).toMatch(/^seo$/i);
  });

  it("bounds a new offer at the clause edge", () => {
    const spec = understand("cafes in Perth that might need marketing help, emails please");
    expect(spec.understanding?.user_context.selling?.service?.value).toBe("marketing");
  });
});

describe("expressed pain and defection", () => {
  // A complaint is an intent signal: the spec must demand the signal and carry
  // the topic as a criterion, not degrade into directory prospecting.
  const cases: ReadonlyArray<[string, RegExp]> = [
    ["Founders complaining about lead generation", /lead generation/i],
    ["founders frustrated with CRMs", /crms/i],
    ["people struggling with bookkeeping", /bookkeeping/i],
    ["founders asking for recommendations for an SEO agency", /seo agency/i],
    ["companies switching away from SAP", /sap/i],
  ];
  for (const [query, topic] of cases) {
    it(`"${query}" keeps the topic and requires a signal`, () => {
      const spec = understand(query);
      expect(spec.criteria.find((c) => c.field === "content_topic")?.value).toMatch(topic);
      expect(spec.signal_required).toBe(true);
      expect(spec.signal_types).toEqual(["service_request"]);
      expect(spec.understanding?.relation.type.value).toBe("custom");
      expect(spec.understanding?.evidence.intent_signal_required).toBe(true);
      expect(spec.understanding?.location).toBeNull();
    });
  }

  it("stops the topic at a trailing place", () => {
    expect(topic("founders in Toronto complaining about payroll")).toMatch(/^payroll$/i);
    expect(understand("founders in Toronto complaining about payroll").criteria.find((c) => c.field === "location")?.value).toMatch(/toronto/i);
  });
});
