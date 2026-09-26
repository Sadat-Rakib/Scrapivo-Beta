/**
 * Phase 1 acceptance Tests 1–10 (§L1.11).
 * Must pass for Phase 1 DONE — independent of the 43/43 soft battery.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { extractNeedPhrase } from "../need-phrase";
import {
  makeEvidence,
  structuralNoWebsiteEvidence,
  whyMatchFromEvidence,
  hasQualifyingEvidence,
} from "../evidence";
import { applyQualificationGate, qualifyLead, scoreIntent, scoreRelevance } from "../qualify";
import { applyWhyMatchGate, evidenceFromWebHit, deriveWhyMatch } from "../live-gapfill";
import {
  isVerifiedForPersist,
  stampVerified,
} from "@/lib/canonical/persist-live.server";
import {
  redditSocialProvider,
  socialHitsToSpecRows,
  socialQueryFromSpec,
} from "../social-signal";
import {
  clearProviderLogs,
  shouldSkipPaidSerp,
  logProviderUse,
  recentProviderLogs,
} from "../provider-ladder";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchSpec } from "../search-spec";

function field(spec: SearchSpec, f: string) {
  return spec.criteria.find((c) => c.field === f)?.value ?? null;
}

describe("Phase 1 acceptance (§L1.11)", () => {
  beforeEach(() => clearProviderLogs());

  describe("Test 1 — plural signals", () => {
    const cases = [
      "restaurants needing websites",
      "founders needing developers",
      "companies needing marketers",
      "people looking for copywriters",
    ];
    for (const q of cases) {
      it(`detects signal for: ${q}`, () => {
        const need = extractNeedPhrase(q);
        const spec = extractSearchSpec(q);
        expect(need.isSignal).toBe(true);
        expect(spec.signal_required).toBe(true);
        expect(spec.entity).not.toBe("unknown");
      });
    }
    it("restaurants needing websites → opportunity no_website", () => {
      const spec = extractSearchSpec("restaurants needing websites");
      expect(field(spec, "opportunity")).toBe("no_website");
      expect(field(spec, "requested_product")).toMatch(/website/i);
    });
    it("founders needing developers → requested_role developer", () => {
      const spec = extractSearchSpec("founders needing developers");
      expect(field(spec, "requested_role")).toMatch(/developer/i);
      expect(spec.entity).toBe("person");
    });
  });

  describe("Test 2 — semantic direction (no industry=marketing)", () => {
    it("companies needing marketing does not set identity industry marketing", () => {
      const spec = extractSearchSpec("companies needing marketing help");
      expect(spec.signal_required).toBe(true);
      expect(field(spec, "requested_service")).toMatch(/marketing/i);
      expect(field(spec, "industry")).not.toBe("marketing");
      expect(field(spec, "industry")?.toLowerCase()).not.toBe("marketing");
    });
  });

  describe("Test 3 — directory contamination gate", () => {
    it("signal_required + no evidence → not qualified", () => {
      const spec = extractSearchSpec("founders needing developers in SF");
      expect(spec.signal_required).toBe(true);
      const row: SpecRow = {
        kind: "person",
        title: "Jane Founder",
        detail: "San Francisco",
        location: "San Francisco",
        url: "https://example.com/jane",
      };
      const q = qualifyLead(row, spec, []);
      expect(q.disposition).not.toBe("qualified");
      const gated = applyWhyMatchGate([row], spec, true);
      expect(gated.kept).toHaveLength(0);
      expect(gated.dropped).toBeGreaterThan(0);
    });
  });

  describe("Test 4 — evidence schema", () => {
    it("qualified signal lead requires claim evidence", () => {
      const ev = [
        makeEvidence({
          source_url: "https://jobs.example.com/copywriter",
          source_type: "web",
          excerpt: "We're hiring a copywriter",
          evidence_type: "hiring",
          supports: "requested_role",
          extraction_method: "searxng_snippet",
        }),
      ];
      expect(hasQualifyingEvidence(ev)).toBe(true);
      expect(ev[0].observed_at).toBeTruthy();
      expect(ev[0].evidence_type).toBe("hiring");
    });
    it("SERP-empty does not invent no_website", () => {
      const structural = structuralNoWebsiteEvidence({
        source_url: "osm:live-osm:cafe-1",
        source_type: "osm",
        extraction_method: "osm_tags",
        observation: "OSM place matched; no website tag",
      });
      expect(structural.extraction_method).toBe("osm_tags");
      expect(structural.evidence_type).toBe("no_website");
      // Empty SERP must not create opportunity evidence:
      const fromEmpty = evidenceFromWebHit({
        title: "Random cafe",
        snippet: "Best coffee downtown",
        url: "https://news.example.com/cafe",
        spec: extractSearchSpec("restaurants needing websites"),
      });
      expect(fromEmpty.some((e) => e.evidence_type === "no_website")).toBe(false);
    });
  });

  describe("Test 5 — why-match from evidence", () => {
    it("references excerpt, not host-only template under signal", () => {
      const spec = extractSearchSpec("companies hiring copywriters");
      const ev = [
        makeEvidence({
          source_url: "https://acme.example/careers",
          source_type: "web",
          excerpt: "Hiring copywriters for growth team",
          evidence_type: "hiring",
          supports: "requested_role",
        }),
      ];
      const why = whyMatchFromEvidence(ev);
      expect(why).toMatch(/Hiring|copywriter/i);
      const row: SpecRow = {
        kind: "company",
        title: "Acme",
        detail: "",
        url: "https://acme.example",
        evidence: ev,
      };
      expect(deriveWhyMatch(row, spec)).toMatch(/Hiring|copywriter/i);
      // Bare host template forbidden when signal_required without evidence:
      expect(
        deriveWhyMatch(
          { kind: "company", title: "Acme", detail: "", url: "https://acme.example" },
          spec,
        ),
      ).toBeNull();
    });
  });

  describe("Test 6 — VERIFIED persist gate", () => {
    it("name+url alone is not VERIFIED", () => {
      const row: SpecRow = {
        kind: "company",
        title: "Acme Corp",
        detail: "",
        url: "https://acme.example",
        key: "live-web:acme.example",
      };
      expect(isVerifiedForPersist(row)).toBe(false);
    });
    it("identity + claim evidence → VERIFIED stamp eligible", () => {
      const entity_id = "live-web:acme.example";
      const row: SpecRow = {
        kind: "company",
        title: "Acme Corp",
        detail: "",
        url: "https://acme.example/careers",
        key: entity_id,
        entity_id,
        entity_resolved: true,
        page_type: "company_page",
        disposition: "qualified",
        evidence: [
          makeEvidence({
            source_url: "https://acme.example/careers",
            source_type: "web",
            excerpt: "Now hiring copywriters",
            evidence_type: "hiring",
            supports: "requested_role",
            subject: entity_id,
          }),
        ],
      };
      expect(isVerifiedForPersist(row)).toBe(true);
      expect(stampVerified([row])[0].verification_status).toBe("verified");
    });
    it("theorem-unqualified cannot persist as verified", () => {
      const row: SpecRow = {
        kind: "company",
        title: "Acme Corp",
        detail: "",
        url: "https://acme.example/careers",
        key: "live-web:acme.example",
        entity_id: "provisional:x",
        entity_resolved: false,
        disposition: "potential_match",
        evidence: [
          makeEvidence({
            source_url: "https://acme.example/careers",
            source_type: "web",
            excerpt: "funded",
            evidence_type: "funding",
            supports: "intent",
          }),
        ],
      };
      expect(isVerifiedForPersist(row)).toBe(false);
      expect(stampVerified([row])[0].verification_status).not.toBe("verified");
    });
  });

  describe("Test 7 — social provider capability on SPEC", () => {
    it("exposes provider-agnostic interface + Reddit provider id", () => {
      expect(redditSocialProvider.id).toBe("reddit-arctic-shift");
      expect(typeof redditSocialProvider.search).toBe("function");
    });
    it("maps social hits → evidence → lead rows (E2E shape)", () => {
      const spec = extractSearchSpec("people looking for copywriters");
      expect(spec.signal_required).toBe(true);
      const q = socialQueryFromSpec(spec);
      expect(q.toLowerCase()).toMatch(/copywriter|looking|need|help/);
      const rows = socialHitsToSpecRows(
        [
          {
            title: "Looking for a freelance copywriter",
            url: "https://reddit.com/r/forhire/comments/abc",
            excerpt: "Need a copywriter for landing pages ASAP",
            subreddit: "forhire",
            author: "seeker1",
            // event_at must be the post time — crawl date is not a substitute.
            created_utc: Math.floor(Date.now() / 1000) - 3600,
          },
        ],
        spec,
        {
          // M14: platform handle ≠ real-world person; resolve explicitly.
          resolveAuthor: (platformId) =>
            platformId.includes("seeker1") ? "person:seeker1" : null,
        },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].evidence?.[0].evidence_type).toBe("social_ask");
      expect(rows[0].evidence?.[0].source_url).toContain("reddit.com");
      expect(rows[0].entity_id).toBe("person:seeker1");
      expect(rows[0].entity_resolved).toBe(true);
      const gated = applyQualificationGate(rows, spec);
      expect(gated.qualified.length).toBe(1);
      expect(gated.qualified[0].why_match).toMatch(/Social ask|copywriter|Need/i);
    });
  });

  describe("Test 8 — funding / startup path", () => {
    it("recently funded startups in Berlin is company + funding signal", () => {
      const spec = extractSearchSpec("recently funded startups in Berlin");
      expect(spec.entity).toBe("company");
      expect(spec.signal_required).toBe(true);
      expect(field(spec, "funding_status")).toBe("recent");
      expect(field(spec, "location")?.toLowerCase()).toContain("berlin");
      expect(spec.signal_types).toEqual(expect.arrayContaining(["funding"]));
    });
  });

  describe("Test 9 — relevance vs intent vs why_match", () => {
    it("exposes separate scores on qualified output", () => {
      const spec = extractSearchSpec("companies hiring copywriters in Toronto");
      const entity_id = "company:toronto-co";
      const ev = [
        makeEvidence({
          source_url: "https://co.example/jobs",
          source_type: "job",
          excerpt: "Hiring copywriters — Toronto",
          evidence_type: "hiring",
          supports: "requested_role",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Toronto Co",
        detail: "Toronto",
        location: "Toronto",
        url: "https://co.example",
        key: entity_id,
        entity_id,
        entity_resolved: true,
        page_type: "company_page",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).toBe("qualified");
      expect(typeof q.relevance_score).toBe("number");
      expect(typeof q.intent_score).toBe("number");
      expect(q.why_match).toBeTruthy();
      expect(scoreRelevance(row, spec)).toBeGreaterThan(0.4);
      expect(scoreIntent(ev)).toBeGreaterThan(scoreIntent([]));
      // High relevance + weak intent is valid potential_match shape:
      const weak = qualifyLead(row, spec, []);
      expect(weak.disposition).toBe("potential_match");
      expect(weak.relevance_score).toBeGreaterThan(0);
      expect(weak.intent_score).toBeLessThan(0.5);
    });
  });

  describe("Test 10 — free-first / no parallel paid SERP", () => {
    it("skips paid when free discovery already sufficient", () => {
      const gate = shouldSkipPaidSerp({ freeResultCount: 5, sufficientAt: 3 });
      expect(gate.skip).toBe(true);
      expect(gate.reason).toMatch(/free_discovery_sufficient/);
      logProviderUse({
        provider_used: "searxng",
        fallback_reason: null,
        cost_class: "self_hosted",
        operation: "live-web-discovery",
        success: true,
        result_count: 5,
      });
      logProviderUse({
        provider_used: "paid-serp-skipped",
        fallback_reason: gate.reason,
        cost_class: "paid",
        operation: "live-web-discovery",
        success: false,
        result_count: 0,
      });
      const logs = recentProviderLogs();
      expect(logs.some((l) => l.provider_used === "searxng" && l.cost_class === "self_hosted")).toBe(
        true,
      );
      expect(logs.some((l) => l.provider_used === "paid-serp-skipped")).toBe(true);
      expect(
        logs.every(
          (l) =>
            !(l.cost_class === "paid" && l.success && l.provider_used.includes("serp")),
        ),
      ).toBe(true);
    });
    it("allows paid only with explicit free_insufficient reason", () => {
      const gate = shouldSkipPaidSerp({ freeResultCount: 0, sufficientAt: 3 });
      expect(gate.skip).toBe(false);
      expect(gate.reason).toMatch(/free_insufficient/);
    });
  });
});
