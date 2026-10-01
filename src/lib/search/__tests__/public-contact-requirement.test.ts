import { describe, expect, it } from "vitest";
import { extractFrameDeterministic } from "@/lib/understanding/fallback";
import { validateFrame } from "@/lib/understanding/validate";
import { applyClarificationToFrame, frameToSearchSpec } from "@/lib/understanding/to-search-spec";
import { evaluateQualifiedLeadTheorem, queryRequiredFields } from "../canonical-contract";
import { computeResearchNeeds } from "../browser-research";
import { qualifyLead } from "../qualify";
import { makeEvidence } from "../evidence";
import type { SpecRow } from "@/lib/spec-search.functions";

const understand = (query: string) =>
  frameToSearchSpec(applyClarificationToFrame(validateFrame(extractFrameDeterministic(query)).frame, {}));

const founder = (overrides: Partial<SpecRow> = {}): SpecRow => {
  const id = "browser:amina";
  const excerpt = "Amina Carter\nFounder & CEO\nAcme";
  return {
    key: id, entity_id: id, entity_resolved: true, identity_confidence: 0.85, kind: "person", title: "Amina Carter",
    role: "Founder & CEO", company: "Acme", industry: "SaaS", detail: "Founder & CEO | Acme", source_url: "https://publisher.test/founders",
    website_url: "https://acme.test", page_type: "entity_page",
    evidence: [makeEvidence({ source_url: "https://publisher.test/founders", source_type: "web", evidence_type: "identity", supports: "identity", subject: id, excerpt, confidence: 0.85, extraction_method: "browser_observed_text", observed_at: new Date().toISOString(),
      claim_parameters: { role: "Founder & CEO", organization_name: "Acme", organization_entity_id: "company:acme", relationship: "founder", role_currentness: "current_role" } })],
    ...overrides,
  } as SpecRow;
};

const contactPage = {
  entity_id: "browser:amina", entity_resolved: true as const, entity_resolution: "resolved" as const,
  entity_type: "person", name: "Amina Carter", identity_confidence: 0.85, page_type: "entity_page" as const,
  fields: { contact_page_url: "https://acme.test/contact" },
};

describe("public contact details requirement", () => {
  it("turns 'public contact details' into the canonical contact requirement", () => {
    const spec = understand("B2B SaaS founders with public contact details");
    expect(spec.requested_fields).toContain("contact");
    expect(queryRequiredFields(spec)).toContain("contact");
  });

  it("is satisfied by an observed email or phone, never by a bare contact page URL", () => {
    const spec = understand("B2B SaaS founders with public contact details");
    const without = qualifyLead(founder(), spec, founder().evidence);
    expect(without.disposition).not.toBe("qualified");
    expect(without.reject_code).toBe("MISSING_QUERY_REQUIRED");
    for (const contact of [{ email: "amina@acme.test" }, { phone: "+1 416 555 0100" }]) {
      const row = founder(contact);
      expect(qualifyLead(row, spec, row.evidence).reject_code).not.toBe("MISSING_QUERY_REQUIRED");
    }
    // E2E-C5: a guessed /contact URL is not a contact channel. The old
    // contract accepted it; a bare URL must keep the lead unqualified.
    const guessed = founder({ contact_page_url: "https://acme.test/contact" });
    expect(qualifyLead(guessed, spec, guessed.evidence).reject_code).toBe("MISSING_QUERY_REQUIRED");
  });

  it("accepts a contact page only with verified provenance or real contact evidence", () => {
    const spec = understand("B2B SaaS founders with public contact details");
    const verified = evaluateQualifiedLeadTheorem({
      ...contactPage,
      field_provenance: { contact_page_url: { verification_status: "verified" } },
      evidence: [],
    }, spec);
    expect(verified.reject_code).not.toBe("MISSING_QUERY_REQUIRED");
    const discovered = evaluateQualifiedLeadTheorem({
      ...contactPage,
      field_provenance: { contact_page_url: { verification_status: "discovered" } },
      evidence: [],
    }, spec);
    expect(discovered.reject_code).toBe("MISSING_QUERY_REQUIRED");
    const viaEvidence = evaluateQualifiedLeadTheorem({
      ...contactPage,
      evidence: [makeEvidence({ source_url: "https://acme.test/contact", source_type: "web", evidence_type: "contact", supports: "other",
        subject: "browser:amina", excerpt: "Email hello@acme.test or call +1 416 555 0100", confidence: 0.85,
        extraction_method: "browser_observed_contact_page", observed_at: new Date().toISOString() })],
    }, spec);
    expect(viaEvidence.reject_code).not.toBe("MISSING_QUERY_REQUIRED");
  });

  it("keeps contact as a research need until a contact channel is observed", () => {
    const spec = understand("B2B SaaS founders with public contact details");
    const row = founder();
    expect(computeResearchNeeds(row, spec, qualifyLead(row, spec, row.evidence))).toContain("contact");
    // A bare or merely discovered contact page URL is not a channel yet.
    const guessed = founder({ contact_page_url: "https://acme.test/contact" });
    expect(computeResearchNeeds(guessed, spec, qualifyLead(guessed, spec, guessed.evidence))).toContain("contact");
    const verified = founder({
      contact_page_url: "https://acme.test/contact",
      field_provenance: { contact_page_url: { value: "https://acme.test/contact", source: "browser_observed_text", source_url: "https://acme.test/contact", observed_at: new Date().toISOString(), confidence: 0.85, verification_status: "verified" } },
    } as Partial<SpecRow>);
    expect(computeResearchNeeds(verified, spec, qualifyLead(verified, spec, verified.evidence))).not.toContain("contact");
  });

  it("does not add a contact requirement the user did not ask for", () => {
    expect(queryRequiredFields(understand("B2B SaaS founders in Toronto"))).not.toContain("contact");
  });
});
