/**
 * Founder path (Task 8): "Founders of B2B SaaS startups in Tallinn, Estonia
 * who are hiring engineers right now, with public contact".
 */
import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { validateFrame } from "./validate";
import { applyClarificationToFrame, frameToSearchSpec } from "./to-search-spec";
import { openValue } from "./frame";

const QUERY = "Founders of B2B SaaS startups in Tallinn, Estonia who are hiring engineers right now, with public contact";
const deterministic = () => validateFrame(extractFrameDeterministic(QUERY)).frame;
const fields = (spec: ReturnType<typeof frameToSearchSpec>) => spec.criteria.map((c) => `${c.field}=${c.value}`);

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
