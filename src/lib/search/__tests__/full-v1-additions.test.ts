/**
 * Full-V1 additions: structured page facts (JSON-LD) + zero-result narrative.
 */
import { describe, expect, it } from "vitest";
import { extractStructuredFacts, factsFromJsonLdText } from "../page-structured";
import { enrichZeroNarrative, zeroResultsNarrative } from "../outcome-ui";

const JOB_PAGE = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"JobPosting",
 "title":"Senior React Developer",
 "hiringOrganization":{"@type":"Organization","name":"Northwind Labs"},
 "url":"https://northwind.example/careers/react-dev",
 "datePosted":"2026-09-20",
 "employmentType":"FULL_TIME",
 "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Toronto","addressRegion":"ON"}},
 "baseSalary":{"@type":"MonetaryAmount","currency":"CAD","value":{"@type":"QuantitativeValue","minValue":110000,"maxValue":140000,"unitText":"YEAR"}}}
</script>
</head><body>Senior React Developer role at Northwind Labs in Toronto. Apply now.</body></html>`;

const ORG_PAGE = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"LocalBusiness","name":"Acme Plumbing",
 "email":"help@acmeplumbing.example","telephone":"+1 512 555 0100",
 "contactPoint":{"@type":"ContactPoint","email":"sales@acmeplumbing.example","telephone":"+1 512 555 0199"}}
</script>
</head><body>Acme Plumbing — Austin TX. Call us.</body></html>`;

describe("page-structured", () => {
  it("extracts a JobPosting with employer, location, salary, date", () => {
    const facts = extractStructuredFacts(JOB_PAGE);
    expect(facts.jobs).toHaveLength(1);
    const job = facts.jobs[0];
    expect(job.title).toBe("Senior React Developer");
    expect(job.employer).toBe("Northwind Labs");
    expect(job.location).toBe("Toronto");
    expect(job.salary).toContain("110000");
    expect(job.salary).toContain("140000");
    expect(job.datePosted).toBe("2026-09-20");
  });

  it("extracts organization contacts + mailto/tel links", () => {
    const facts = extractStructuredFacts(
      ORG_PAGE + '<a href="mailto:info@acmeplumbing.example">mail</a><a href="tel:+15125550111">call</a>',
    );
    expect(facts.organizationName).toBe("Acme Plumbing");
    expect(facts.emails).toContain("help@acmeplumbing.example");
    expect(facts.emails).toContain("sales@acmeplumbing.example");
    expect(facts.emails).toContain("info@acmeplumbing.example");
    expect(facts.phones.some((p) => p.replace(/\s+/g, "").includes("5125550100"))).toBe(true);
    expect(facts.phones.some((p) => p.replace(/\s+/g, "").includes("5125550111"))).toBe(true);
  });

  it("never invents from malformed JSON-LD", () => {
    const facts = extractStructuredFacts('<script type="application/ld+json">{oops</script>');
    expect(facts.jobs).toHaveLength(0);
    expect(facts.organizationName).toBeNull();
  });

  it("parses a bare JSON-LD payload (browser extract field)", () => {
    const facts = factsFromJsonLdText(
      JSON.stringify({ "@type": "JobPosting", title: "ML Engineer", hiringOrganization: { name: "DeepCo" } }),
    );
    expect(facts.jobs).toHaveLength(1);
    expect(facts.jobs[0].title).toBe("ML Engineer");
    expect(facts.jobs[0].employer).toBe("DeepCo");
  });
});

describe("zeroResultsNarrative", () => {
  it("explains verification failure with counts", () => {
    const narrative = zeroResultsNarrative({
      rawCandidates: 42,
      postSpecFilter: 17,
      complete: 17,
      pendingEnrichment: 0,
      qualificationRejected: 17,
      returned: 0,
      reason: "FAILED_QUALIFICATION",
    });
    expect(narrative).toContain("17 candidates were checked");
  });

  it("explains incomplete research", () => {
    const narrative = zeroResultsNarrative({
      rawCandidates: 9,
      postSpecFilter: 9,
      complete: 0,
      pendingEnrichment: 9,
      qualificationRejected: 0,
      returned: 0,
      reason: "INCOMPLETE",
    });
    expect(narrative).toContain("9 candidates were found");
  });

  it("handles a true discovery zero", () => {
    expect(zeroResultsNarrative({ rawCandidates: 0, postSpecFilter: 0, complete: 0, pendingEnrichment: 0, qualificationRejected: 0, returned: 0, reason: "NO_DATA" })).toBeTruthy();
    expect(zeroResultsNarrative(null)).toBeNull();
  });
});

describe("enrichZeroNarrative", () => {
  it("tells the found-but-unproven story from the candidate ledger", () => {
    const narrative = enrichZeroNarrative("3 candidates were found, but none matched the requested criteria.", {
      counts: { rejected: 3, gated: 1 },
      streamedNotReturned: [
        { fate: "gated", reason: "SIGNAL_NOT_VERIFIED" },
        { fate: "rejected", reason: "UNPROVEN_CRITERION" },
        { fate: "rejected", reason: "MISSING_QUERY_REQUIRED" },
      ],
    });
    expect(narrative).toContain("3 candidates were found, but none matched the requested criteria.");
    expect(narrative).toContain("2 candidates looked promising but did not prove the requested details");
    expect(narrative).not.toContain("surfaced while researching");
  });

  it("counts a single unproven candidate in the singular", () => {
    const narrative = enrichZeroNarrative(null, {
      counts: {},
      streamedNotReturned: [{ fate: "gated", reason: "UNPROVEN_CRITERION" }],
    });
    expect(narrative).toContain("1 candidate looked promising but did not prove the requested details");
  });

  it("keeps the source-health sentence of the base narrative", () => {
    const base = zeroResultsNarrative({
      rawCandidates: 0, postSpecFilter: 0, complete: 0, pendingEnrichment: 0,
      qualificationRejected: 0, reason: "NO_DATA",
      sourceHealth: { summary: "2 sources were unreachable." },
    });
    const narrative = enrichZeroNarrative(base, { counts: {}, streamedNotReturned: [] });
    expect(narrative).toContain("2 sources were unreachable.");
    expect(narrative).toContain("returned no candidates for this query");
  });

  it("falls back to the verification story when only the ledger gate count stands", () => {
    expect(enrichZeroNarrative(null, { counts: { gated: 2 }, streamedNotReturned: [] }))
      .toContain("could not be verified with the sources available");
  });

  it("reports plain non-matches and degrades gracefully when nothing is known", () => {
    expect(enrichZeroNarrative(null, {
      counts: {},
      streamedNotReturned: [{ fate: "rejected", reason: "MISSING_QUERY_REQUIRED" }],
    })).toContain("1 candidate surfaced while researching but did not match your criteria.");
    expect(enrichZeroNarrative(null, null)).toBeNull();
    expect(enrichZeroNarrative(null, {})).toBeNull();
    expect(enrichZeroNarrative("Only the base.", null)).toBe("Only the base.");
  });
});
