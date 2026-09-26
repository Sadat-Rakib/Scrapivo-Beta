/**
 * Milestone 1 — QualifiedLead theorem adversarial battery (audit C / D / E).
 *
 * Goal: invalid leads cannot pass qualification.
 * Displayed count dropping is progress.
 */
import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { qualifyLead } from "../qualify";
import {
  evaluateQualifiedLeadTheorem,
  queryRequiredFields,
  requestedClaimTypes,
  resolveFinalOutcome,
  type TheoremCandidate,
} from "../canonical-contract";
import type { SpecRow } from "@/lib/spec-search.functions";

describe("Milestone 1 — QualifiedLead theorem", () => {
  describe("field tiers / query-required", () => {
    it("salary is not query-required for React jobs in Toronto", () => {
      const spec = extractSearchSpec("React jobs in Toronto");
      expect(queryRequiredFields(spec)).not.toContain("salary");
    });

    it("salary is query-required when paying $150k+", () => {
      const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
      expect(queryRequiredFields(spec)).toContain("salary");
      const cand: TheoremCandidate = {
        entity_id: "job:1",
        entity_resolved: true,
        entity_type: "job",
        name: "Senior React Dev",
        source_url: "https://jobs.example/1",
        page_type: "job_posting",
        fields: { employer: "Acme", location: "Toronto" },
        evidence: [],
      };
      // Jobs without signal_required may still need salary when Spec demands it.
      const r = evaluateQualifiedLeadTheorem(cand, {
        ...spec,
        entity: "job",
        signal_required: false,
      });
      expect(r.ok).toBe(false);
      expect(r.reject_code).toBe("MISSING_QUERY_REQUIRED");
      expect(r.missing_query_required).toContain("salary");
    });

    it("provisional entity_id cannot qualify", () => {
      const spec = extractSearchSpec("restaurants in Toronto");
      const r = evaluateQualifiedLeadTheorem(
        {
          entity_id: "provisional:serp:1",
          entity_resolved: true,
          entity_type: "business",
          name: "Some Cafe",
          page_type: "entity_page",
          fields: { location: "Toronto" },
        },
        { ...spec, signal_required: false },
      );
      expect(r.ok).toBe(false);
      expect(r.reject_code).toBe("PROVISIONAL_ENTITY");
    });
  });

  describe("outcome precedence", () => {
    it("NO_QUALIFIED_RESULTS wins over SOURCE_UNAVAILABLE diagnostics", () => {
      expect(
        resolveFinalOutcome(["SOURCE_UNAVAILABLE", "NO_QUALIFIED_RESULTS"]),
      ).toBe("NO_QUALIFIED_RESULTS");
    });

    it("SEARCH_CANCELLED beats everything", () => {
      expect(
        resolveFinalOutcome([
          "SEARCH_CANCELLED",
          "SEARCH_FAILED",
          "NO_QUALIFIED_RESULTS",
        ]),
      ).toBe("SEARCH_CANCELLED");
    });
  });

  describe("C — funding must not qualify developer need", () => {
    it("Founder Institute + funding evidence → CLAIM_TYPE_MISMATCH", () => {
      const spec = extractSearchSpec("founders needing developers in San Francisco");
      expect(spec.signal_required).toBe(true);
      expect(requestedClaimTypes(spec)).not.toContain("funding");

      const entity_id = "org:founder-institute";
      const ev = [
        makeEvidence({
          source_url: "https://fi.co/news",
          source_type: "news",
          excerpt: "Founder Institute announces funded startups",
          evidence_type: "funding",
          supports: "intent",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "person",
        title: "Founder Institute",
        detail: "San Francisco",
        location: "San Francisco",
        url: "https://fi.co",
        entity_id,
        entity_resolved: true,
        page_type: "institute",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).not.toBe("qualified");
      // institute page-type is a source, not a person lead
      expect(q.reject_code).toBe("LIST_PAGE_AS_ENTITY");
    });

    it("funding claim on company page still CLAIM_TYPE_MISMATCH for developer need", () => {
      const spec = extractSearchSpec("companies needing developers in Austin");
      const entity_id = "company:acme";
      const ev = [
        makeEvidence({
          source_url: "https://techcrunch.example/acme-raises",
          source_type: "news",
          excerpt: "Acme raises Series A",
          evidence_type: "funding",
          supports: "intent",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Acme Inc",
        detail: "Austin",
        location: "Austin",
        url: "https://acme.example",
        entity_id,
        entity_resolved: true,
        page_type: "company_page",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).not.toBe("qualified");
      expect(q.reject_code).toBe("CLAIM_TYPE_MISMATCH");
    });
  });

  describe("D — job board ≠ company needing marketing", () => {
    it("Monster marketing jobs list → LIST_PAGE_AS_ENTITY or CLAIM_NOT_SUBJECT_BOUND", () => {
      const spec = extractSearchSpec("companies needing marketing help");
      const entity_id = "source:monster-marketing-jobs";
      const ev = [
        makeEvidence({
          source_url: "https://monster.example/marketing-jobs",
          source_type: "job",
          excerpt: "Marketing Jobs — browse openings",
          evidence_type: "hiring",
          supports: "requested_service",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Marketing Jobs on Monster",
        detail: "",
        url: "https://monster.example/marketing-jobs",
        entity_id,
        entity_resolved: true,
        page_type: "job_board",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).not.toBe("qualified");
      expect(q.reject_code).toBe("LIST_PAGE_AS_ENTITY");
    });

    it("hiring evidence about Monster does not prove an employer needs marketing", () => {
      const spec = extractSearchSpec("companies needing marketing help");
      // Evidence subject is the board, candidate claims to be Acme — unbound.
      const ev = [
        makeEvidence({
          source_url: "https://monster.example/marketing-jobs",
          source_type: "job",
          excerpt: "Marketing Jobs",
          evidence_type: "service_request",
          supports: "requested_service",
          subject: "source:monster",
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Acme",
        detail: "",
        url: "https://acme.example",
        entity_id: "company:acme",
        entity_resolved: true,
        page_type: "company_page",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).not.toBe("qualified");
      expect(q.reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
    });
  });

  describe("E — list/directory ≠ funded startup", () => {
    it("Seedtable list page → LIST_PAGE_AS_ENTITY", () => {
      const spec = extractSearchSpec("recently funded startups in Berlin");
      const entity_id = "list:seedtable-berlin";
      const ev = [
        makeEvidence({
          source_url: "https://seedtable.example/berlin",
          source_type: "web",
          excerpt: "50 startups recently funded in Berlin",
          evidence_type: "funding",
          supports: "intent",
          subject: entity_id,
          event_at: new Date().toISOString(),
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Seedtable — Berlin Startups",
        detail: "Berlin",
        location: "Berlin",
        url: "https://seedtable.example/berlin",
        entity_id,
        entity_resolved: true,
        page_type: "list",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).not.toBe("qualified");
      expect(q.reject_code).toBe("LIST_PAGE_AS_ENTITY");
    });

    it("list-page funding text does not subject-bind to a named startup on the list", () => {
      const spec = extractSearchSpec("recently funded startups in Berlin");
      const listEv = [
        makeEvidence({
          source_url: "https://seedtable.example/berlin",
          source_type: "web",
          excerpt: "50 startups recently funded…",
          evidence_type: "funding",
          supports: "intent",
          // Bound to the list host, not the startup
          subject: "list:seedtable",
          event_at: new Date().toISOString(),
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "NeonFlow",
        detail: "Berlin",
        location: "Berlin",
        url: "https://neonflow.example",
        entity_id: "company:neonflow",
        entity_resolved: true,
        page_type: "company_page",
        evidence: listEv,
      };
      const q = qualifyLead(row, spec, listEv);
      expect(q.disposition).not.toBe("qualified");
      expect(q.reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
    });
  });

  describe("happy path still qualifies when theorem holds", () => {
    it("resolved company + subject-bound hiring evidence qualifies", () => {
      const spec = extractSearchSpec("companies hiring copywriters in Toronto");
      const entity_id = "company:acme-copy";
      const ev = [
        makeEvidence({
          source_url: "https://acme.example/careers",
          source_type: "job",
          excerpt: "We're hiring copywriters in Toronto",
          evidence_type: "hiring",
          supports: "requested_role",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Acme",
        detail: "Toronto",
        location: "Toronto",
        url: "https://acme.example",
        entity_id,
        entity_resolved: true,
        page_type: "company_page",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).toBe("qualified");
      expect(q.reject_code).toBeUndefined();
    });
  });
});
