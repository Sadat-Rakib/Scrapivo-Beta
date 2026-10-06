/**
 * Founder path (Task 8): "Founders of B2B SaaS startups in Tallinn, Estonia
 * who are hiring engineers right now, with public contact".
 */
import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { validateFrame } from "./validate";
import { applyClarificationToFrame, frameToSearchSpec } from "./to-search-spec";
import { emptyFrame, openValue } from "./frame";

const QUERY = "Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact";
const deterministic = () => validateFrame(extractFrameDeterministic(QUERY)).frame;
const fields = (spec: ReturnType<typeof frameToSearchSpec>) => spec.criteria.map((c) => `${c.field}=${c.value}`);

describe("investor frame to spec mapping", () => {
  function investorFrame(category = " seed investor") {
    const frame = emptyFrame("Find investors in Canada");
    frame.target.entity_type = { value: "investor", raw: "investors", confidence: 1 };
    frame.target.category = openValue(category, category, null, 0.9);
    frame.location = { value: "Canada", raw: "Canada", scope: "in", radius: null, radius_unit: null, country_code: "CA", canonical: "Canada", confidence: 1 };
    frame.locations = [frame.location];
    return frame;
  }

  function freshInvestorFrame() {
    const frame = investorFrame("seed investor");
    frame.target.category = openValue("seed investor", "seed investors", null, 0.9);
    frame.relation.type = { value: "investing_in", raw: "for", confidence: 0.9 };
    frame.relation.object = openValue("AI startup", "AI startups", null, 0.85);
    frame.meta.extractor = "llm";
    frame.meta.notes.push("recovered target descriptors from deterministicparse");
    return frame;
  }

  it("compiles the relayed fresh investor frame from its structured fields", () => {
    const frame = freshInvestorFrame();
    expect(frame.target.industry).toBeNull();
    expect(frame.target.company_stage).toBeNull();
    const spec = frameToSearchSpec(frame);
    expect(spec.criteria).toContainEqual({ field: "investor_sector", value: "AI", stated: true, confidence: 0.85 });
    expect(spec.criteria).toContainEqual({ field: "investor_stage", value: "seed", stated: true, confidence: 0.9 });
    expect(fields(spec)).not.toContain("investor_sector=seed investor");
    expect(fields(spec).some((field) => field.startsWith("investor_check="))).toBe(false);
    expect(spec.understanding?.relation.object).toEqual(frame.relation.object);
    expect(spec.understanding?.target.category?.raw).toBe("seed investors");
    // Input wording contains neither AI nor seed: no raw-query recovery needed.
    expect(spec.raw_query).toBe("Find investors in Canada");
  });

  it.each([
    ["battery recycling startup", "battery recycling"],
    ["precision agriculture companies", "precision agriculture"],
    ["quantum sensing", "quantum sensing"],
  ])("preserves open beneficiary sector %s", (object, sector) => {
    const frame = freshInvestorFrame();
    frame.relation.object = openValue(object, object, null, 0.85);
    expect(fields(frameToSearchSpec(frame))).toContain(`investor_sector=${sector}`);
  });

  it("does not invent a sector from a generic beneficiary entity noun", () => {
    const frame = freshInvestorFrame();
    frame.relation.object = openValue("startup", "startups");
    expect(fields(frameToSearchSpec(frame)).some((field) => field.startsWith("investor_sector="))).toBe(false);
  });

  it.each(["unknown", "hiring", "seeking_funding"] as const)("does not infer beneficiary sector or category stage for %s", (relation) => {
    const frame = freshInvestorFrame();
    frame.relation.type.value = relation;
    expect(fields(frameToSearchSpec(frame)).filter((field) => /^investor_(sector|stage)=/.test(field))).toEqual([]);
  });

  it("keeps explicit sector and stage ahead of beneficiary and category modifiers", () => {
    const frame = freshInvestorFrame();
    frame.target.industry = openValue("healthcare", "healthcare");
    frame.target.company_stage = openValue("series-a", "series-a");
    expect(fields(frameToSearchSpec(frame))).toEqual(expect.arrayContaining(["investor_sector=healthcare", "investor_stage=series-a"]));
    frame.constraints.push({ field: "investor_stage", operator: "eq", value: "series-b", raw: "series-b", confidence: 1, negated: false, unit: null });
    expect(fields(frameToSearchSpec(frame))).toContain("investor_stage=series-b");
  });

  it("maps an explicit company-stage constraint ahead of the category modifier", () => {
    const frame = freshInvestorFrame();
    frame.constraints.push({ field: "company_stage", operator: "eq", value: "series-b", raw: "series-b", confidence: 0.95, negated: false, unit: null });
    const spec = frameToSearchSpec(frame);
    expect(spec.criteria).toContainEqual({ field: "investor_stage", value: "series-b", confidence: 0.95, stated: true });
    expect(fields(spec).some((field) => field.startsWith("company_stage="))).toBe(false);
  });

  it.each([["pre-seed investors", "pre-seed"], ["series A investors", "series-a"]])("recovers source-bound financial stage from %s", (category, stage) => {
    const frame = freshInvestorFrame();
    frame.target.category = openValue(category, category, null, 0.9);
    expect(fields(frameToSearchSpec(frame))).toContain(`investor_stage=${stage}`);
  });

  it.each(["seed libraries", "investors"])("does not infer seed from a category whose raw source is %s", (raw) => {
    const frame = freshInvestorFrame();
    frame.target.category = openValue("seed investor", raw);
    expect(fields(frameToSearchSpec(frame)).some((field) => field.startsWith("investor_stage="))).toBe(false);
  });

  it.each(["pre-seed libraries", "series A cameras"])("does not infer financial stage from non-financial category %s", (category) => {
    const frame = freshInvestorFrame();
    frame.target.category = openValue(category, category);
    expect(fields(frameToSearchSpec(frame)).some((field) => field.startsWith("investor_stage="))).toBe(false);
  });

  it("keeps seed-library business category unchanged", () => {
    const frame = emptyFrame("Find seed libraries in Canada");
    frame.target.entity_type = { value: "business", raw: "seed libraries", confidence: 1 };
    frame.target.category = openValue("seed library", "seed libraries");
    const spec = frameToSearchSpec(frame);
    expect(fields(spec)).toContain("category=seed library");
    expect(fields(spec).filter((field) => /^investor_(sector|stage)=/.test(field))).toEqual([]);
  });

  it("honors any stage instead of recovering the category stage again", () => {
    const answered = applyClarificationToFrame(freshInvestorFrame(), { investor_stage: "any" });
    expect(fields(frameToSearchSpec(answered)).some((field) => field.startsWith("investor_stage="))).toBe(false);
  });

  it("maps canonical industry and company stage to investor sector and stage", () => {
    const frame = investorFrame();
    frame.target.industry = openValue("AI", "AI", null, 0.9);
    frame.target.company_stage = openValue("seed", "seed", null, 0.8);
    const spec = frameToSearchSpec(frame);
    expect(spec.entity).toBe("investor");
    expect(spec.criteria).toContainEqual({ field: "investor_sector", value: "AI", confidence: 0.9, stated: true });
    expect(spec.criteria).toContainEqual({ field: "investor_stage", value: "seed", confidence: 0.8, stated: true });
    expect(fields(spec)).not.toContain("investor_sector=seed investor");
    expect(fields(spec).some((field) => field.startsWith("company_stage="))).toBe(false);
  });

  it.each([" seed investor", "angel investor", "venture capital", "family office", "fund"])("does not turn investor category %s into a sector", (category) => {
    const frame = investorFrame(category);
    frame.target.business_type = openValue(category, category);
    const spec = frameToSearchSpec(frame);
    expect(fields(spec).some((field) => field.startsWith("investor_sector="))).toBe(false);
    expect(fields(spec).some((field) => field.startsWith("investor_stage="))).toBe(false);
  });

  it("preserves company stage for a noninvestor frame", () => {
    const frame = emptyFrame("Find software companies in Canada");
    frame.target.entity_type = { value: "company", raw: "companies", confidence: 1 };
    frame.target.industry = openValue("software", "software");
    frame.target.company_stage = openValue("seed", "seed", null, 0.8);
    const spec = frameToSearchSpec(frame);
    expect(fields(spec)).toContain("company_stage=seed");
    expect(fields(spec).some((field) => field.startsWith("investor_stage="))).toBe(false);
  });

  it.each(["seed", "series-a"])("persists optional investor stage answer %s without an unresolved slot", (stage) => {
    const frame = investorFrame();
    expect(frame.unresolved).toEqual([]);
    const answered = applyClarificationToFrame(frame, { investor_stage: stage });
    expect(fields(frameToSearchSpec(answered))).toContain(`investor_stage=${stage}`);
    expect(answered.clarification.answered?.investor_stage).toBe(stage);
    expect(frame.target.company_stage).toBeNull();
  });

  it.each(["angel", "seed", "growth"])("persists optional investor check answer %s as a categorical constraint", (check) => {
    const answered = applyClarificationToFrame(investorFrame(), { investor_check: check });
    expect(fields(frameToSearchSpec(answered))).toContain(`investor_check=${check}`);
    expect(answered.constraints).toContainEqual({ field: "investor_check", operator: "eq", value: check, raw: check, confidence: 1, negated: false, unit: null });
    expect(answered.clarification.answered?.investor_check).toBe(check);
  });

  it("replaces prior investor refinements and removes them on any", () => {
    const frame = investorFrame();
    frame.target.company_stage = openValue("seed", "seed");
    frame.constraints.push({ field: "investor_stage", operator: "eq", value: "seed", raw: "seed", confidence: 1, negated: false, unit: null });
    frame.constraints.push({ field: "company_stage", operator: "eq", value: "seed", raw: "seed", confidence: 1, negated: false, unit: null });
    const answered = applyClarificationToFrame(frame, { investor_stage: "series-a", investor_check: "growth" });
    expect(fields(frameToSearchSpec(answered))).toEqual(expect.arrayContaining(["investor_stage=series-a", "investor_check=growth"]));
    const cleared = applyClarificationToFrame(answered, { investor_stage: "any", investor_check: "any" });
    expect(fields(frameToSearchSpec(cleared)).filter((field) => /^investor_(stage|check)=/.test(field))).toEqual([]);
    expect(cleared.clarification.answered?.investor_stage).toBe("any");
    expect(cleared.clarification.answered?.investor_check).toBe("any");
  });

  it("clears an unresolved investor refinement after applying its named answer", () => {
    const frame = investorFrame();
    frame.unresolved.push({ field: "investor_stage", raw: "early" });
    const answered = applyClarificationToFrame(frame, { "unresolved.investor_stage": "seed" });
    expect(answered.unresolved).toEqual([]);
    expect(fields(frameToSearchSpec(answered))).toContain("investor_stage=seed");
  });
});

/** What the provider returned in a real run: no place, contact split into email AND phone. */
function providerFrame() {
  const frame = structuredClone(deterministic());
  frame.meta.extractor = "llm";
  frame.location = null;
  frame.locations = [];
  frame.target.role = openValue("founder", "Founders", "founder", 0.9);
  frame.required_fields = [openValue("email", "public contact", "email", 0.8), openValue("phone", "public contact", "phone", 0.8)];
  return applyClarificationToFrame(frame, {});
}

describe("founder path understanding", () => {
  it("deterministic parse: founder role, SaaS industry, startup stage, hiring engineers, recent, any public contact", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(deterministic(), {}));
    const criteria = fields(spec);
    expect(criteria).toContain("role=founder");
    expect(criteria.find((c) => c.startsWith("industry="))?.toLowerCase()).toBe("industry=saas");
    expect(criteria).toContain("company_stage=startup");
    expect(criteria).toContain("requested_role=engineer");
    expect(criteria).toContain("required_field=contact");
    expect(criteria.some((c) => c === "required_field=email" || c === "required_field=phone")).toBe(false);
    expect(spec.signal_required).toBe(true);
    expect(spec.signal_types).toEqual(["hiring"]);
    expect(criteria.find((c) => c.startsWith("location="))).toMatch(/Tallinn/);
  });

  it("provider frame: recovers the dropped place and reads 'public contact' as any channel", () => {
    const spec = frameToSearchSpec(providerFrame());
    const criteria = fields(spec);
    expect(criteria.find((c) => c.startsWith("location="))).toMatch(/Tallinn/);
    expect(spec.understanding?.meta.notes.join(" ")).toMatch(/recovered location/);
    expect(criteria).toContain("required_field=contact");
    expect(criteria).not.toContain("required_field=email");
    expect(criteria).not.toContain("required_field=phone");
  });

  it("keeps channels the user named, and never recovers an excluded place", () => {
    const named = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS founders in Tallinn with public contact, email and phone")).frame, {}));
    expect(fields(named)).toEqual(expect.arrayContaining(["required_field=email", "required_field=phone"]));
    const frame = structuredClone(validateFrame(extractFrameDeterministic("SaaS founders excluding Tallinn")).frame);
    frame.meta.extractor = "llm";
    frame.location = null;
    frame.locations = [];
    const spec = frameToSearchSpec(applyClarificationToFrame(frame, {}));
    expect(fields(spec).some((c) => c.startsWith("location=") && /tallinn/i.test(c))).toBe(false);
  });

  it("reads 'globally' / 'worldwide' / 'anywhere in the world' as a worldwide scope, never as a place", () => {
    for (const query of ["Find 10 SaaS founders globally who may need help with AI automation", "SaaS founders worldwide", "agencies anywhere in the world"]) {
      const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));
      expect(fields(spec).some((c) => c.startsWith("location=")), query).toBe(false);
      expect(fields(spec), query).toContain("geo_scope=worldwide");
      expect(spec.locations ?? [], query).toEqual([]);
    }
    // A real place next to the wording still counts.
    const both = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS founders in Toronto")).frame, {}));
    expect(fields(both)).toContain("location=Toronto");
    // A provider frame that dropped the place: the recovered "the world" is a scope too.
    const frame = structuredClone(validateFrame(extractFrameDeterministic("agencies anywhere in the world")).frame);
    frame.meta.extractor = "llm";
    frame.location = null;
    frame.locations = [];
    const recovered = frameToSearchSpec(applyClarificationToFrame(frame, {}));
    expect(fields(recovered).some((c) => c.startsWith("location="))).toBe(false);
    expect(fields(recovered)).toContain("geo_scope=worldwide");
  });

  it("reads 'contact info' the same on the provider path: any channel, not email AND phone", () => {
    const query = "plumbers in Leeds with contact info";
    const deterministicSpec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));
    const frame = structuredClone(validateFrame(extractFrameDeterministic(query)).frame);
    frame.meta.extractor = "llm";
    frame.required_fields = [];
    const providerSpec = frameToSearchSpec(applyClarificationToFrame(frame, {}));
    for (const spec of [deterministicSpec, providerSpec]) {
      expect(fields(spec)).toContain("required_field=contact");
      expect(fields(spec)).not.toContain("required_field=email");
      expect(fields(spec)).not.toContain("required_field=phone");
    }
    const every = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("plumbers in Leeds, all contact details")).frame, {}));
    expect(fields(every)).toEqual(expect.arrayContaining(["required_field=email", "required_field=phone"]));
  });

  it("never turns a negated or compound contact phrase into a requirement", () => {
    for (const query of ["restaurants in Leeds without contact info", "BPOs in Manila with a contact center", "cafes in Leeds, no email"]) {
      const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));
      expect(fields(spec).filter((c) => /^required_field=(contact|email)$/.test(c)), query).toEqual([]);
    }
    const mixed = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("cafes in Leeds with contact details, no phone numbers")).frame, {}));
    expect(fields(mixed)).toContain("required_field=contact");
    expect(fields(mixed)).not.toContain("required_field=phone");
  });

  it("matrix misparses on the deterministic path: a sector inside the place span, a participle read as a town", () => {
    const investors = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("Seed investors in fintech in London")).frame, {}));
    expect(fields(investors)).toContain("location=London");
    expect(fields(investors)).toContain("investor_sector=fintech");
    const district = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("marketing agencies in shoreditch in London")).frame, {}));
    expect(fields(district)).toContain("location=London");
    expect(fields(district).some((c) => /shoreditch/i.test(c) && !c.startsWith("location"))).toBe(false);
    const talking = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS founders talking about churn on LinkedIn")).frame, {}));
    expect(fields(talking).some((c) => c.startsWith("location="))).toBe(false);
    expect(fields(talking)).toContain("content_topic=churn on LinkedIn");
    // A bare place after the head noun still reads as a place.
    const chat = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("hi cobblers brno pls")).frame, {}));
    expect(fields(chat).find((c) => c.startsWith("location="))).toMatch(/brno/i);
  });

  it("never reads a requested deliverable as a town when 'with' is dropped", () => {
    // UI acceptance: "B2B SaaS founders public contact details" searched a place
    // called "public contact details" and returned 0.
    for (const query of ["B2B SaaS founders public contact details", "SaaS founders public emails"]) {
      const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));
      expect(fields(spec).filter((c) => c.startsWith("location=")), query).toEqual([]);
      expect(fields(spec), query).toContain("role=founder");
    }
    const placed = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("plumbers in Austin public phone numbers")).frame, {}));
    expect(fields(placed).find((c) => c.startsWith("location="))).toBe("location=Austin");
  });

  it("keeps a narrowing organization noun in the founder role", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("founders of agencies in Leeds")).frame, {}));
    expect(fields(spec).find((c) => c.startsWith("role="))).toMatch(/agenc/);
    expect(fields(spec)).not.toContain("company_stage=startup");
  });

  it("does not read 'contacts at' or a contact page as a contact deliverable", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("agencies with contacts at Shopify in Toronto")).frame, {}));
    expect(fields(spec)).not.toContain("required_field=contact");
  });
});

describe("a worldwide scope glued to an activity clause", () => {
  it("reads the scope as scope and the activity as industry", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("find startup founders worldwide building fintech")).frame, {}));
    expect(fields(spec)).toContain("geo_scope=worldwide");
    expect(fields(spec).find((c) => c.startsWith("industry="))?.toLowerCase()).toBe("industry=fintech");
    expect(fields(spec).find((c) => c.startsWith("role="))).toMatch(/founder/);
    expect(fields(spec).some((c) => c.startsWith("location=") || c.startsWith("location_id="))).toBe(false);
  });

  it("keeps the same shape with no target noun at all", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("globally building AI")).frame, {}));
    expect(fields(spec)).toContain("geo_scope=worldwide");
    expect(fields(spec).find((c) => c.startsWith("industry="))?.toLowerCase()).toBe("industry=ai");
    expect(fields(spec).some((c) => c.startsWith("location="))).toBe(false);
  });

  it("never swallows an activity clause into a place span", () => {
    const london = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("founders in London building fintech")).frame, {}));
    expect(fields(london).find((c) => c.startsWith("location="))).toMatch(/London/);
    expect(fields(london).find((c) => c.startsWith("industry="))?.toLowerCase()).toBe("industry=fintech");
    const canada = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS founders across Canada hiring salespeople")).frame, {}));
    expect(fields(canada)).toContain("location=Canada");
    expect(fields(canada)).toContain("industry=saas");
    expect(canada.understanding?.relation.type.value).toBe("hiring");
    const toronto = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("companies in Toronto looking for designers")).frame, {}));
    expect(fields(toronto).find((c) => c.startsWith("location="))).toBe("location=Toronto");
    expect(toronto.understanding?.location?.value).not.toMatch(/looking/);
  });

  it("still reads a real place next to the scope wording", () => {
    const spec = frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic("SaaS founders in Toronto")).frame, {}));
    expect(fields(spec)).toContain("location=Toronto");
    expect(fields(spec).some((c) => c.startsWith("geo_scope="))).toBe(false);
  });
});
