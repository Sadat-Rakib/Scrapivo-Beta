/**
 * M12 — Generalized People battery.
 *
 * Status target: TESTED (not VERIFIED).
 * Open role ontology + employment relationship + currentness + identity collision.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec, normalizeRole } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { qualifyLead } from "../qualify";
import { evaluateRoleCurrentness } from "../verification";
import { resolveEntityCandidate } from "../entity-resolve";
import { clearRegisteredEntities } from "../entity-registry";
import { buildSourcePlan } from "../source-plan";
import {
  personImpliesCurrentRole,
  personRoleFromSpec,
  personSpecRequiresEmployment,
  resolvePersonIdentity,
} from "../person";
import {
  employmentFromEvidence,
  needClaimBoundToPerson,
  requireEmploymentForPersonSpec,
} from "../person-employment";
import { evaluatePersonGates } from "../person-qualify";
import { projectQualifiedLead } from "../qualified-lead";
import { projectSpecRowsToQualifiedViews } from "../qualified-lead-view";
import { createSearchRun } from "../search-run";
import { resolveCanonicalLocation } from "../location-resolver";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "../evidence";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function personRow(
  partial: Partial<SpecRow> & { entity_id: string; title: string },
): SpecRow {
  return {
    kind: "person",
    detail: partial.detail ?? "",
    location: partial.location ?? "Toronto",
    url: partial.url ?? "https://linkedin.com/in/example",
    entity_resolved: true,
    page_type: "person_page",
    identity_confidence: 0.9,
    disposition: "qualified",
    evidence: [],
    ...partial,
  };
}

function founderEmploymentEvidence(
  personId: string,
  orgId: string,
  opts?: {
    currentness?: string;
    role?: string;
    observed_at?: string;
  },
): Evidence {
  return makeEvidence({
    source_url: "https://acme.example/about",
    source_type: "company",
    excerpt: `${opts?.role ?? "Founder"} at Acme`,
    evidence_type: "identity",
    supports: "identity",
    subject: personId,
    observed_at: opts?.observed_at ?? new Date(NOW).toISOString(),
    claim_parameters: {
      role: opts?.role ?? "founder",
      relationship: "founder",
      organization_entity_id: orgId,
      organization_name: "Acme",
      role_currentness: opts?.currentness ?? "current_role",
    },
    });
}

describe("M12 — open role ontology (not a finite occupation list)", () => {
  it("arbitrary roles normalize without hard-coded entity categories", () => {
    const cases: Array<[string, string]> = [
      ["founders", "founder"],
      ["CEOs", "ceo"],
      ["CTOs", "cto"],
      ["marketing directors", "marketing director"],
      ["principal engineers", "principal engineer"],
      ["restaurant managers", "restaurant manager"],
      ["AI researchers", "ai researcher"],
      ["venture partners", "venture partner"],
      ["dentists", "dentist"],
    ];
    for (const [raw, expected] of cases) {
      expect(normalizeRole(raw)).toBe(expected);
    }
  });

  it("NL queries extract person + role through generic machinery", () => {
    const md = extractSearchSpec(
      "marketing directors at SaaS companies in Toronto",
    );
    expect(md.entity).toBe("person");
    expect(personRoleFromSpec(md).normalized).toBe("marketing director");

    const pe = extractSearchSpec("principal engineers at fintech companies");
    expect(pe.entity).toBe("person");
    expect(personRoleFromSpec(pe).normalized).toBe("principal engineer");

    const ro = extractSearchSpec("restaurant owners in Vancouver");
    expect(ro.entity).toBe("person");
    expect(personRoleFromSpec(ro).normalized).toBe("owner");

    const ai = extractSearchSpec("AI researchers in Montreal");
    expect(ai.entity).toBe("person");
    expect(personRoleFromSpec(ai).normalized).toBe("ai researcher");
  });
});

describe("M12 — entity type never inherited from the query", () => {
  beforeEach(() => clearRegisteredEntities());

  it("Founder Institute → organization, never person", () => {
    const r = resolveEntityCandidate({
      title: "Founder Institute",
      url: "https://fi.co/programs",
      snippet: "Founder Institute startup accelerator",
    });
    expect(r.entity_type).not.toBe("person");
    expect(["organization", "company"]).toContain(r.entity_type);
  });

  it("company LinkedIn page ≠ person", () => {
    const r = resolveEntityCandidate({
      title: "Acme Inc | LinkedIn",
      url: "https://www.linkedin.com/company/acme",
      snippet: "Acme company page",
    });
    expect(r.entity_type).not.toBe("person");
  });
});

describe("M12 — currentness", () => {
  it("person+role Spec implies current unless former/ex stated", () => {
    const cur = extractSearchSpec("founders of AI startups in Toronto");
    expect(personImpliesCurrentRole(cur)).toBe(true);
    const former = extractSearchSpec("former founders of AI startups in Toronto");
    expect(personImpliesCurrentRole(former)).toBe(false);
  });

  it("former founder for current-founder request → CURRENTNESS_MISMATCH", () => {
    const spec = extractSearchSpec("founders of AI startups in Toronto");
    const personId = "person:ada";
    const ev = founderEmploymentEvidence(personId, "company:acme", {
      currentness: "former_role",
    });
    const cur = evaluateRoleCurrentness(ev, {
      ...spec,
      criteria: [
        ...spec.criteria,
        {
          field: "role_currentness",
          value: "current_role",
          stated: true,
          confidence: 1,
        },
      ],
    });
    expect(cur.ok).toBe(false);

    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "Toronto",
      evidence: [ev],
    });
    const q = qualifyLead(row, spec, [ev]);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("CURRENTNESS_MISMATCH");
  });

  it("role currentness unknown when currentness required → fail closed", () => {
    const spec = extractSearchSpec("founders of AI startups in Toronto");
    const personId = "person:ada";
    const ev = founderEmploymentEvidence(personId, "company:acme", {
      currentness: "unknown",
    });
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "Toronto",
      evidence: [ev],
    });
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("CURRENTNESS_MISMATCH");
  });

  it("historical role evidence retained — not rewritten as current", () => {
    const personId = "person:ada";
    const ev = founderEmploymentEvidence(personId, "company:acme", {
      currentness: "historical_role",
      observed_at: "2021-06-01T00:00:00.000Z",
    });
    const built = employmentFromEvidence({
      person_entity_id: personId,
      evidence: ev,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.employment.role_currentness).toBe("historical_role");
    expect(built.employment.role_observed_at).toBe("2021-06-01T00:00:00.000Z");
  });
});

describe("M12 — employment relationship (not co-mention)", () => {
  it("person + company merely co-mentioned → EMPLOYMENT_UNPROVEN", () => {
    const personId = "person:ada";
    const ev = makeEvidence({
      source_url: "https://news.example/story",
      source_type: "news",
      excerpt: "Ada spoke at Acme's event",
      evidence_type: "identity",
      supports: "identity",
      subject: personId,
      // company named but no organization_entity_id
      claim_parameters: { company: "Acme", role: "speaker" },
    });
    const built = employmentFromEvidence({
      person_entity_id: personId,
      evidence: ev,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reject_code).toBe("EMPLOYMENT_UNPROVEN");
  });

  it("explicit current employment evidence → relationship may qualify", () => {
    const personId = "person:ada";
    const ev = founderEmploymentEvidence(personId, "company:acme", {
      currentness: "current_role",
    });
    const built = employmentFromEvidence({
      person_entity_id: personId,
      evidence: ev,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.employment.person_entity_id).toBe(personId);
    expect(built.employment.organization_entity_id).toBe("company:acme");
    expect(built.employment.relationship).toBe("founder");
  });

  it("resolved person + provisional associated company when company required → fail", () => {
    const spec = extractSearchSpec("founders of AI startups in Toronto");
    expect(personSpecRequiresEmployment(spec)).toBe(true);
    const personId = "person:ada";
    const ev = makeEvidence({
      source_url: "https://acme.example/about",
      source_type: "company",
      excerpt: "Founder",
      evidence_type: "identity",
      supports: "identity",
      subject: personId,
      claim_parameters: {
        role: "founder",
        organization_entity_id: "provisional:org:acme",
        role_currentness: "current_role",
      },
    });
    const gate = requireEmploymentForPersonSpec({
      spec,
      person_entity_id: personId,
      evidence: [ev],
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reject_code).toBe("ASSOCIATED_COMPANY_UNRESOLVED");
    }
  });
});

describe("M12 — identity collision", () => {
  it("two people same name → unresolved without corroboration", () => {
    const decision = resolvePersonIdentity([
      {
        name: "John Smith",
        entity_id: "person:john-acme",
        company: "Acme",
        company_entity_id: "company:acme",
      },
      {
        name: "John Smith",
        entity_id: "person:john-beta",
        company: "Beta",
        company_entity_id: "company:beta",
      },
    ]);
    expect(decision.status).toBe("ambiguous");
    if (decision.status !== "resolved") {
      expect(decision.reject_code).toBe("IDENTITY_AMBIGUOUS");
    }
  });

  it("same name + shared profile URL → may resolve", () => {
    const decision = resolvePersonIdentity([
      {
        name: "John Smith",
        entity_id: "person:john",
        profile_url: "https://linkedin.com/in/johnsmith",
        company: "Acme",
      },
      {
        name: "John Smith",
        entity_id: "person:john",
        profile_url: "https://linkedin.com/in/johnsmith",
        company: "Acme",
      },
    ]);
    expect(decision.status).toBe("resolved");
    if (decision.status === "resolved") {
      expect(decision.entity_id).toBe("person:john");
    }
  });

  it("person evidence bound to another same-name person → subject-binding rejection", () => {
    const spec = extractSearchSpec("founders of AI startups in Toronto");
    const row = personRow({
      entity_id: "person:john-acme",
      title: "John Smith",
      location: "Toronto",
      evidence: [
        founderEmploymentEvidence("person:john-beta", "company:beta", {
          currentness: "current_role",
        }),
      ],
    });
    const gate = evaluatePersonGates({
      row,
      spec,
      evidence: row.evidence as Evidence[],
      identitySeeds: [
        {
          name: "John Smith",
          entity_id: "person:john-acme",
          company_entity_id: "company:acme",
        },
        {
          name: "John Smith",
          entity_id: "person:john-beta",
          company_entity_id: "company:beta",
        },
      ],
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(
        gate.reject_code === "IDENTITY_AMBIGUOUS" ||
          gate.reject_code === "CLAIM_NOT_SUBJECT_BOUND",
      ).toBe(true);
    }
  });
});

describe("M12 — need/signal separate from identity", () => {
  it("founder evidence + unrelated developer evidence → need claim fails", () => {
    const personId = "person:ada";
    const bound = needClaimBoundToPerson({
      person_entity_id: personId,
      needEvidence: [
        makeEvidence({
          source_url: "https://jobs.example/dev",
          source_type: "job",
          excerpt: "Hiring developers at OtherCo",
          evidence_type: "hiring",
          supports: "requested_role",
          subject: "company:other", // wrong subject
        }),
      ],
    });
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
  });

  it("founder explicitly asking for developer → may qualify", () => {
    const spec = extractSearchSpec("founders needing developers in SF");
    const personId = "person:ada";
    const employment = founderEmploymentEvidence(personId, "company:acme", {
      currentness: "current_role",
    });
    const need = makeEvidence({
      source_url: "https://x.com/ada/status/1",
      source_type: "social",
      excerpt: "looking for a developer",
      evidence_type: "social_ask",
      supports: "requested_role",
      subject: personId,
      claim_parameters: { role: "developer" },
    });
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "San Francisco",
      detail: "Acme",
      evidence: [employment, need],
    });
    const q = qualifyLead(row, spec, [employment, need]);
    expect(q.disposition).toBe("qualified");
  });

  it("person asking for website help — service claim separate from identity", () => {
    const spec = extractSearchSpec("people asking for website help in Austin");
    expect(spec.entity).toBe("person");
    expect(spec.signal_required).toBe(true);
    const personId = "person:mir";
    // No founder role required — employment optional; need must bind to person.
    const need = makeEvidence({
      source_url: "https://reddit.com/r/Austin/1",
      source_type: "social",
      excerpt: "need help with my website",
      evidence_type: "service_request",
      supports: "requested_service",
      subject: personId,
    });
    const row = personRow({
      entity_id: personId,
      title: "Mir",
      location: "Austin",
      evidence: [need],
    });
    // Role may be missing on this Spec — personSpecRequiresEmployment false
    if (!personSpecRequiresEmployment(spec)) {
      const bound = needClaimBoundToPerson({
        person_entity_id: personId,
        needEvidence: [need],
      });
      expect(bound.ok).toBe(true);
    }
  });
});

describe("M12 — location + contacts", () => {
  it("person correct, wrong location → M6/theorem rejects", () => {
    const spec = extractSearchSpec("founders of AI startups in Toronto");
    const personId = "person:ada";
    const ev = founderEmploymentEvidence(personId, "company:acme");
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "Dallas",
      evidence: [ev],
    });
    const q = qualifyLead(row, spec, [ev]);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("LOCATION_MISMATCH");
  });

  it("public email absent does not reject unless requested", () => {
    const spec = extractSearchSpec("founders needing developers in SF");
    const personId = "person:ada";
    const employment = founderEmploymentEvidence(personId, "company:acme");
    const need = makeEvidence({
      source_url: "https://x.com/ada",
      source_type: "social",
      excerpt: "looking for a developer",
      evidence_type: "social_ask",
      supports: "requested_role",
      subject: personId,
    });
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "San Francisco",
      email: null,
      evidence: [employment, need],
    });
    const q = qualifyLead(row, spec, [employment, need]);
    expect(q.reject_code).not.toBe("MISSING_QUERY_REQUIRED");
    expect(q.disposition).toBe("qualified");
  });

  it("email explicitly required → blocks if unavailable", () => {
    const base = extractSearchSpec("founders needing developers in SF");
    const spec = {
      ...base,
      criteria: [
        ...base.criteria,
        { field: "require_email", value: "true", stated: true, confidence: 1 },
      ],
    };
    const personId = "person:ada";
    const employment = founderEmploymentEvidence(personId, "company:acme");
    const need = makeEvidence({
      source_url: "https://x.com/ada",
      source_type: "social",
      excerpt: "looking for a developer",
      evidence_type: "social_ask",
      supports: "requested_role",
      subject: personId,
    });
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "San Francisco",
      email: null,
      evidence: [employment, need],
    });
    const q = qualifyLead(row, spec, [employment, need]);
    expect(q.disposition).not.toBe("qualified");
  });
});

describe("M12 — people-capable source planning", () => {
  it("person Spec plans people-capable sources", () => {
    const spec = extractSearchSpec(
      "marketing directors at SaaS companies in Toronto",
    );
    const plan = buildSourcePlan(spec);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(
      plan.steps.some((s) => s.capabilities.entityTypes.includes("person")),
    ).toBe(true);
  });
});

describe("M12 — production path + inverse", () => {
  it("happy: NL→Spec→geo→plan→person resolve→employment→verify→qualify→M10→M11 view", () => {
    const query = "founders needing developers in SF";
    const spec = extractSearchSpec(query);
    expect(spec.entity).toBe("person");
    expect(resolveCanonicalLocation("San Francisco")?.id).toBeTruthy();
    expect(buildSourcePlan(spec).steps.length).toBeGreaterThan(0);

    const personId = "person:ada-lovelace";
    const employment = founderEmploymentEvidence(personId, "company:acme");
    const need = makeEvidence({
      source_url: "https://x.com/ada/status/1",
      source_type: "social",
      excerpt: "looking for a developer",
      evidence_type: "social_ask",
      supports: "requested_role",
      subject: personId,
      claim_parameters: { role: "developer" },
    });

    const row = personRow({
      entity_id: personId,
      title: "Ada Lovelace",
      location: "San Francisco",
      detail: "Acme",
      evidence: [employment, need],
    });

    const q = qualifyLead(row, spec, [employment, need]);
    expect(q.disposition).toBe("qualified");

    const run = createSearchRun();
    const projected = projectQualifiedLead({
      row: { ...row, disposition: "qualified" },
      spec,
      run,
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.lead.entity_type).toBe("person");
    expect(projected.lead.evidence.length).toBeGreaterThan(0);

    const views = projectSpecRowsToQualifiedViews({
      rows: [{ ...row, disposition: "qualified" }],
      spec,
      run,
      nowMs: NOW,
    });
    expect(views.qualified_count).toBe(1);
    expect(views.views[0]?.evidence.length).toBeGreaterThan(0);
  });

  it("inverse: real person but role/need/currentness not established → qualified_count 0", () => {
    const spec = extractSearchSpec("founders needing developers in SF");
    const personId = "person:ada";
    // Real person, but former founder + need about someone else
    const employment = founderEmploymentEvidence(personId, "company:acme", {
      currentness: "former_role",
    });
    const need = makeEvidence({
      source_url: "https://jobs.example/1",
      source_type: "job",
      excerpt: "hiring developers",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: "company:other",
    });
    const row = personRow({
      entity_id: personId,
      title: "Ada",
      location: "San Francisco",
      evidence: [employment, need],
    });
    const q = qualifyLead(row, spec, [employment, need]);
    expect(q.disposition).not.toBe("qualified");

    const views = projectSpecRowsToQualifiedViews({
      rows: [{ ...row, disposition: q.disposition }],
      spec,
      nowMs: NOW,
    });
    expect(views.qualified_count).toBe(0);
  });
});
