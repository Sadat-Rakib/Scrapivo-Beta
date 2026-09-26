/**
 * M15 — Coverage + randomized / adversarial E2E (M5→M14).
 *
 * Status target: TESTED (not VERIFIED). No new product features.
 * Deliberately tries to break the spine: Spec → geo → plan → verify →
 * enrich → qualify → persist → view. Prefer 0 correct QualifiedLeads over N false.
 *
 * Coverage denominators per stage: Supported | Attempted | Covered | Unknown.
 */
import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { resolveCanonicalLocation } from "../location-resolver";
import { buildSourcePlan } from "../source-plan";
import { makeEvidence, type Evidence } from "../evidence";
import { qualifyLead, applyQualificationGate } from "../qualify";
import {
  evaluateTemporalValidity,
  verifyCandidateClaims,
} from "../verification";
import { projectQualifiedLead } from "../qualified-lead";
import { projectSpecRowsToQualifiedViews } from "../qualified-lead-view";
import { createSearchRun } from "../search-run";
import { detectSocialNeed } from "../social-need";
import {
  socialArtifactToSpecRow,
  type SocialHitsToRowsOptions,
} from "../social-signal";
import type { SocialArtifact } from "../social-artifact";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchSpec } from "../search-spec";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

type StageStatus = "Supported" | "Attempted" | "Covered" | "Unknown";

type StageName =
  | "understand"
  | "location"
  | "source_plan"
  | "verify"
  | "qualify"
  | "persist"
  | "deliver";

type CoverageRow = Record<StageName, StageStatus>;

function field(spec: SearchSpec, f: string): string | null {
  return spec.criteria.find((c) => c.field === f)?.value?.trim() || null;
}

function companyRow(
  partial: Partial<SpecRow> & { entity_id: string; title: string },
): SpecRow {
  return {
    kind: "company",
    detail: partial.detail ?? "",
    location: partial.location ?? "Berlin",
    url: partial.url ?? "https://acme.example",
    entity_resolved: true,
    page_type: "company_page",
    identity_confidence: 0.9,
    evidence: [],
    ...partial,
  };
}

function personRow(
  partial: Partial<SpecRow> & { entity_id: string; title: string },
): SpecRow {
  return {
    kind: "person",
    detail: partial.detail ?? "",
    location: partial.location ?? "Toronto",
    url: partial.url ?? "https://linkedin.com/in/x",
    entity_resolved: true,
    page_type: "person_page",
    identity_confidence: 0.9,
    evidence: [],
    ...partial,
  };
}

function fundingEv(subject: string, eventAt: string): Evidence {
  return makeEvidence({
    source_url: "https://news.example/funding",
    source_type: "news",
    excerpt: "raised a Series A",
    evidence_type: "funding",
    supports: "funding_status",
    subject,
    event_at: eventAt,
    observed_at: new Date(NOW).toISOString(),
    claim_parameters: { funding_stage: "series_a" },
  } as Evidence & { claim_parameters: Record<string, string> });
}

function hiringEv(subject: string): Evidence {
  return makeEvidence({
    source_url: "https://acme.example/careers",
    source_type: "job",
    excerpt: "We're hiring copywriters",
    evidence_type: "hiring",
    supports: "requested_role",
    subject,
    event_at: new Date(NOW - 86400000).toISOString(),
    claim_parameters: { role: "copywriter" },
  } as Evidence & { claim_parameters: Record<string, string> });
}

function employmentEv(personId: string, orgId: string): Evidence {
  return makeEvidence({
    source_url: "https://acme.example/about",
    source_type: "company",
    excerpt: "Founder at Acme",
    evidence_type: "identity",
    supports: "identity",
    subject: personId,
    claim_parameters: {
      role: "founder",
      relationship: "founder",
      organization_entity_id: orgId,
      organization_name: "Acme",
      role_currentness: "current_role",
    },
  } as Evidence & { claim_parameters: Record<string, string> });
}

function needEv(personId: string): Evidence {
  return makeEvidence({
    source_url: "https://x.com/ada/status/1",
    source_type: "social",
    excerpt: "looking for a developer",
    evidence_type: "social_ask",
    supports: "requested_role",
    subject: personId,
    event_at: new Date(NOW - 86400000).toISOString(),
    claim_parameters: { role: "developer", is_ask: "true" },
  } as Evidence & { claim_parameters: Record<string, string> });
}

/** Score one query class through the spine with a hand-built candidate. */
function scorePipeline(args: {
  query: string;
  row: SpecRow;
  evidence: Evidence[];
  expectQualified: boolean;
}): CoverageRow {
  const spec = extractSearchSpec(args.query);
  const understand: StageStatus =
    spec.status === "ready_to_search" || spec.entity !== "unknown"
      ? "Covered"
      : "Attempted";

  const wantLoc = field(spec, "location");
  let location: StageStatus = "Supported";
  if (wantLoc) {
    const geo = resolveCanonicalLocation(wantLoc);
    location =
      geo && geo.resolution === "resolved"
        ? args.row.location &&
          resolveCanonicalLocation(args.row.location)
          ? "Covered"
          : "Attempted"
        : "Unknown";
  }

  const plan = buildSourcePlan(spec);
  const source_plan: StageStatus =
    plan.steps.length > 0 ? "Covered" : "Attempted";

  const verified = verifyCandidateClaims({
    evidence: args.evidence,
    entityId: args.row.entity_id!,
    spec,
    nowMs: NOW,
  });
  const verify: StageStatus = verified.ok
    ? "Covered"
    : spec.signal_required
      ? "Attempted"
      : "Supported";

  const q = qualifyLead(args.row, spec, args.evidence);
  const qualify: StageStatus =
    q.disposition === "qualified"
      ? "Covered"
      : args.expectQualified
        ? "Attempted"
        : "Covered"; // correctly refused

  const run = createSearchRun();
  const projected = projectQualifiedLead({
    row: {
      ...args.row,
      disposition: q.disposition,
      evidence: args.evidence,
    },
    spec,
    run,
    nowMs: NOW,
  });
  const persist: StageStatus =
    q.disposition === "qualified"
      ? projected.ok
        ? "Covered"
        : "Attempted"
      : "Supported";

  const views = projectSpecRowsToQualifiedViews({
    rows: [
      {
        ...args.row,
        disposition: q.disposition,
        evidence: args.evidence,
        why_match: q.why_match,
      },
    ],
    spec,
    run,
    nowMs: NOW,
  });
  const deliver: StageStatus =
    args.expectQualified && q.disposition === "qualified"
      ? views.qualified_count === 1
        ? "Covered"
        : "Attempted"
      : views.qualified_count === 0
        ? "Covered"
        : "Attempted";

  // Hard law: false positive is never Covered on deliver.
  if (!args.expectQualified && views.qualified_count > 0) {
    return {
      understand,
      location,
      source_plan,
      verify,
      qualify: "Attempted",
      persist: "Attempted",
      deliver: "Attempted",
    };
  }

  return {
    understand,
    location,
    source_plan,
    verify,
    qualify,
    persist,
    deliver,
  };
}

describe("M15 — coverage matrix (stage denominators)", () => {
  it("recently funded startups in Berlin — happy path Covered across stages", () => {
    const entity_id = "company:berlin-funded";
    const ev = [
      fundingEv(entity_id, new Date(NOW - 30 * 86400000).toISOString()),
    ];
    const row = companyRow({
      entity_id,
      title: "Berlin Funded Co",
      location: "Berlin",
      evidence: ev,
    });
    const cov = scorePipeline({
      query: "recently funded startups in Berlin",
      row,
      evidence: ev,
      expectQualified: true,
    });
    expect(cov.understand).toBe("Covered");
    expect(cov.location).toBe("Covered");
    expect(cov.source_plan).toBe("Covered");
    expect(cov.verify).toBe("Covered");
    expect(cov.qualify).toBe("Covered");
    expect(cov.persist).toBe("Covered");
    expect(cov.deliver).toBe("Covered");
  });

  it("founders needing developers in SF — person path Covered", () => {
    const personId = "person:ada";
    const ev = [employmentEv(personId, "company:acme"), needEv(personId)];
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "San Francisco",
      detail: "Acme",
      evidence: ev,
    });
    const cov = scorePipeline({
      query: "founders needing developers in SF",
      row,
      evidence: ev,
      expectQualified: true,
    });
    expect(cov.understand).toBe("Covered");
    expect(cov.qualify).toBe("Covered");
    expect(cov.deliver).toBe("Covered");
  });

  it("coverage tallies Supported/Attempted/Covered/Unknown only", () => {
    const allowed = new Set([
      "Supported",
      "Attempted",
      "Covered",
      "Unknown",
    ]);
    const entity_id = "company:x";
    const ev = [hiringEv(entity_id)];
    const cov = scorePipeline({
      query: "companies hiring copywriters in Toronto",
      row: companyRow({
        entity_id,
        title: "X",
        location: "Toronto",
        evidence: ev,
      }),
      evidence: ev,
      expectQualified: true,
    });
    for (const v of Object.values(cov)) {
      expect(allowed.has(v)).toBe(true);
    }
  });
});

describe("M15 — adversarial pairs (zero false-positive qualified)", () => {
  const cases: Array<{
    name: string;
    query: string;
    row: SpecRow;
    evidence: Evidence[];
  }> = [
    {
      name: "funding evidence cannot satisfy need Spec",
      query: "companies needing marketing help in Austin",
      row: companyRow({
        entity_id: "company:funded-not-need",
        title: "Funded Co",
        location: "Austin",
      }),
      evidence: [
        fundingEv(
          "company:funded-not-need",
          new Date(NOW - 10 * 86400000).toISOString(),
        ),
      ],
    },
    {
      name: "hiring evidence cannot satisfy funding Spec",
      query: "recently funded startups in Berlin",
      row: companyRow({
        entity_id: "company:hiring-not-funded",
        title: "Hiring Co",
        location: "Berlin",
      }),
      evidence: [hiringEv("company:hiring-not-funded")],
    },
    {
      name: "list/directory page cannot qualify",
      query: "companies hiring in Toronto",
      row: companyRow({
        entity_id: "company:list",
        title: "Best startups in Toronto",
        location: "Toronto",
        page_type: "directory",
        url: "https://list.example/toronto",
      }),
      evidence: [hiringEv("company:list")],
    },
    {
      name: "provisional entity cannot qualify",
      query: "companies hiring copywriters in Toronto",
      row: companyRow({
        entity_id: "provisional:serp:abc",
        title: "Mystery Co",
        location: "Toronto",
        entity_resolved: false,
      }),
      evidence: [hiringEv("provisional:serp:abc")],
    },
    {
      name: "stale funding fails recent Spec",
      query: "recently funded startups in Berlin",
      row: companyRow({
        entity_id: "company:stale-fund",
        title: "Old Fund Co",
        location: "Berlin",
      }),
      evidence: [
        fundingEv(
          "company:stale-fund",
          new Date(NOW - 400 * 86400000).toISOString(),
        ),
      ],
    },
    {
      name: "wrong location cannot qualify",
      query: "companies hiring in Austin",
      row: companyRow({
        entity_id: "company:dallas",
        title: "Dallas Co",
        location: "Dallas",
      }),
      evidence: [hiringEv("company:dallas")],
    },
    {
      name: "subject-unbound claim cannot qualify",
      query: "companies hiring copywriters in Toronto",
      row: companyRow({
        entity_id: "company:a",
        title: "A Co",
        location: "Toronto",
      }),
      evidence: [hiringEv("company:somebody-else")],
    },
    {
      name: "I'm a web designer is not a service ask",
      query: "people asking for website help",
      row: personRow({
        entity_id: "person:designer",
        title: "Designer",
        location: null,
      }),
      evidence: [
        makeEvidence({
          source_url: "https://reddit.com/r/x/1",
          source_type: "social",
          excerpt: "I'm a web designer",
          evidence_type: "social_ask",
          supports: "requested_service",
          subject: "person:designer",
          claim_parameters: { is_ask: "false", intent: "identity_offer" },
        } as Evidence & { claim_parameters: Record<string, string> }),
      ],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const q = qualifyLead(c.row, extractSearchSpec(c.query), c.evidence);
      expect(q.disposition).not.toBe("qualified");
      const views = projectSpecRowsToQualifiedViews({
        rows: [
          {
            ...c.row,
            disposition: q.disposition,
            evidence: c.evidence,
          },
        ],
        spec: extractSearchSpec(c.query),
        run: createSearchRun(),
        nowMs: NOW,
      });
      expect(views.qualified_count).toBe(0);
    });
  }
});

describe("M15 — randomized adversarial mutations (seeded)", () => {
  /** Deterministic PRNG — same seed → same sequence. */
  function mulberry32(seed: number) {
    return () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("seeded mutations of a good funding lead never falsely qualify after sabotage", () => {
    const rand = mulberry32(15);
    const baseId = "company:good-fund";
    const goodEv = fundingEv(
      baseId,
      new Date(NOW - 20 * 86400000).toISOString(),
    );
    const goodRow = companyRow({
      entity_id: baseId,
      title: "Good Fund Co",
      location: "Berlin",
      evidence: [goodEv],
    });
    const spec = extractSearchSpec("recently funded startups in Berlin");
    expect(qualifyLead(goodRow, spec, [goodEv]).disposition).toBe("qualified");

    const sabotages: Array<(r: SpecRow, e: Evidence) => { row: SpecRow; ev: Evidence[] }> = [
      (r, e) => ({
        row: { ...r, page_type: "directory" },
        ev: [e],
      }),
      (r, e) => ({
        row: { ...r, location: "Dallas" },
        ev: [e],
      }),
      (r, e) => ({
        row: { ...r, entity_id: "provisional:x", entity_resolved: false },
        ev: [{ ...e, subject: "provisional:x" }],
      }),
      (r, e) => ({
        row: r,
        ev: [{ ...e, evidence_type: "hiring", excerpt: "hiring engineers" }],
      }),
      (r, e) => ({
        row: r,
        ev: [
          {
            ...e,
            event_at: new Date(NOW - 500 * 86400000).toISOString(),
          },
        ],
      }),
      (r, e) => ({
        row: r,
        ev: [{ ...e, subject: "company:other" }],
      }),
      (r) => ({
        row: r,
        ev: [],
      }),
    ];

    for (let i = 0; i < 21; i++) {
      const sab = sabotages[Math.floor(rand() * sabotages.length)]!;
      const { row, ev } = sab(goodRow, goodEv);
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition, `mutation ${i}: ${q.reject_code}`).not.toBe(
        "qualified",
      );
    }
  });
});

describe("M15 — cross-layer social production path (M5→M14)", () => {
  it("people recently asking for website help in Austin — full spine", () => {
    const query = "people recently asking for website help in Austin";
    const spec = extractSearchSpec(query);
    expect(spec.entity).toBe("person");
    expect(spec.signal_required).toBe(true);
    expect(spec.signal_recency).toBe("90d");
    expect(resolveCanonicalLocation("Austin")?.resolution).toBe("resolved");
    expect(buildSourcePlan(spec).steps.length).toBeGreaterThan(0);

    const artifact: SocialArtifact = {
      platform: "reddit",
      post_id: "m15ask",
      post_url: "https://reddit.com/r/Austin/comments/m15ask/x",
      author_platform_id: "reddit:u:mir_dev",
      author_name: "mir_dev",
      author_profile_url: "https://reddit.com/user/mir_dev",
      text: "Looking for a web designer — need website help",
      posted_at: new Date(NOW - 86400000).toISOString(),
      observed_at: new Date(NOW).toISOString(),
      community: "Austin",
    };
    expect(detectSocialNeed(artifact.text).is_ask).toBe(true);

    const opts: SocialHitsToRowsOptions = {
      resolveAuthor: (id) =>
        id.includes("mir_dev") ? "person:mir-dev" : null,
      authorLocations: { "person:mir-dev": "Austin" },
    };
    const pipe = socialArtifactToSpecRow(artifact, spec, opts);
    expect(pipe.row).not.toBeNull();

    const temporal = evaluateTemporalValidity(
      pipe.row!.evidence![0],
      spec,
      NOW,
    );
    expect(temporal.ok).toBe(true);

    const verified = verifyCandidateClaims({
      evidence: pipe.row!.evidence ?? [],
      entityId: pipe.row!.entity_id!,
      spec,
      nowMs: NOW,
    });
    expect(verified.ok).toBe(true);

    const gated = applyQualificationGate([pipe.row!], spec);
    expect(gated.qualified).toHaveLength(1);

    const projected = projectQualifiedLead({
      row: gated.qualified[0]!,
      spec,
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
  });

  it("two-year-old ask crawled today — never qualifies on recent Spec", () => {
    const spec = extractSearchSpec(
      "people recently asking for website help in Austin",
    );
    const artifact: SocialArtifact = {
      platform: "reddit",
      post_id: "oldask",
      post_url: "https://reddit.com/r/Austin/comments/oldask/x",
      author_platform_id: "reddit:u:mir_dev",
      author_name: "mir_dev",
      author_profile_url: null,
      text: "Looking for a web designer",
      posted_at: new Date(NOW - 730 * 86400000).toISOString(),
      observed_at: new Date(NOW).toISOString(),
      community: "Austin",
    };
    const pipe = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: () => "person:mir-dev",
      authorLocations: { "person:mir-dev": "Austin" },
    });
    expect(pipe.row).not.toBeNull();
    const q = qualifyLead(pipe.row!, spec, pipe.row!.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(
      q.reject_code === "TEMPORAL_STALE" ||
        q.reject_code === "TEMPORAL_UNKNOWN",
    ).toBe(true);
  });
});

describe("M15 — industry≠need / marketing companies≠needing marketing", () => {
  it("extract Specs remain adversarially distinct", () => {
    const industry = extractSearchSpec("marketing companies in Austin");
    const need = extractSearchSpec("companies needing marketing help in Austin");
    expect(industry.signal_required).toBe(false);
    expect(need.signal_required).toBe(true);
    expect(field(industry, "industry")?.toLowerCase()).toBe("marketing");
    expect(field(need, "requested_service")?.toLowerCase()).toMatch(/market/);
  });
});
