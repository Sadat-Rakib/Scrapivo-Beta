/**
 * M14 — Social signal discovery battery.
 *
 * Status target: TESTED (not VERIFIED).
 * POST ≠ AUTHOR ≠ COMPANY; platform ≠ real-world; ask ≠ topic;
 * event_at = posted_at (never crawl date); subreddit ≠ author location.
 */
import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { qualifyLead } from "../qualify";
import {
  evaluateTemporalValidity,
  mergeEvidencePreservingEventAt,
  verifyCandidateClaims,
} from "../verification";
import {
  socialArtifactFromHit,
  socialArtifactKey,
  type SocialArtifact,
} from "../social-artifact";
import { detectSocialNeed, socialNeedMatchesSpec } from "../social-need";
import {
  resolveSocialAuthor,
  socialAuthorSatisfiesPersonSpec,
} from "../social-author";
import { bindSocialClaimSubject } from "../social-company";
import { evaluateSocialGates } from "../social-qualify";
import {
  socialArtifactToSpecRow,
  socialHitsThroughPipeline,
  socialHitsToSpecRows,
} from "../social-signal";
import { projectQualifiedLead } from "../qualified-lead";
import { createSearchRun } from "../search-run";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "../evidence";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const YESTERDAY_UTC = Math.floor((NOW - 24 * 3600 * 1000) / 1000);
const TWO_YEARS_UTC = Math.floor((NOW - 730 * 24 * 3600 * 1000) / 1000);

function askArtifact(
  partial: Partial<SocialArtifact> & { text: string; author_platform_id: string },
): SocialArtifact {
  return {
    platform: "reddit",
    post_id: partial.post_id ?? "abc123",
    post_url:
      partial.post_url ??
      `https://reddit.com/r/${partial.community ?? "webdev"}/comments/${partial.post_id ?? "abc123"}/x`,
    author_name: partial.author_name ?? "mir_dev",
    author_profile_url:
      partial.author_profile_url ?? "https://reddit.com/user/mir_dev",
    posted_at: partial.posted_at ?? new Date(YESTERDAY_UTC * 1000).toISOString(),
    observed_at: partial.observed_at ?? new Date(NOW).toISOString(),
    community: partial.community ?? "webdev",
    is_community_container: partial.is_community_container,
    ...partial,
  };
}

function resolveAuthor(platformId: string): string {
  if (platformId.includes("mir_dev")) return "person:mir-dev";
  if (platformId.includes("ada_toronto")) return "person:ada-toronto";
  return `person:${platformId.replace(/[^a-z0-9]+/gi, "-")}`;
}

describe("M14 — need detection (ask ≠ topic)", () => {
  it('"Looking for a web designer" → valid ask', () => {
    const d = detectSocialNeed("Looking for a web designer");
    expect(d.is_ask).toBe(true);
    expect(d.claim_type).toMatch(/social_ask|service_request/);
    expect(d.detected_need).toBeTruthy();
  });

  it("\"I'm a web designer\" → not a service request", () => {
    const d = detectSocialNeed("I'm a web designer");
    expect(d.is_ask).toBe(false);
    expect(d.intent).toBe("identity_offer");
  });

  it('"We redesigned our website" → not an ask', () => {
    const d = detectSocialNeed("We just redesigned our website");
    expect(d.is_ask).toBe(false);
    expect(d.intent).toBe("statement");
  });

  it('"Can anyone recommend a copywriter?" → valid ask', () => {
    const d = detectSocialNeed("Can anyone recommend a copywriter?");
    expect(d.is_ask).toBe(true);
    expect(d.detected_need).toBe("copywriting");
  });

  it('"Acme needs marketing" → not automatically Acme request', () => {
    const d = detectSocialNeed("Acme needs marketing");
    expect(d.is_ask).toBe(false);
    expect(d.intent).toBe("third_party_observation");
  });

  it("funding/hiring mention does not satisfy unrelated website Spec", () => {
    const d = detectSocialNeed("We just raised a Series A and are hiring engineers");
    const spec = extractSearchSpec("people asking for website help");
    expect(
      socialNeedMatchesSpec(d, {
        requested_service: "website",
        requested_product: null,
        requested_role: null,
      }),
    ).toBe(false);
    // Even if hiring is an ask, it must not match website Spec need fields.
    if (d.is_ask) {
      expect(
        socialNeedMatchesSpec(d, {
          requested_service:
            spec.criteria.find((c) => c.field === "requested_service")?.value ??
            "website help",
        }),
      ).toBe(false);
    }
  });

  it("keeps detected_need / intent / claim_parameters / confidence / evidence_text separate", () => {
    const d = detectSocialNeed("I need someone to redesign our website");
    expect(d.is_ask).toBe(true);
    expect(d.detected_need).toBe("website_help");
    expect(d.intent).toBeTruthy();
    expect(d.claim_parameters).toBeTruthy();
    expect(typeof d.confidence).toBe("number");
    expect(d.evidence_text.length).toBeGreaterThan(0);
  });
});

describe("M14 — POST ≠ AUTHOR ≠ COMPANY", () => {
  it("community container never becomes a person lead", () => {
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mods",
      is_community_container: true,
    });
    const spec = extractSearchSpec("people asking for website help");
    const r = socialArtifactToSpecRow(artifact, spec);
    expect(r.row).toBeNull();
    expect(r.skip_reason).toBe("community_container_not_a_lead");
  });

  it("post mentioning Acme does not make Acme the author", () => {
    const d = detectSocialNeed("Acme needs a better website lol");
    expect(d.is_ask).toBe(false);
    const author = resolveSocialAuthor(
      askArtifact({
        text: "Acme needs a better website lol",
        author_platform_id: "reddit:u:random_username_928",
      }),
    );
    expect(author.status).not.toBe("resolved");
    if (author.status !== "unresolved") {
      expect(author.entity_id).not.toMatch(/^company:/);
    }
  });

  it("personal ask + employment at Acme does not auto-qualify Acme as requester", () => {
    const need = detectSocialNeed("Looking for a web designer for my side project");
    expect(need.claim_parameters.company_behalf).not.toBe("true");
    const employment = makeEvidence({
      source_url: "https://acme.example/team",
      source_type: "company",
      excerpt: "works at Acme",
      evidence_type: "identity",
      supports: "identity",
      subject: "person:mir-dev",
      claim_parameters: {
        relationship: "employment",
        organization_entity_id: "company:acme",
        organization_name: "Acme",
        role_currentness: "current_role",
      },
    } as Evidence & { claim_parameters: Record<string, string> });
    const binding = bindSocialClaimSubject({
      author_entity_id: "person:mir-dev",
      need,
      evidence: [employment],
      prefer_company_subject: true,
    });
    expect(binding.ok).toBe(false);
  });

  it('explicit "we at Acme are looking for…" + proven employment → company subject may bind', () => {
    const need = detectSocialNeed(
      "We at Acme are looking for a web designer to redesign our site",
    );
    expect(need.is_ask).toBe(true);
    expect(need.claim_parameters.company_behalf).toBe("true");
    const employment = makeEvidence({
      source_url: "https://acme.example/team",
      source_type: "company",
      excerpt: "Engineer at Acme",
      evidence_type: "identity",
      supports: "identity",
      subject: "person:mir-dev",
      claim_parameters: {
        relationship: "employment",
        organization_entity_id: "company:acme",
        organization_name: "Acme",
        role_currentness: "current_role",
      },
    } as Evidence & { claim_parameters: Record<string, string> });
    const binding = bindSocialClaimSubject({
      author_entity_id: "person:mir-dev",
      need,
      evidence: [employment],
      prefer_company_subject: true,
    });
    expect(binding.ok).toBe(true);
    if (binding.ok) {
      expect(binding.subject_kind).toBe("company");
      expect(binding.subject_entity_id).toBe("company:acme");
    }
  });
});

describe("M14 — author resolution + subject binding", () => {
  it("anonymous handle stays platform_only — not a resolved person", () => {
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:random_username_928",
      author_name: "random_username_928",
    });
    const author = resolveSocialAuthor(artifact);
    expect(author.status).toBe("platform_only");
    if (author.status === "platform_only") {
      expect(author.real_world).toBe(false);
      expect(author.entity_id.startsWith("provisional:")).toBe(true);
      expect(socialAuthorSatisfiesPersonSpec(author)).toBe(false);
    }
  });

  it("unresolved real person where person Spec required → reject", () => {
    const spec = extractSearchSpec("people asking for website help");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:random_username_928",
      author_name: "random_username_928",
    });
    const r = socialArtifactToSpecRow(artifact, spec);
    expect(r.row).not.toBeNull();
    // platform_only still yields a provisional row for discovery, but qualify fails closed.
    const q = qualifyLead(r.row!, spec, r.row!.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(
      q.reject_code === "PROVISIONAL_ENTITY" ||
        q.reject_code === "ENTITY_UNRESOLVED",
    ).toBe(true);
  });

  it("resolved author + exact ask → subject binding may pass", () => {
    const spec = extractSearchSpec("people asking for website help");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mir_dev",
    });
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
    });
    expect(r.row).not.toBeNull();
    expect(r.row!.entity_id).toBe("person:mir-dev");
    expect(r.row!.evidence?.[0]?.subject).toBe("person:mir-dev");
    expect(r.row!.entity_resolved).toBe(true);
  });

  it("wrong author bound to post → reject", () => {
    const spec = extractSearchSpec("people asking for website help");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mir_dev",
    });
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
    });
    const poisoned: SpecRow = {
      ...r.row!,
      entity_id: "person:someone-else",
    };
    const gate = evaluateSocialGates({
      row: poisoned,
      spec,
      evidence: r.row!.evidence ?? [],
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
  });
});

describe("M14 — freshness / event_at = posted_at", () => {
  it("post yesterday + recent query → fresh", () => {
    const spec = extractSearchSpec("people recently asking for website help");
    expect(spec.signal_recency).toBe("90d");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mir_dev",
      posted_at: new Date(YESTERDAY_UTC * 1000).toISOString(),
      observed_at: new Date(NOW).toISOString(),
    });
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
    });
    const ev = r.row!.evidence![0];
    expect(ev.event_at).toBe(artifact.posted_at);
    expect(ev.observed_at).toBe(artifact.observed_at);
    const temporal = evaluateTemporalValidity(ev, spec, NOW);
    expect(temporal.ok).toBe(true);
    expect(temporal.freshness).toBe("fresh");
  });

  it("post 2 years ago crawled today → stale", () => {
    const spec = extractSearchSpec("people recently asking for website help");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mir_dev",
      posted_at: new Date(TWO_YEARS_UTC * 1000).toISOString(),
      observed_at: new Date(NOW).toISOString(),
    });
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
    });
    const temporal = evaluateTemporalValidity(r.row!.evidence![0], spec, NOW);
    expect(temporal.ok).toBe(false);
    expect(temporal.freshness).toBe("stale");
  });

  it("missing post timestamp with required recency → TEMPORAL_UNKNOWN", () => {
    const spec = extractSearchSpec("people recently asking for website help");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mir_dev",
      posted_at: null,
      observed_at: new Date(NOW).toISOString(),
    });
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
    });
    const v = verifyCandidateClaims({
      evidence: r.row!.evidence ?? [],
      entityId: r.row!.entity_id!,
      spec,
      nowMs: NOW,
    });
    expect(v.ok).toBe(false);
    expect(v.reject_code).toBe("TEMPORAL_UNKNOWN");
  });

  it("re-crawl must not rewrite historical event_at", () => {
    const existing = makeEvidence({
      source_url: "https://reddit.com/r/webdev/comments/abc123/x",
      source_type: "social",
      excerpt: "Looking for a web designer",
      evidence_type: "social_ask",
      supports: "requested_service",
      subject: "person:mir-dev",
      event_at: "2024-01-01T00:00:00.000Z",
      observed_at: "2024-01-02T00:00:00.000Z",
    });
    const incoming = makeEvidence({
      source_url: "https://reddit.com/r/webdev/comments/abc123/x",
      source_type: "social",
      excerpt: "Looking for a web designer",
      evidence_type: "social_ask",
      supports: "requested_service",
      subject: "person:mir-dev",
      event_at: "2026-09-14T00:00:00.000Z",
      observed_at: new Date(NOW).toISOString(),
    });
    const merged = mergeEvidencePreservingEventAt(existing, incoming);
    expect(merged.event_at).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("M14 — location (subreddit ≠ author location)", () => {
  it("Toronto subreddit only is not proof of author location", () => {
    const spec = extractSearchSpec("people asking for website help in Toronto");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:mir_dev",
      community: "toronto",
    });
    // No authorLocations — location must stay null (never copy Spec or subreddit).
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
    });
    expect(r.row!.location).toBeNull();
    const gate = evaluateSocialGates({
      row: r.row!,
      spec,
      evidence: r.row!.evidence ?? [],
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reject_code).toBe("MISSING_QUERY_REQUIRED");
  });

  it("proven Toronto author + matching ask may qualify", () => {
    const spec = extractSearchSpec("people asking for website help in Toronto");
    const artifact = askArtifact({
      text: "Looking for a web designer",
      author_platform_id: "reddit:u:ada_toronto",
      community: "webdev",
      posted_at: new Date(YESTERDAY_UTC * 1000).toISOString(),
    });
    const r = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
      authorLocations: { "person:ada-toronto": "Toronto" },
    });
    expect(r.row!.location).toBe("Toronto");
    const q = qualifyLead(r.row!, spec, r.row!.evidence);
    expect(q.disposition).toBe("qualified");
  });
});

describe("M14 — dedup + unavailable evidence", () => {
  it("duplicate post from two discovery sources → one underlying signal", () => {
    const spec = extractSearchSpec("people asking for website help");
    const url =
      "https://reddit.com/r/webdev/comments/dup99/looking_for_designer";
    const hits = [
      {
        title: "Looking for a web designer",
        url,
        excerpt: "need help",
        author: "mir_dev",
        created_utc: YESTERDAY_UTC,
        subreddit: "webdev",
      },
      {
        title: "Looking for a web designer",
        url,
        excerpt: "need help (mirror)",
        author: "mir_dev",
        created_utc: YESTERDAY_UTC,
        subreddit: "webdev",
      },
    ];
    const through = socialHitsThroughPipeline(hits, spec, {
      resolveAuthor: resolveAuthor,
    });
    expect(through.filter((x) => x.row).length).toBe(1);
    expect(through.some((x) => x.skip_reason === "duplicate_post")).toBe(true);
    expect(socialArtifactKey(through[0]!.artifact)).toBe(
      socialArtifactKey(through[1]!.artifact),
    );
  });

  it("re-crawl same post does not create a new event key", () => {
    const a = socialArtifactFromHit({
      title: "Looking for a web designer",
      url: "https://reddit.com/r/webdev/comments/same1/x",
      excerpt: "help",
      author: "mir_dev",
      created_utc: YESTERDAY_UTC,
      observed_at: "2026-09-14T12:00:00.000Z",
    });
    const b = socialArtifactFromHit({
      title: "Looking for a web designer",
      url: "https://reddit.com/r/webdev/comments/same1/x",
      excerpt: "help",
      author: "mir_dev",
      created_utc: YESTERDAY_UTC,
      observed_at: "2026-09-15T12:00:00.000Z",
    });
    expect(socialArtifactKey(a)).toBe(socialArtifactKey(b));
    expect(a.posted_at).toBe(b.posted_at);
    expect(a.observed_at).not.toBe(b.observed_at);
  });

  it("group/page itself never the person lead (SOURCE_IS_LEAD)", () => {
    const spec = extractSearchSpec("people asking for website help");
    const row: SpecRow = {
      kind: "person",
      key: "social:reddit:group:toronto",
      entity_id: "person:fake",
      entity_resolved: true,
      page_type: "directory",
      title: "r/toronto",
      detail: "r/toronto",
      url: "https://reddit.com/r/toronto",
      location: null,
      evidence: [
        makeEvidence({
          source_url: "https://reddit.com/r/toronto",
          source_type: "social",
          excerpt: "Looking for a web designer",
          evidence_type: "social_ask",
          supports: "requested_service",
          subject: "person:fake",
          claim_parameters: { is_ask: "true" },
        } as Evidence & { claim_parameters: Record<string, string> }),
      ],
    };
    const gate = evaluateSocialGates({ row, spec, evidence: row.evidence! });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reject_code).toBe("SOURCE_IS_LEAD");
  });
});

describe("M14 — production path: people asking for website help", () => {
  it("NL → Spec → SocialArtifact → author → need → claim → location → freshness → verify → qualify", () => {
    const query = "people recently asking for website help in Austin";
    const spec = extractSearchSpec(query);
    expect(spec.entity).toBe("person");
    expect(spec.signal_required).toBe(true);
    expect(spec.signal_types).toEqual(
      expect.arrayContaining(["service_request", "social_ask"]),
    );
    expect(spec.signal_recency).toBe("90d");

    const hit = {
      title: "Looking for a web designer",
      url: "https://reddit.com/r/Austin/comments/prod1/need_designer",
      excerpt: "I need someone to redesign our website",
      author: "mir_dev",
      subreddit: "Austin",
      created_utc: YESTERDAY_UTC,
    };
    const artifact = socialArtifactFromHit(hit, {
      observed_at: new Date(NOW).toISOString(),
    });
    expect(artifact.posted_at).toBeTruthy();
    expect(artifact.community).toBe("Austin");

    const need = detectSocialNeed(artifact.text);
    expect(need.is_ask).toBe(true);

    const author = resolveSocialAuthor(artifact, {
      resolveRealWorld: resolveAuthor,
    });
    expect(author.status).toBe("resolved");

    const pipeline = socialArtifactToSpecRow(artifact, spec, {
      resolveAuthor: resolveAuthor,
      // Subreddit is NOT location — only proven author geo.
      authorLocations: { "person:mir-dev": "Austin" },
      observed_at: new Date(NOW).toISOString(),
    });
    expect(pipeline.row).not.toBeNull();
    expect(pipeline.row!.entity_id).toBe("person:mir-dev");
    expect(pipeline.row!.location).toBe("Austin");
    expect(pipeline.row!.page_type).toBe("social_post");
    expect(pipeline.row!.evidence?.[0]?.event_at).toBe(artifact.posted_at);
    expect(pipeline.row!.evidence?.[0]?.subject).toBe("person:mir-dev");

    const verified = verifyCandidateClaims({
      evidence: pipeline.row!.evidence ?? [],
      entityId: pipeline.row!.entity_id!,
      spec,
      nowMs: NOW,
    });
    expect(verified.ok).toBe(true);

    const q = qualifyLead(pipeline.row!, spec, pipeline.row!.evidence);
    expect(q.disposition).toBe("qualified");

    const run = createSearchRun();
    const projected = projectQualifiedLead({
      row: { ...pipeline.row!, disposition: "qualified" },
      spec,
      run,
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.lead.entity_id).toBe("person:mir-dev");
    expect(projected.lead.evidence.length).toBeGreaterThan(0);
  });

  it("OSS-style hit must adapt through SocialArtifact — never invent a lead object", () => {
    const spec = extractSearchSpec("people asking for website help");
    // Simulate a third-party collector payload shaped unlike our SpecRow.
    const ossHit = {
      title: "Can anyone recommend a copywriter?",
      url: "https://reddit.com/r/forhire/comments/oss1/x",
      excerpt: "budget friendly",
      author: "mir_dev",
      created_utc: YESTERDAY_UTC,
      subreddit: "forhire",
    };
    const rows = socialHitsToSpecRows([ossHit], spec, {
      resolveAuthor: resolveAuthor,
    });
    // copywriter ask vs website Spec → filtered by need match
    expect(rows.length).toBe(0);

    const websiteOss = {
      ...ossHit,
      title: "Looking for a web designer",
      excerpt: "need website help",
      url: "https://reddit.com/r/forhire/comments/oss2/x",
    };
    const ok = socialHitsToSpecRows([websiteOss], spec, {
      resolveAuthor: resolveAuthor,
    });
    expect(ok).toHaveLength(1);
    expect(ok[0]!.kind).toBe("person");
    expect(ok[0]!.page_type).toBe("social_post");
  });
});
