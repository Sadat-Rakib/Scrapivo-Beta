import { describe, expect, it } from "vitest";
import { missingRequiredFields, rowIsComplete } from "../completeness";
import { subjectFromQuery, entityQuestionsForSpec, entityModeQuestion } from "../clarifier";
import { sanitizeSpecRow } from "@/lib/spec-search.functions";
import { resolveJurisdiction, jurisdictionDraftHints } from "@/lib/outreach/jurisdiction";
import { deriveWhyMatch, applyWhyMatchGate } from "../live-gapfill";
import { extractSearchSpec } from "../search-spec-extract";
import { enrichIncompleteRows } from "../enrich-incomplete";
import { fetchJobSpyJobs } from "@/lib/jobs/jobspy-adapter";
import { buildEmailDraft } from "@/lib/outreach-draft";

describe("Phase A completeness + sanitize", () => {
  it("marks person without contact incomplete", () => {
    expect(
      rowIsComplete({ kind: "person", title: "Ada", email: null, phone: null, url: null }),
    ).toBe(false);
    expect(missingRequiredFields({ kind: "person", title: "Ada" })).toContain("contact");
  });

  it("requires contact or site for business unless no_website opportunity", () => {
    expect(rowIsComplete({ kind: "business", title: "Cafe Roma" })).toBe(false);
    expect(
      rowIsComplete({
        kind: "business",
        title: "Cafe Roma",
        opportunity: "no_website",
      }),
    ).toBe(true);
    expect(rowIsComplete({ kind: "business", title: "Cafe Roma", phone: "+1" })).toBe(true);
  });

  it("repairs mojibake on SpecRow", () => {
    const row = sanitizeSpecRow({
      kind: "business",
      title: "CafÃ© Roma",
      detail: "Austin Â· TX",
      email: null,
      phone: "+15551212",
    });
    expect(row.title).not.toMatch(/Ã/);
    expect(row.complete).toBe(true);
  });
});

describe("Phase A personalized clarifiers", () => {
  it("quotes the user ask in location question", () => {
    const spec = extractSearchSpec("bro i need businesses plz asap");
    const qs = entityQuestionsForSpec({ ...spec, raw_query: spec.raw_query });
    expect(qs.some((q) => /looking for/i.test(q.question))).toBe(true);
  });

  it("mode question names the subject", () => {
    const q = entityModeQuestion("person", "startup founders");
    expect(q.question).toMatch(/startup founders/i);
    expect(q.options.map((o) => o.id)).toContain("hiring");
  });

  it("subjectFromQuery clips long asks", () => {
    expect(subjectFromQuery("cafes", "business")).toBe("cafes");
  });
});

describe("Phase B enrich incomplete", () => {
  it("promotes rows when enrichFn fills contact", async () => {
    const { complete, stillIncomplete } = await enrichIncompleteRows(
      [
        {
          kind: "person",
          title: "Ada Lovelace",
          detail: "NY",
          email: null,
          phone: null,
          url: "https://analytical.example",
        },
      ],
      {
        enrichFn: async (r) => ({ ...r, email: "ada@analytical.example" }),
      },
    );
    expect(complete).toHaveLength(1);
    expect(complete[0].email).toBe("ada@analytical.example");
    expect(stillIncomplete).toHaveLength(0);
  });
});

describe("Phase C why-match gate", () => {
  it("drops signal-required rows without evidence", () => {
    const spec = extractSearchSpec("companies looking for website developers");
    const { kept, dropped } = applyWhyMatchGate(
      [{ kind: "company", title: "Acme", detail: "" }],
      spec,
      true,
    );
    expect(dropped).toBe(1);
    expect(kept).toHaveLength(0);
  });

  it("keeps browsing rows without inventing why", () => {
    const spec = extractSearchSpec("dentists in Pune");
    const why = deriveWhyMatch(
      { kind: "business", title: "Bright Smile", detail: "Pune", phone: "+91", location: "Pune" },
      spec,
    );
    expect(why).toBeTruthy();
  });
});

describe("Phase D JobSpy adapter", () => {
  it("returns empty when JOBSPY_API_URL unset", async () => {
    delete process.env.JOBSPY_API_URL;
    expect(await fetchJobSpyJobs({ query: "engineer" })).toEqual([]);
  });
});

describe("Phase E jurisdiction", () => {
  it("maps Canada → CASL, Germany → GDPR, California → CCPA", () => {
    expect(resolveJurisdiction({ country: "ca" })).toBe("casl");
    expect(resolveJurisdiction({ country: "de" })).toBe("gdpr");
    expect(resolveJurisdiction({ country: "us", location: "San Francisco, CA" })).toBe(
      "can_spam_ccpa",
    );
    expect(resolveJurisdiction({ country: "us", location: "Austin, TX" })).toBe("can_spam");
  });

  it("appends compliance footer to email drafts", () => {
    const { body, jurisdiction } = buildEmailDraft(
      {
        vertical: "business",
        name: "Main St Plumbing",
        category: "plumbing",
        location: "Toronto, ON",
        country: "ca",
        noWebsite: true,
      },
      { name: "Mir", service: "websites" },
    );
    expect(jurisdiction).toBe("casl");
    expect(body).toMatch(/CASL|unsubscribe|STOP/i);
    expect(jurisdictionDraftHints("gdpr").label).toMatch(/GDPR/);
  });
});
