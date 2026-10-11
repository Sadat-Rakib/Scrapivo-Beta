import { describe, expect, it } from "vitest";

import { extractFrameDeterministic } from "./fallback";
import { frameToSearchSpec } from "./to-search-spec";
import { validateFrame } from "./validate";

function specOf(raw: string) {
  const { frame } = validateFrame(extractFrameDeterministic(raw));
  return frameToSearchSpec(frame);
}

const values = (criteria: ReturnType<typeof specOf>["criteria"], field: string) =>
  criteria.filter((item) => item.field === field).map((item) => String(item.value));

describe("stage 2 query regressions", () => {
  it("keeps both cities for Ottawa and Gatineau dental clinic searches", () => {
    const spec = specOf(
      "need about 12 independent dental clinics around Ottawa and Gatineau, email is mandatory because this is an email campaign, phone would be nice but dont require it, bilingual sites fine and skip national chains",
    );

    expect(spec.entity).toBe("business");
    expect(spec.locations).toEqual(expect.arrayContaining(["Ottawa", "Gatineau"]));
    expect(values(spec.criteria, "required_field")).toContain("email");
    expect(values(spec.criteria, "prefer_phone")).toContain("true");
  });

  it("keeps job entity, role alternatives, recency and places for Europe job searches", () => {
    const spec = specOf(
      "junior data analyst or python developer jobs remote across Europe, hybrid Dublin or Lisbon also okay, posted in the last month ideally, 0 to 2 years preferred and salary unknown fine, actual current employer openings not job board companies",
    );

    const roles = values(spec.criteria, "role").join(" ");
    expect(spec.entity).toBe("job");
    expect(roles).toContain("data analyst");
    expect(roles).toContain("python developer");
    expect(spec.locations).toEqual(expect.arrayContaining(["Europe", "Dublin", "Lisbon"]));
    expect(values(spec.criteria, "prefer_temporal_window")).toContain("1m");
  });

  it("keeps founder and CTO role alternatives in Toronto and Vancouver", () => {
    const spec = specOf("find founders or CTOs at startups in Toronto and Vancouver");
    const roles = values(spec.criteria, "role").join(" ");

    expect(spec.entity).toBe("person");
    expect(roles).toContain("founder");
    expect(roles.toLowerCase()).toContain("cto");
    expect(spec.locations).toEqual(expect.arrayContaining(["Toronto", "Vancouver"]));
  });

  it("keeps Canada-wide remote frontend jobs as jobs", () => {
    const spec = specOf("Canada remote frontend jobs, React or Vue, posted recently");

    expect(spec.entity).toBe("job");
    expect(spec.locations).toContain("Canada");
    expect(values(spec.criteria, "employment")).toContain("remote");
  });

  it("keeps Dhaka analyst query as a person search in Dhaka", () => {
    const spec = specOf("find data analysts in Dhaka with public LinkedIn profiles");

    expect(spec.entity).toBe("person");
    expect(values(spec.criteria, "role").join(" ")).toContain("data analyst");
    expect(spec.locations).toContain("Dhaka");
  });
});
