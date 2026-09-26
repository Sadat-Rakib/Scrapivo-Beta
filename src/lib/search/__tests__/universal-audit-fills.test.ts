import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { formatPlace, markSoftDuplicates } from "../format-place";
import { sanitizeJobText } from "@/lib/jobs/hygiene";
import { mentionsPlace } from "../clarifier";
import { deriveWhyMatch } from "../live-gapfill";

describe("universal audit extract fixes", () => {
  it("extracts coffee roasters and yoga studios as businesses", () => {
    expect(extractSearchSpec("coffee roasters in Portland").entity).toBe("business");
    expect(
      extractSearchSpec("coffee roasters in Portland").criteria.find((c) => c.field === "category")
        ?.value,
    ).toMatch(/coffee|roaster/i);
    expect(extractSearchSpec("yoga studios in Austin").entity).toBe("business");
  });

  it("extracts unicode geo (Medellín)", () => {
    const loc = extractSearchSpec("cafes in Medellín").criteria.find(
      (c) => c.field === "location",
    )?.value;
    expect(loc).toBeTruthy();
    expect(loc!.toLowerCase()).toContain("medell");
  });

  it("treats worldwide as geo_scope and skips location missing", () => {
    const s = extractSearchSpec("SaaS founders worldwide");
    expect(s.criteria.some((c) => c.field === "geo_scope" && c.value === "worldwide")).toBe(true);
    expect(s.missing).not.toContain("location");
    expect(mentionsPlace("founders worldwide")).toBe(true);
  });

  it("keeps person entity for B2B founders and CTOs plural", () => {
    const b2b = extractSearchSpec("B2B founders in India");
    expect(b2b.entity).toBe("person");
    expect(b2b.criteria.find((c) => c.field === "role")?.value).toBe("founder");
    const ctos = extractSearchSpec("CTOs at Series A startups in Berlin");
    expect(ctos.entity).toBe("person");
    expect(ctos.criteria.find((c) => c.field === "role")?.value).toBe("cto");
  });

  it("flags SEO help as signal_required", () => {
    const s = extractSearchSpec("restaurants in Toronto needing SEO help");
    expect(s.signal_required).toBe(true);
  });

  it("does not treat bare 'need companies' as a buying signal", () => {
    const s = extractSearchSpec("yo need companies rn");
    expect(s.signal_required).toBe(false);
    expect(s.missing).toEqual(expect.arrayContaining(["industry", "location"]));
    expect(s.status).toBe("needs_clarification");
  });
});

describe("formatPlace + soft dups + job entities", () => {
  it("dedupes repeated place tokens", () => {
    expect(formatPlace(["Alberta", "AB", "Alberta", "Canada"])).toBe("Alberta, AB, Canada");
  });

  it("marks soft duplicates by phone+detail", () => {
    const rows = markSoftDuplicates([
      { title: "A", phone: "+1 (555) 111-2222", detail: "1 Main St, Austin" },
      { title: "B", phone: "15551112222", detail: "1 Main St, Austin" },
      { title: "C", phone: "999", detail: "Other" },
    ]);
    expect(rows[0].soft_duplicate).toBe(true);
    expect(rows[1].soft_duplicate).toBe(true);
    expect(rows[2].soft_duplicate).toBeFalsy();
  });

  it("decodes numeric HTML entities in job titles", () => {
    expect(sanitizeJobText("Engineer &#x28;Senior&#x29;")).toBe("Engineer (Senior)");
    expect(sanitizeJobText("Foo &#40;Bar&#41;")).toBe("Foo (Bar)");
  });

  it("derives browsing why-match for businesses", () => {
    const spec = extractSearchSpec("dentists in Pune");
    const why = deriveWhyMatch(
      { kind: "business", title: "Bright", detail: "Pune", location: "Pune" },
      spec,
    );
    expect(why).toBeTruthy();
    expect(why).toMatch(/Pune|dentist/i);
  });
});
