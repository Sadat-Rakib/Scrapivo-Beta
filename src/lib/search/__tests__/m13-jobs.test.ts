/**
 * M13 — Jobs battery (first-class JobPosting entity).
 *
 * Status target: TESTED (not VERIFIED).
 * Job board ≠ employer; posting currentness; employer evidence binding.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { qualifyLead } from "../qualify";
import { resolveEntityCandidate } from "../entity-resolve";
import { clearRegisteredEntities } from "../entity-registry";
import { buildSourcePlan } from "../source-plan";
import {
  jobImpliesActivePosting,
  jobRoleFromSpec,
  resolveJobIdentity,
} from "../job";
import {
  employerFromEvidence,
  evaluateJobCurrentness,
  requireEmployerForJobSpec,
} from "../job-employer";
import { evaluateJobGates } from "../job-qualify";
import { projectQualifiedLead } from "../qualified-lead";
import { projectSpecRowsToQualifiedViews } from "../qualified-lead-view";
import { createSearchRun } from "../search-run";
import { resolveCanonicalLocation } from "../location-resolver";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "../evidence";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function jobRow(
  partial: Partial<SpecRow> & { entity_id: string; title: string },
): SpecRow {
  return {
    kind: "job",
    detail: partial.detail ?? "Acme",
    location: partial.location ?? "Toronto",
    url: partial.url ?? "https://jobs.example/1",
    entity_resolved: true,
    page_type: "job_posting",
    identity_confidence: 0.9,
    disposition: "qualified",
    employer: partial.employer ?? "Acme",
    evidence: [],
    ...partial,
  };
}

function employerEvidence(
  jobId: string,
  orgId: string,
  opts?: { currentness?: string; role?: string },
): Evidence {
  return makeEvidence({
    source_url: "https://jobs.example/1",
    source_type: "job",
    excerpt: `${opts?.role ?? "React developer"} at Acme`,
    evidence_type: "hiring",
    supports: "requested_role",
    subject: jobId,
    observed_at: new Date(NOW).toISOString(),
    claim_parameters: {
      role: opts?.role ?? "developer",
      employer_entity_id: orgId,
      employer: "Acme",
      job_currentness: opts?.currentness ?? "active",
    },
    });
}

describe("M13 — job Spec + open role", () => {
  it("NL job queries extract job entity + role through generic machinery", () => {
    const a = extractSearchSpec("React jobs in Toronto paying $150k+");
    expect(a.entity).toBe("job");
    expect(jobRoleFromSpec(a).normalized).toBeTruthy();

    const b = extractSearchSpec("remote senior frontend developer jobs in Berlin");
    expect(b.entity).toBe("job");
    expect(jobRoleFromSpec(b).normalized).toBe("developer");
  });

  it("job Spec implies active posting unless expired/closed stated", () => {
    expect(
      jobImpliesActivePosting(extractSearchSpec("React jobs in Toronto")),
    ).toBe(true);
    expect(
      jobImpliesActivePosting(
        extractSearchSpec("expired React jobs in Toronto"),
      ),
    ).toBe(false);
  });
});

describe("M13 — source ≠ employer", () => {
  beforeEach(() => clearRegisteredEntities());

  it("Monster/Indeed job board cannot become employer/person", () => {
    for (const url of [
      "https://www.monster.com/jobs/q-marketing-jobs",
      "https://www.indeed.com/q-software-developer-jobs.html",
    ]) {
      const r = resolveEntityCandidate({
        url,
        title: "Acme - Marketing Jobs",
        page_type: "job_board",
      });
      expect(r.entity_resolved).toBe(false);
      expect(r.entity_type).not.toBe("person");
    }
  });

  it("job_board page_type cannot qualify as job posting", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const row = jobRow({
      entity_id: "job:board",
      title: "Marketing Jobs",
      page_type: "job_board",
      kind: "job",
    });
    const gate = evaluateJobGates({ row, spec, evidence: [] });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reject_code).toBe("LIST_PAGE_AS_ENTITY");
  });
});

describe("M13 — employer binding + currentness", () => {
  it("company named without org id → EMPLOYMENT_UNPROVEN", () => {
    const jobId = "job:1";
    const ev = makeEvidence({
      source_url: "https://news.example/1",
      source_type: "news",
      excerpt: "Acme is hiring",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: jobId,
      claim_parameters: { company: "Acme", role: "developer" },
    });
    const built = employerFromEvidence({ job_entity_id: jobId, evidence: ev });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reject_code).toBe("EMPLOYMENT_UNPROVEN");
  });

  it("explicit employer entity_id → binding may qualify", () => {
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme");
    const built = employerFromEvidence({ job_entity_id: jobId, evidence: ev });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.binding.employer_entity_id).toBe("company:acme");
    expect(built.job_currentness).toBe("active");
  });

  it("expired posting for active job request → CURRENTNESS_MISMATCH", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme", {
      currentness: "expired",
    });
    expect(evaluateJobCurrentness(ev, spec).ok).toBe(false);
    const row = jobRow({
      entity_id: jobId,
      title: "React Dev",
      location: "Toronto",
      evidence: [ev],
      salary: 160000,
    });
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("CURRENTNESS_MISMATCH");
  });

  it("unknown job_currentness when active required → fail closed", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme", {
      currentness: "unknown",
    });
    const gate = requireEmployerForJobSpec({
      spec,
      job_entity_id: jobId,
      evidence: [ev],
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reject_code).toBe("CURRENTNESS_MISMATCH");
  });

  it("provisional employer when company required → ASSOCIATED_COMPANY_UNRESOLVED", () => {
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "provisional:org:acme");
    const built = employerFromEvidence({ job_entity_id: jobId, evidence: ev });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.reject_code).toBe("ASSOCIATED_COMPANY_UNRESOLVED");
    }
  });
});

describe("M13 — identity collision", () => {
  it("same title at two employers → unresolved without apply_url", () => {
    const d = resolveJobIdentity([
      {
        title: "Marketing Manager",
        entity_id: "job:acme",
        employer: "Acme",
        employer_entity_id: "company:acme",
      },
      {
        title: "Marketing Manager",
        entity_id: "job:beta",
        employer: "Beta",
        employer_entity_id: "company:beta",
      },
    ]);
    expect(d.status).toBe("ambiguous");
  });

  it("same title + shared apply URL → may resolve", () => {
    const d = resolveJobIdentity([
      {
        title: "Marketing Manager",
        entity_id: "job:1",
        apply_url: "https://acme.example/jobs/1",
      },
      {
        title: "Marketing Manager",
        entity_id: "job:1",
        apply_url: "https://acme.example/jobs/1",
      },
    ]);
    expect(d.status).toBe("resolved");
  });
});

describe("M13 — location + salary query-aware", () => {
  it("correct job, wrong location → LOCATION_MISMATCH", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme");
    const row = jobRow({
      entity_id: jobId,
      title: "React Dev",
      location: "Dallas",
      evidence: [ev],
    });
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("LOCATION_MISMATCH");
  });

  it("explicit Canadian province codes satisfy a Canada country query", () => {
    const spec = extractSearchSpec("AI automation jobs in Canada");
    const ev = employerEvidence("job:ca", "company:acme");
    const row = jobRow({
      entity_id: "job:ca",
      title: "AI & Automation Manager",
      location: "ON, CA; Calgary, AB, CA",
      country: "CA",
      evidence: [ev],
    });
    expect(qualifyLead(row, spec, [ev]).reject_code).not.toBe("LOCATION_MISMATCH");
  });

  it("salary absent does not reject unless Spec demands it", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme");
    const row = jobRow({
      entity_id: jobId,
      title: "React Dev",
      location: "Toronto",
      salary: null,
      evidence: [ev],
    });
    const q = qualifyLead(row, spec, [ev]);
    expect(q.reject_code).not.toBe("MISSING_QUERY_REQUIRED");
    expect(q.disposition).toBe("qualified");
  });

  it("salary required → blocks if unavailable", () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme");
    const row = jobRow({
      entity_id: jobId,
      title: "React Dev",
      location: "Toronto",
      salary: null,
      evidence: [ev],
    });
    const q = qualifyLead(row, { ...spec, signal_required: false }, [ev]);
    expect(q.disposition).not.toBe("qualified");
  });
});

describe("M13 — people-capable sources for jobs", () => {
  it("job Spec plans jobs-capable sources", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const plan = buildSourcePlan(spec);
    expect(plan.steps.some((s) => s.capabilities.entityTypes.includes("job"))).toBe(
      true,
    );
  });
});

describe("M13 — production path + inverse", () => {
  it("happy: NL→Spec→geo→plan→job resolve→employer→qualify→M10→M11 view", () => {
    const query = "React jobs in Toronto paying $150k+";
    const spec = extractSearchSpec(query);
    expect(spec.entity).toBe("job");
    expect(resolveCanonicalLocation("Toronto")?.id).toBeTruthy();
    expect(buildSourcePlan(spec).steps.length).toBeGreaterThan(0);

    const jobId = "job:react-toronto";
    const ev = employerEvidence(jobId, "company:acme", { role: "developer" });
    const row = jobRow({
      entity_id: jobId,
      title: "Senior React Developer",
      location: "Toronto",
      salary: 175000,
      employer: "Acme",
      evidence: [ev],
    });
    const q = qualifyLead(row, { ...spec, signal_required: false }, [ev]);
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
    expect(projected.lead.entity_type).toBe("job");

    const views = projectSpecRowsToQualifiedViews({
      rows: [{ ...row, disposition: "qualified" }],
      spec,
      run,
      nowMs: NOW,
    });
    expect(views.qualified_count).toBe(1);
  });

  it("inverse: real posting but expired / wrong employer → qualified_count 0", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    const jobId = "job:1";
    const ev = employerEvidence(jobId, "company:acme", {
      currentness: "expired",
    });
    const row = jobRow({
      entity_id: jobId,
      title: "React Dev",
      location: "Toronto",
      evidence: [ev],
    });
    const q = qualifyLead(row, spec, [ev]);
    expect(q.disposition).not.toBe("qualified");
    const views = projectSpecRowsToQualifiedViews({
      rows: [{ ...row, disposition: q.disposition }],
      spec,
      nowMs: NOW,
    });
    expect(views.qualified_count).toBe(0);
  });
});
