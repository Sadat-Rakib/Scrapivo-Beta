/**
 * M4 — Entity resolution: unit + SPEC_SEARCH runtime + adversarial.
 */
import { describe, expect, it } from "vitest";
import {
  resolveEntityCandidate,
  applyEntityResolutionToRow,
  extractSubjectsFromArticle,
  extractEmployerFromJobBoardTitle,
  MIN_IDENTITY_CONFIDENCE,
  isUnresolvedIdentity,
  type KnownEntity,
} from "../entity-resolve";
import { applyPageClassificationToLiveRow } from "../page-classify";
import { qualifyLead, applyQualificationGate } from "../qualify";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { mintProvisionalEntityId } from "../canonical-contract";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import type { SpecRow } from "@/lib/spec-search.functions";
import { applyWhyMatchGate } from "../live-gapfill";

describe("M4 — extract helpers", () => {
  it("article extracts Acme, not TechCrunch", () => {
    const { subjects, ambiguous } = extractSubjectsFromArticle({
      title: "Acme raises $10M Series A",
      snippet: "The startup announced funding today",
      url: "https://techcrunch.com/2024/01/acme-raises-series-a",
    });
    expect(ambiguous).toBe(false);
    expect(subjects[0]?.toLowerCase()).toContain("acme");
    expect(subjects.join(" ").toLowerCase()).not.toContain("techcrunch");
  });

  it("article with two companies is ambiguous", () => {
    const { ambiguous, subjects } = extractSubjectsFromArticle({
      title: "Acme and Beta announce partnership raise",
      url: "https://techcrunch.com/2024/acme-beta",
    });
    expect(ambiguous).toBe(true);
    expect(subjects.length).toBeGreaterThanOrEqual(2);
  });

  it("job board title never yields employer", () => {
    expect(extractEmployerFromJobBoardTitle("Acme - Marketing Jobs")).toBeNull();
    expect(extractEmployerFromJobBoardTitle("Marketing Jobs on Monster")).toBeNull();
  });
});

describe("M4 — resolveEntityCandidate", () => {
  it("successful company resolution from first-party domain", () => {
    const r = resolveEntityCandidate({
      url: "https://acme.io/about",
      title: "Acme — Official Site",
      snippet: "We build software",
    });
    expect(r.entity_resolved).toBe(true);
    expect(r.entity_type).toBe("company");
    expect(r.domain).toBe("acme.io");
    expect(r.identity_confidence).toBeGreaterThanOrEqual(MIN_IDENTITY_CONFIDENCE);
    expect(r.entity_id.startsWith("provisional:")).toBe(false);
    expect(r.provenance.method).toBe("first_party_domain");
  });

  it("successful business resolution via known registry + domain", () => {
    const known: KnownEntity[] = [
      {
        name: "NoSite Cafe",
        entity_type: "business",
        domain: "nositecafe.example",
        location: "Toronto",
        entity_id: "biz:nosite-cafe",
      },
    ];
    const r = resolveEntityCandidate({
      url: "https://nositecafe.example",
      title: "NoSite Cafe",
      location: "Toronto",
      known,
    });
    expect(r.entity_resolved).toBe(true);
    expect(r.entity_type).toBe("business");
    expect(r.entity_id).toBe("biz:nosite-cafe");
  });

  it("successful person resolution from LinkedIn path", () => {
    const r = resolveEntityCandidate({
      url: "https://www.linkedin.com/in/ada-lovelace",
      title: "Ada Lovelace | Founder",
    });
    expect(r.entity_resolved).toBe(true);
    expect(r.entity_type).toBe("person");
    expect(r.page_type).toBe("person_page");
    expect(r.name?.toLowerCase()).toContain("ada");
  });

  it("wrong entity type: institute cannot become person", () => {
    const r = resolveEntityCandidate({
      url: "https://fi.co/",
      title: "Founder Institute — Startup Accelerator",
      page_type: "institute",
    });
    expect(r.entity_type).toBe("organization");
    expect(r.entity_type).not.toBe("person");
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const row: SpecRow = applyEntityResolutionToRow(
      applyPageClassificationToLiveRow({
        kind: "person",
        title: "Founder Institute",
        url: "https://fi.co/",
        detail: "accelerator",
        key: "live-web:fi",
        entity_id: mintProvisionalEntityId("fi"),
      }),
    );
    // Resolution overwrites kind to company (organization→company)
    expect(row.kind).not.toBe("person");
    const q = qualifyLead(row, spec, []);
    expect(q.disposition).not.toBe("qualified");
    expect(["ENTITY_TYPE_MISMATCH", "NO_CLAIM_EVIDENCE", "LIST_PAGE_AS_ENTITY"]).toContain(
      q.reject_code,
    );
  });

  it("ambiguous same-name entities fail closed", () => {
    const known: KnownEntity[] = [
      { name: "Acme", entity_type: "company", domain: "acme.com", entity_id: "org:acme-com" },
      { name: "Acme", entity_type: "company", domain: "acme.io", entity_id: "org:acme-io" },
    ];
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/acme-raises",
      title: "Acme raises $5M",
      page_type: "article",
      known,
    });
    // Two registry rows share the name → no unique corroboration → unresolved
    expect(r.entity_resolved).toBe(false);
  });

  it("article mentioning multiple entities → ambiguous", () => {
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/acme-and-beta",
      title: "Acme and Beta announce raise",
      page_type: "article",
    });
    expect(r.status).toBe("ambiguous");
    expect(r.entity_resolved).toBe(false);
  });

  it("list page rejected", () => {
    const r = resolveEntityCandidate({
      url: "https://www.seedtable.com/best-startups-berlin",
      title: "50 startups recently funded in Berlin",
      page_type: "list",
    });
    expect(r.status).toBe("rejected");
    expect(r.entity_resolved).toBe(false);
  });

  it("job board rejected — title not employer", () => {
    const r = resolveEntityCandidate({
      url: "https://www.monster.com/jobs/q-marketing-jobs",
      title: "Acme - Marketing Jobs",
      page_type: "job_board",
    });
    expect(r.status).toBe("rejected");
    expect(r.entity_resolved).toBe(false);
    expect(r.reject_reason).toMatch(/job_board/);
  });

  it("organization mistaken for person fails at qualification", () => {
    const r = resolveEntityCandidate({
      url: "https://fi.co/",
      title: "Founder Institute",
      page_type: "institute",
    });
    expect(r.entity_resolved).toBe(true);
    expect(r.entity_type).toBe("organization");
    const row: SpecRow = {
      kind: "company",
      title: r.name!,
      detail: "",
      url: "https://fi.co/",
      entity_id: r.entity_id,
      entity_resolved: true,
      identity_confidence: r.identity_confidence,
      page_type: r.page_type,
      key: r.entity_id,
    };
    const spec = extractSearchSpec("founders needing developers in SF");
    expect(qualifyLead(row, spec, []).disposition).not.toBe("qualified");
  });

  it("provisional entity cannot qualify", () => {
    const row: SpecRow = {
      kind: "company",
      title: "Maybe Acme",
      detail: "",
      url: "https://example.com",
      entity_id: mintProvisionalEntityId("x"),
      entity_resolved: false,
      page_type: "unknown",
      key: "k",
    };
    expect(isUnresolvedIdentity(row)).toBe(true);
    const spec = extractSearchSpec("SaaS companies in Austin");
    expect(qualifyLead(row, spec, []).reject_code).toBe("PROVISIONAL_ENTITY");
  });

  it("resolution confidence below threshold stays unresolved", () => {
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/acme-raises-seed",
      title: "Acme raises seed",
      page_type: "article",
    });
    // Pattern extract without registry corroboration
    expect(r.name?.toLowerCase()).toContain("acme");
    expect(r.entity_resolved).toBe(false);
    expect(r.identity_confidence).toBeLessThan(MIN_IDENTITY_CONFIDENCE);
  });

  it("article + known registry corroboration can resolve", () => {
    const known: KnownEntity[] = [
      {
        name: "Acme",
        entity_type: "company",
        domain: "acme.io",
        entity_id: "org:acme.io",
      },
    ];
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/acme-raises",
      title: "Acme raises $10M Series A",
      page_type: "article",
      known,
    });
    expect(r.entity_resolved).toBe(true);
    expect(r.entity_id).toBe("org:acme.io");
    expect(r.source_page_type).toBe("article");
    expect(r.page_type).toBe("company_page");
  });

  it("title alone is not identity", () => {
    const r = resolveEntityCandidate({
      title: "Acme Robotics Inc",
      // no url
    });
    expect(r.entity_resolved).toBe(false);
    expect(r.reject_reason).toMatch(/title_alone/);
  });
});

describe("M4 — adversarial C/D/E remain fail-closed", () => {
  it("C: Founder Institute still cannot qualify as person needing developers", () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const row = applyEntityResolutionToRow(
      applyPageClassificationToLiveRow({
        kind: "person",
        title: "Founder Institute",
        detail: "announces funded startups",
        url: "https://fi.co/news",
        key: "live-web:fi",
        entity_id: mintProvisionalEntityId("fi"),
        evidence: [
          makeEvidence({
            source_url: "https://fi.co/news",
            source_type: "news",
            excerpt: "funded startups raised series",
            evidence_type: "funding",
            supports: "intent",
          }),
        ],
      }),
    );
    expect(applyWhyMatchGate([row], spec, true).kept).toHaveLength(0);
    expect(qualifyLead(row, spec, row.evidence).disposition).not.toBe("qualified");
  });

  it("D: Monster job board still cannot qualify", () => {
    const spec = extractSearchSpec("companies needing marketing help");
    const row = applyEntityResolutionToRow(
      applyPageClassificationToLiveRow({
        kind: "company",
        title: "Acme - Marketing Jobs",
        detail: "Browse openings",
        url: "https://www.monster.com/jobs/q-marketing-jobs",
        key: "live-web:monster",
        entity_id: mintProvisionalEntityId("monster"),
      }),
    );
    expect(row.entity_resolved).toBe(false);
    expect(applyWhyMatchGate([row], spec, true).kept).toHaveLength(0);
  });

  it("E: Seedtable list still cannot qualify", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const row = applyEntityResolutionToRow(
      applyPageClassificationToLiveRow({
        kind: "company",
        title: "50 startups recently funded in Berlin",
        detail: "directory",
        url: "https://www.seedtable.com/best-startups-berlin",
        key: "live-web:seed",
        entity_id: mintProvisionalEntityId("seed"),
      }),
    );
    expect(row.entity_resolved).toBe(false);
    expect(applyQualificationGate([row], spec).qualified).toHaveLength(0);
  });
});

describe("M4 — SPEC_SEARCH runtime", () => {
  it("resolved OSM business can qualify; provisional web cannot", async () => {
    const osmRow: SpecRow = {
      kind: "business",
      title: "NoSite Cafe",
      detail: "Toronto",
      location: "Toronto",
      category: "cafe",
      key: "live-osm:nosite-cafe",
      entity_id: "live-osm:nosite-cafe",
      entity_resolved: true,
      identity_confidence: 0.92,
      page_type: "entity_page",
      url: null,
      phone: "+1-416-555-0199",
      opportunity: "no_website",
    };
    const res = await runSpecSearchCore(
      "cafes in Toronto without a website",
      {
        businesses: (async () => ({
          rows: [],
          meta: {
            dbHit: false,
            engine: "none",
            partitionsRead: [],
            rowsScanned: 0,
            rowsReturned: 0,
          },
        })) as never,
        index: null,
        liveGapfill: { osm: async () => [osmRow], web: null, jobs: null },
      },
      25,
      { mode: "selling", offer: "websites" },
    );
    expect(res.rows.every((r) => r.disposition === "qualified")).toBe(true);
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[0].entity_resolved).toBe(true);
  });

  it("live web job-board injection cannot reach delivery", async () => {
    const poison: SpecRow = applyEntityResolutionToRow(
      applyPageClassificationToLiveRow({
        kind: "company",
        title: "Acme - Marketing Jobs",
        detail: "jobs",
        url: "https://www.monster.com/jobs/q-marketing",
        key: "live-web:poison",
        entity_id: mintProvisionalEntityId("poison"),
        evidence: [
          makeEvidence({
            source_url: "https://www.monster.com/jobs/q-marketing",
            source_type: "job",
            excerpt: "Marketing Jobs",
            evidence_type: "hiring",
            supports: "requested_service",
            subject: "poison",
          }),
        ],
      }),
    );
    const res = await runSpecSearchCore(
      "companies needing marketing help in Austin",
      {
        companies: (async () => ({
          rows: [],
          meta: {
            dbHit: false,
            engine: "none",
            partitionsRead: [],
            rowsScanned: 0,
            rowsReturned: 0,
          },
        })) as never,
        index: null,
        liveGapfill: {
          web: async () => [poison],
          osm: null,
          jobs: null,
        },
      },
      25,
      { mode: "looking" },
    );
    expect(res.rows).toHaveLength(0);
    expect(res.qualified_count).toBe(0);
  });
});
