/**
 * Gate 1 unit tests.
 *
 * These cover the parts of the understanding layer that are deterministic:
 * the validator's invariants, the frame-native fallback extractor, and the
 * monotonicity of clarification. Nothing here calls an LLM — the model's
 * judgement is graded by scripts/verify-understanding.mts and, ultimately, by
 * reading the frames.
 *
 * The distinction matters: a test here failing is a logic bug. A grader case
 * failing may just be a model being wrong today.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BLOCKING_FIELDS,
  initState,
  nextQuestion,
  patchFrame,
  syncClarification,
  unresolvedFields,
} from "./clarify-state";
import { extractFrameDeterministic } from "./fallback";
import { emptyFrame, openValue, type UnderstandingFrame } from "./frame";
import { validateFrame } from "./validate";

// ── Helpers ───────────────────────────────────────────────────────────────

function frameOf(query: string): UnderstandingFrame {
  const { frame } = validateFrame(extractFrameDeterministic(query));
  return syncClarification(frame);
}

/** "error" is the blocking severity — see validate.ts `hasBlockingViolation`. */
function blocking(frame: UnderstandingFrame) {
  return validateFrame(frame).violations.filter((v) => v.severity === "error");
}

/** The semantic core the grader compares pairs on. Kept in the test so a
 *  change to either definition has to be made twice, on purpose. */
function core(f: UnderstandingFrame): string {
  return JSON.stringify({
    entity: f.target.entity_type.value,
    role: f.target.role?.value?.toLowerCase() ?? null,
    category: f.target.category?.value?.toLowerCase() ?? null,
    relation: f.relation.type.value,
    object: f.relation.object?.value?.toLowerCase() ?? null,
    direction: f.relation.direction.value,
    claim: f.evidence.claim_evidence_required,
    intent: f.evidence.intent_signal_required,
  });
}

// ── Isolation ─────────────────────────────────────────────────────────────

/**
 * Gate 1 understands and stops. The moment this layer can reach a database, a
 * search engine, a map or an enricher, the next person debugging a wrong frame
 * is debugging retrieval instead — and the whole reason for building it apart
 * is gone. Reaching the AI router is the one outside call it may make.
 *
 * Checked over source text rather than by loading the modules: an import that
 * only runs on the server, or one behind a dynamic `import()`, still couples
 * the two and would pass a runtime check.
 */
describe("the understanding layer stays isolated", () => {
  const dir = join(process.cwd(), "src/lib/understanding");
  const forbidden = [
    { what: "a database", re: /supabase|\bpg\b|postgres|drizzle|prisma|from\s+["'].*\/db\b/i },
    { what: "a search engine", re: /searxng|meilisearch|serp/i },
    { what: "maps", re: /overpass|nominatim|openstreetmap|\bosm\b/i },
    { what: "a browser", re: /playwright|puppeteer|crawl|scrape/i },
    { what: "enrichment", re: /enrich/i },
    { what: "the legacy parser", re: /extractSearchSpec|spec-search/ },
  ];

  /**
   * The two pure helpers this layer is allowed to borrow. They resolve a place
   * name and normalize a role string — no I/O, no ranking, no notion of a
   * result — and they live under `lib/search/` by history, not by function.
   * Anything else under that directory is retrieval and belongs on the far
   * side of the gate.
   */
  const allowedSearchModules = ["@/lib/search/location-resolver", "@/lib/search/search-spec-extract"];

  /**
   * The server function has to know who is calling, and the auth middleware is
   * the only way to ask. It reads a session, not a table — so it is named here
   * as a single allowed module rather than by loosening the database rule,
   * which would let a real query in behind it.
   */
  const allowedAuthModule = "@/integrations/my-supabase/auth-middleware";

  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file} reaches nothing but the AI router`, () => {
      const src = readFileSync(join(dir, file), "utf8");
      // Only import/require lines. Prose in a comment may name these freely —
      // it is how the boundary gets explained.
      const imports = src
        .split("\n")
        .filter((l) => /^\s*(import|export .*from|.*await import\()/.test(l))
        .filter((l) => !l.includes(allowedAuthModule))
        .join("\n");
      for (const f of forbidden) {
        expect(f.re.test(imports), `${file} imports ${f.what}: ${imports.match(f.re)?.[0]}`).toBe(
          false,
        );
      }
      for (const m of imports.match(/@\/lib\/search\/[\w./-]+/g) ?? []) {
        expect(allowedSearchModules, `${file} reaches into retrieval via ${m}`).toContain(m);
      }
    });
  }
});

// ── Validator invariants ──────────────────────────────────────────────────

describe("validator", () => {
  it("accepts a person as the actor of a hiring relation", () => {
    // The rule this replaced ("hiring ⇒ subject is employer-shaped") broke
    // the brief's own example: a founder hires on behalf of their company.
    const f = emptyFrame("founders in SF hiring developers");
    f.target.entity_type = { value: "person", raw: "founders", confidence: 0.9 };
    f.target.role = openValue("founder");
    f.relation.type = { value: "hiring", raw: "hiring", confidence: 0.9 };
    f.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.9 };
    f.relation.object = openValue("developer");

    expect(blocking(f)).toHaveLength(0);
    // And the subject stays a person. Rewriting it to "company" so the old
    // "hiring ⇒ employer-shaped subject" rule could hold is the bug this
    // replaced: it loses the fact that we are looking for founders.
    expect(validateFrame(f).frame.target.entity_type.value).toBe("person");
  });

  it("rejects a contradictory direction rather than the actor's shape", () => {
    // "developers looking for jobs" is seeking_job, not hiring. A frame that
    // says hiring with the object pointing back at the subject is incoherent.
    const f = emptyFrame("developers looking for jobs");
    f.target.entity_type = { value: "person", raw: "developers", confidence: 0.9 };
    f.target.role = openValue("developer");
    f.relation.type = { value: "hiring", raw: null, confidence: 0.6 };
    f.relation.direction = { value: "object_to_subject", raw: null, confidence: 0.6 };

    expect(blocking(f).map((v) => v.code)).toContain("CONTRADICTORY_DIRECTION");
  });

  it("does not represent a discovered job posting as an actor seeking employment", () => {
    const f = emptyFrame("marine biologist job postings in Uppsala from the last month");
    f.task_type = { value: "job_discovery", raw: null, confidence: 0.9 };
    f.prospecting_mode = { value: "job_based", raw: null, confidence: 0.9 };
    f.target.entity_type = { value: "job", raw: "job postings", confidence: 0.95 };
    f.target.job_title = openValue("marine biologist", "marine biologist");
    f.relation.type = { value: "seeking_job", raw: null, confidence: 0.8 };
    f.relation.object = openValue("employment", null, "employment");
    f.relation.direction = { value: "none", raw: null, confidence: 0.8 };
    f.evidence.claim_evidence_required = true;
    f.evidence.intent_signal_required = true;

    const out = validateFrame(f);
    expect(out.frame.relation.type.value).toBe("none");
    expect(out.frame.relation.object).toBeNull();
    expect(out.frame.relation.direction.value).toBe("none");
    expect(out.frame.target.job_title?.value).toBe("marine biologist");
    expect(out.frame.evidence).toMatchObject({
      claim_evidence_required: true,
      intent_signal_required: false,
    });
    expect(out.repairs).toContainEqual(
      expect.objectContaining({ code: "JOB_POSTING_RELATION_NONE", path: "relation.type" }),
    );
  });

  it("applies the job-posting relation invariant inside compound subgoals", () => {
    const f = emptyFrame(
      "find ceramic engineer job listings in Limoges and conservators looking for work in Graz",
    );
    const posting = emptyFrame("ceramic engineer job listings in Limoges");
    posting.target.entity_type = { value: "job", raw: "job listings", confidence: 0.9 };
    posting.target.job_title = openValue("ceramic engineer", "ceramic engineer");
    posting.relation.type = { value: "hiring", raw: null, confidence: 0.7 };
    posting.relation.object = openValue("ceramic engineer");
    posting.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.7 };
    const seeker = emptyFrame("conservators looking for work in Graz");
    seeker.target.entity_type = { value: "person", raw: "conservators", confidence: 0.9 };
    seeker.target.role = openValue("conservator", "conservators");
    seeker.relation.type = { value: "seeking_job", raw: "looking for work", confidence: 0.9 };
    seeker.relation.object = openValue("employment", "work");
    seeker.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.9 };
    f.compound = {
      is_compound: true,
      subgoals: [
        {
          raw: posting.input.raw,
          target: posting.target,
          relation: posting.relation,
          location: null,
          temporal: null,
          constraints: [],
        },
        {
          raw: seeker.input.raw,
          target: seeker.target,
          relation: seeker.relation,
          location: null,
          temporal: null,
          constraints: [],
        },
      ],
    };

    const out = validateFrame(f);
    expect(out.frame.compound.subgoals[0]?.relation.type.value).toBe("none");
    expect(out.frame.compound.subgoals[0]?.relation.object).toBeNull();
    expect(out.frame.compound.subgoals[1]?.relation.type.value).toBe("seeking_job");
    expect(out.repairs).toContainEqual(
      expect.objectContaining({
        code: "JOB_POSTING_RELATION_NONE",
        path: "compound.subgoals[0].relation.type",
      }),
    );
  });

  it("requires a label when a relation is custom and nothing names it", () => {
    // Accreditation by a regulator is a real relationship and genuinely not a
    // member of our ontology, so custom is the honest answer here.
    const f = emptyFrame("clinics accredited by the CQC");
    f.relation.type = { value: "custom", raw: null, confidence: 0.8 };
    f.relation.label = null;
    // A custom relation is still a relation: it acts on something, and which
    // way round it acts is a real question.
    f.relation.object = openValue("CQC");
    f.relation.direction = { value: "object_to_subject", raw: null, confidence: 0.8 };

    const v = validateFrame(f).violations;
    expect(v.some((x) => x.code === "CUSTOM_RELATION_WITHOUT_LABEL")).toBe(true);

    f.relation.label = "accredited by the CQC";
    expect(blocking(f)).toHaveLength(0);
    // custom is understood-but-nonstandard; it must not be downgraded to
    // unknown, which would trigger a clarification we do not need.
    expect(validateFrame(f).frame.relation.type.value).toBe("custom");
  });

  it("labels a custom relation from the span its type was read off", () => {
    // The label is where a custom relation's meaning lives, and `type.raw` is
    // the wording the type was read from — so it is recoverable exactly.
    // Charging a violation for not repeating one span into two fields tells a
    // reader nothing they did not already have.
    const f = emptyFrame("clinics accredited by the CQC");
    f.relation.type = { value: "custom", raw: "accredited by the CQC", confidence: 0.8 };
    f.relation.label = null;
    f.relation.object = openValue("CQC");
    f.relation.direction = { value: "object_to_subject", raw: null, confidence: 0.8 };

    const out = validateFrame(f);
    expect(out.frame.relation.label).toBe("accredited by the CQC");
    expect(out.repairs.map((r) => r.code)).toContain("CUSTOM_RELATION_LABEL_FROM_RAW");
    expect(out.violations.some((x) => x.code === "CUSTOM_RELATION_WITHOUT_LABEL")).toBe(false);
  });

  it("renames a custom relation our ontology already has a member for", () => {
    // Two live frames read "partnered with X" correctly and then reached for
    // the escape hatch instead of `partnered_with`; each failed a different way
    // (one kept the object and no label, the other the label and no object).
    // The wording is re-read by the same reader the deterministic extractor
    // uses, so the member a frame is GIVEN and the member it is GRADED against
    // cannot disagree about the same three words.
    for (const [raw, want] of [
      ["partnered with Contentful", "partnered_with"],
      ["using Shopify", "uses_technology"],
      ["attending Web Summit", "attending_event"],
    ] as const) {
      const f = emptyFrame(`businesses ${raw}`);
      f.target.entity_type = { value: "company", raw: "businesses", confidence: 0.9 };
      f.relation.type = { value: "custom", raw, confidence: 0.82 };
      f.relation.label = raw;
      f.relation.object = null;
      f.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.8 };

      const out = validateFrame(f);
      expect(out.frame.relation.type.value, raw).toBe(want);
      // The object the model omitted is filled from the same re-read, so the
      // relation is complete rather than merely renamed.
      expect(out.frame.relation.object?.value, raw).toBeTruthy();
      expect(out.frame.relation.label, raw).toBeNull();
      expect(out.repairs.map((r) => r.code)).toContain("CUSTOM_RELATION_IS_A_MEMBER");
      expect(blocking(out.frame)).toHaveLength(0);
    }
  });

  it("leaves a genuinely custom relation custom", () => {
    // The escape hatch has to keep working, or every unfamiliar relationship
    // gets forced into the nearest member and the frame states something the
    // user did not.
    for (const raw of ["accredited by the CQC", "regulated by the FCA", "franchisees of a national chain"]) {
      const f = emptyFrame(`businesses ${raw}`);
      f.target.entity_type = { value: "company", raw: "businesses", confidence: 0.9 };
      f.relation.type = { value: "custom", raw, confidence: 0.8 };
      f.relation.label = raw;
      f.relation.object = openValue(raw.split(/\s+/).pop() ?? raw);
      f.relation.direction = { value: "object_to_subject", raw: null, confidence: 0.8 };

      const out = validateFrame(f);
      expect(out.frame.relation.type.value, raw).toBe("custom");
      expect(out.frame.relation.label, raw).toBe(raw);
    }
  });

  it("never raises a violation for an unrecognized descriptor", () => {
    // Open vocabularies are the whole point: a role nobody predicted is not
    // an error, it is Tuesday.
    const f = emptyFrame("find me quantum cryptography auditors in Tallinn");
    f.target.entity_type = { value: "person", raw: null, confidence: 0.8 };
    f.target.role = openValue("quantum cryptography auditor");
    f.target.industry = openValue("post-quantum security");
    f.relation.type = { value: "none", raw: null, confidence: 0.7 };

    expect(validateFrame(f).violations).toHaveLength(0);
  });

  it("flags a compound frame that kept only one half", () => {
    const f = emptyFrame("startups hiring rust devs and founders asking for design help");
    f.compound = { is_compound: true, subgoals: [] };
    const v = validateFrame(f).violations;
    expect(v.some((x) => x.code === "COMPOUND_WITHOUT_SUBGOALS")).toBe(true);
  });

  it("demands an intent signal when the relation is a need, not an attribute", () => {
    // "agencies" is an attribute of the entity; "needing marketing" is a
    // current want. Conflating them is what the evidence split exists for.
    const attribute = frameOf("marketing agencies around bristol");
    const need = frameOf("companies around bristol needing marketing");

    expect(attribute.evidence.intent_signal_required).toBe(false);
    expect(need.evidence.intent_signal_required).toBe(true);
  });

  it("takes the search's direction from the place's own preposition", () => {
    // A model answered "outside Trois-Rivières" with scope "in", which is the
    // reverse of the request. Repaired, not questioned: the span says which
    // way round it goes, so there is no ambiguity to resolve.
    const f = emptyFrame("find me 20 optometrists outside trois-rivières");
    f.target.entity_type = { value: "person", raw: "optometrists", confidence: 0.9 };
    f.location = {
      value: "Trois-Rivières",
      raw: "outside trois-rivières",
      scope: "in",
      radius: null,
      radius_unit: null,
      country_code: null,
      canonical: null,
      confidence: 0.8,
    };

    const out = validateFrame(f);
    expect(out.frame.location?.scope).toBe("near");
    expect(out.repairs.some((r) => r.code === "LOCATION_SCOPE_FROM_RAW")).toBe(true);
    // The deterministic reader answers the same sentence the same way — the
    // cue list is shared so the two cannot drift apart.
    expect(frameOf("find me 20 optometrists outside trois-rivières").location?.scope).toBe("near");
  });

  it("reads a near cue as a scope rather than leaving it unknown", () => {
    // The same wording came back `in` on one run and `unknown` on the next, so
    // the repair that fixed the first left the second alone — and "unknown" is
    // the more misleading of the two: it reads as the user never saying where
    // to look, when they said which way to look from a place.
    const f = emptyFrame("any bakeries outside ghent");
    f.location = {
      value: "Ghent",
      raw: "outside ghent",
      scope: "unknown",
      radius: null,
      radius_unit: null,
      country_code: null,
      canonical: null,
      confidence: 0.8,
    };

    const out = validateFrame(f);
    expect(out.frame.location?.scope).toBe("near");
    expect(out.repairs.some((r) => r.code === "LOCATION_SCOPE_FROM_RAW")).toBe(true);
  });

  it("narrows a field family back to the channel the request names", () => {
    // "insta if possible" came back as `socials`, which asks for three columns
    // where the user named one and judges a row incomplete for missing a
    // channel nobody mentioned.
    const f = emptyFrame("find 40 cobblers near turku, insta if possible");
    f.preferred_fields = [{ value: "socials", raw: "insta", normalized: null, confidence: 0.7 }];

    const out = validateFrame(f);
    expect(out.frame.preferred_fields.map((p) => p.value)).toEqual(["instagram"]);
    expect(out.frame.preferred_fields[0]?.raw).toBe("insta");
    expect(out.repairs.some((r) => r.code === "FIELD_NARROWED_TO_NAMED_CHANNEL")).toBe(true);
  });

  it("leaves a family alone when the request named the family", () => {
    // The repair only ever narrows. "socials if possible" asks for the family,
    // and rewriting it to one channel would drop two the user did want.
    const f = emptyFrame("find 40 cobblers near turku, socials if possible");
    f.preferred_fields = [
      { value: "socials", raw: "socials", normalized: null, confidence: 0.7 },
    ];

    const out = validateFrame(f);
    expect(out.frame.preferred_fields.map((p) => p.value)).toEqual(["socials"]);
    expect(out.repairs.some((r) => r.code === "FIELD_NARROWED_TO_NAMED_CHANNEL")).toBe(false);
  });

  it("reads the pitch through an ordinary 'help me find' opener", () => {
    // Two independent defects met on this sentence. "help" was the one
    // politeness word missing from the filler list beside "gimme", "show" and
    // "send", so the prefix read as content and the pitch was refused as a
    // prospect attribute. Separately, the request clause was sliced from the
    // FIRST imperative, and this opener puts one in front of the pitch — so
    // the pitch stayed in the analysed text and the target scan met "packaging
    // design" where the café was. The request begins at the imperative that
    // stands AFTER the pitch.
    const f = frameOf(
      "help me find ok so i do packaging design n im tryna find like board game cafés around trois-rivières that dont got a site",
    );

    expect(f.user_context.selling?.service?.value).toBe("packaging design");
    expect(f.target.entity_type.value).toBe("business");
    expect(f.location?.value?.toLowerCase()).toContain("trois-rivi");
    expect(f.clarification.needed).toBe(false);
  });

  it("keeps a hedged ask out of the requirements, however it is spelled", () => {
    // A required field is a filter, so this misread drops rows the user would
    // have accepted. Both extractors made it: the model answered `required`,
    // and the deterministic marker read "would b great" as unhedged because it
    // only knew "would be great".
    const f = emptyFrame("saunas around leipzig, phone would b great");
    f.required_fields = [
      { value: "phone", raw: "phone would b great", normalized: null, confidence: 0.5 },
    ];

    const out = validateFrame(f);
    expect(out.frame.required_fields).toEqual([]);
    expect(out.frame.preferred_fields.map((p) => p.value)).toEqual(["phone"]);
    expect(out.repairs.some((r) => r.code === "FIELD_HEDGED_NOT_REQUIRED")).toBe(true);

    const det = frameOf("find saunas around leipzig, phone would b great");
    expect(det.preferred_fields.map((p) => p.value)).toContain("phone");
    expect(det.required_fields.map((p) => p.value)).not.toContain("phone");
  });

  it("recovers an ask the extraction read past", () => {
    // The same model kept "+ founders names if u can" on one sentence and
    // dropped it on the same sentence about another trade. Nothing else in the
    // frame disagrees with the loss, so no invariant fires and the run reads as
    // a clean pass with a stated wish gone.
    const f = emptyFrame("need satellite imaging startups ann arbor funded this yr + founders names if u can");

    const out = validateFrame(f);
    expect(out.frame.preferred_fields.map((p) => p.value)).toEqual(["owner_name"]);
    expect(out.frame.required_fields.map((p) => p.value)).toEqual([]);
    expect(out.repairs.some((r) => r.code === "FIELD_RECOVERED_FROM_INPUT")).toBe(true);
  });

  it("recovers nothing the request did not name", () => {
    // The recovery re-runs the deterministic reader, which wants a marker word
    // AND a field the vocabulary knows. A request that asks for no columns must
    // gain none — a recovered field is a filter or a promise, not a default.
    for (const q of ["cafes in Porto", "orthotics clinics daugavpils pls", "companies in Pereira hiring audiologists"]) {
      const out = validateFrame(emptyFrame(q));
      expect(out.frame.required_fields, q).toEqual([]);
      expect(out.frame.preferred_fields, q).toEqual([]);
    }
  });

  it("does not recover the two fields the reader infers", () => {
    // `name` is implied by every request and `evidence` restates a verification
    // ask that lives in its own list, so the deterministic reader supplies both
    // without the user naming either. Importing an inference would invent the
    // requirement this repair exists to stop losing.
    const f = emptyFrame(
      "Give me 25 chocolatiers in Timișoara, phone number required, Instagram if possible, verify they are currently open",
    );

    const out = validateFrame(f);
    expect(out.frame.required_fields.map((p) => p.value)).toEqual(["phone"]);
    expect(out.frame.preferred_fields.map((p) => p.value)).toEqual(["instagram"]);
  });

  it("leaves a field the extraction already carried alone", () => {
    // Recovery is additive and keyed on the canonical name, so a field the
    // model recorded — under its own spelling — must not appear twice.
    const f = emptyFrame("find 40 cobblers near turku, insta if possible");
    f.preferred_fields = [{ value: "instagram", raw: "insta", normalized: null, confidence: 0.7 }];

    const out = validateFrame(f);
    expect(out.frame.preferred_fields.map((p) => p.value)).toEqual(["instagram"]);
    expect(out.repairs.some((r) => r.code === "FIELD_RECOVERED_FROM_INPUT")).toBe(false);
  });

  it("leaves a plainly stated ask where the extractor put it", () => {
    // The repair only ever demotes. "phone required" is a filter the user asked
    // for, and a field asked for plainly is commonly preferred too — promoting
    // those would invent the very filter this repair removes.
    const f = emptyFrame("saunas around leipzig, phone required");
    f.required_fields = [{ value: "phone", raw: "phone required", normalized: null, confidence: 0.9 }];

    const out = validateFrame(f);
    expect(out.frame.required_fields.map((p) => p.value)).toEqual(["phone"]);
    expect(out.repairs.some((r) => r.code === "FIELD_HEDGED_NOT_REQUIRED")).toBe(false);
  });

  it("still refuses a prospect's own trade as the searcher's pitch", () => {
    // The guard the line above relaxes: a noun in front of the verb means the
    // clause describes the PROSPECTS, and reading it as the pitch would assert
    // the searcher sells waste haulage.
    const f = frameOf("find companies that do waste haulage in kaunas");
    expect(f.user_context.selling).toBeNull();
  });

  it("refuses to let one word narrow the target twice", () => {
    // A seed library lends seeds. The model kept the whole phrase as the
    // category and then cut "seed" back out of it as a funding stage, which
    // claims these places took seed money and would filter to startups.
    const f = emptyFrame("seed libraries in ann arbor");
    f.target.entity_type = { value: "business", raw: "seed libraries", confidence: 0.9 };
    f.target.category = openValue("seed library", "seed libraries");
    f.target.company_stage = openValue("seed", "seed");

    const out = validateFrame(f);
    expect(out.frame.target.category?.value).toBe("seed library");
    expect(out.frame.target.company_stage).toBeNull();
    expect(out.repairs.some((r) => r.code === "SPAN_HARVESTED_TWICE")).toBe(true);
  });

  it("gives a tied span to the relation that stated it", () => {
    // "firms that provide voiceover" says what the firms DO in a clause. A
    // category of the same word filters on it a second time, and the head noun
    // is all the target itself claimed.
    const f = emptyFrame("firms in hsinchu that provide voiceover");
    f.target.entity_type = { value: "company", raw: "firms", confidence: 0.9 };
    f.target.category = openValue("voiceover", "voiceover");
    f.relation.type = { value: "offers_service", raw: "provide", confidence: 0.9 };
    f.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.9 };
    f.relation.object = openValue("voiceover", "voiceover");

    const out = validateFrame(f);
    expect(out.frame.relation.object?.value).toBe("voiceover");
    expect(out.frame.target.category).toBeNull();
  });

  it("keeps two qualifiers that sit side by side", () => {
    // The guard fires on containment, not on adjacency: "seed-stage fintechs"
    // genuinely states a stage AND an industry, and dropping either narrows
    // the search to a population the user did not ask for.
    const f = emptyFrame("seed-stage fintechs in tallinn");
    f.target.entity_type = { value: "company", raw: "fintechs", confidence: 0.9 };
    f.target.category = openValue("fintech", "fintechs");
    f.target.company_stage = openValue("seed-stage", "seed-stage");

    const out = validateFrame(f);
    expect(out.frame.target.category?.value).toBe("fintech");
    expect(out.frame.target.company_stage?.value).toBe("seed-stage");
    expect(out.repairs.some((r) => r.code === "SPAN_HARVESTED_TWICE")).toBe(false);
  });
});

// ── Dangerous pairs ───────────────────────────────────────────────────────

describe("adversarial pairs produce different frames", () => {
  const pairs: [string, string][] = [
    [
      "need some robotics founders around trondheim tryna hire embedded engineers rn",
      "embedded engineers in trondheim looking for jobs",
    ],
    ["marketing agencies around bristol", "companies around bristol needing marketing"],
    ["web design studios in austin", "businesses in austin that need a new website"],
    ["seo consultants in leeds", "companies in leeds hiring seo consultants"],
    ["investors funding climate startups", "climate startups raising a seed round"],
  ];

  for (const [a, b] of pairs) {
    it(`"${a}" ≠ "${b}"`, () => {
      // The deterministic extractor is the floor. If IT collapses a pair, no
      // amount of model quality rescues the layer on a fallback day.
      expect(core(frameOf(a))).not.toBe(core(frameOf(b)));
    });
  }
});

// ── Deterministic fallback ────────────────────────────────────────────────

describe("deterministic fallback", () => {
  it("asks about an unreadable target rather than inventing a relationship", () => {
    // Nothing here names a relationship, so `none` is the honest answer and
    // `unknown` would be a lie about a failed parse. What IS missing is the
    // thing to look for, and that is what the clarification must be about.
    const f = frameOf("stuff about things maybe");
    expect(f.relation.type.value).toBe("none");
    expect(f.clarification.needed).toBe(true);
    expect(f.clarification.reason).toBe("missing_target");
    expect(f.meta.extractor).toBe("deterministic");
  });

  it("admits an unreadable relation when the wording clearly asks for one", () => {
    // The other half of the same rule: relationship wording we cannot parse is
    // `unknown`, and that IS worth a question.
    const f = frameOf("companies around porto doing that thing with creators");
    expect(f.relation.type.value).toBe("unknown");
    expect(f.clarification.needed).toBe(true);
    expect(f.clarification.reason).toBe("unreadable_relation");
  });

  it("marks itself as deterministic and not as an LLM fallback", () => {
    // fallback_used means "the LLM path was attempted and lost". Calling the
    // deterministic extractor directly is not that, and reporting it as such
    // would make the inspector's Fallback line meaningless.
    const f = extractFrameDeterministic("plumbers in toronto");
    expect(f.meta.extractor).toBe("deterministic");
    expect(f.meta.fallback_used).toBe(false);
  });

  it("keeps a negation as a structured constraint, not prose", () => {
    const f = frameOf("marketing agencies in toronto, not agencies with no website");
    expect(f.constraints.length).toBeGreaterThan(0);
    expect(f.constraints.some((c) => c.negated)).toBe(true);
  });

  it("reads a radius as a number and a unit", () => {
    const f = frameOf("dentists within 30 miles of denver");
    expect(f.location?.scope).toBe("within_radius");
    expect(f.location?.radius).toBe(30);
    expect(f.location?.radius_unit).toBe("miles");
  });

  it("produces a schema-valid frame for arbitrary noise", () => {
    // Every frame that leaves this layer must validate, including the ones
    // built from gibberish — a throw here becomes a 500 in the inspector.
    for (const noise of ["", "?????", "🙂🙂🙂", "a".repeat(500), "SELECT * FROM users;"]) {
      expect(() => frameOf(noise)).not.toThrow();
    }
  });
});

// ── Lead-engine axes ──────────────────────────────────────────────────────

/**
 * These are the invariants the first deterministic run got wrong, and each one
 * is a general rule rather than a fix for the sentence it is written with: a
 * mode follows from a relation, a span belongs to exactly one field, and a
 * request the user made must appear somewhere in the frame.
 */
describe("plain entity discovery", () => {
  for (const q of [
    "cafes in San Francisco",
    "coffee roasters near Copenhagen",
    "law firms across Ontario",
    "restaurants in Lisbon",
    "marketing agencies in Bristol",
  ]) {
    it(`"${q}" is executable without a question`, () => {
      const f = frameOf(q);
      expect(f.task_type.value).toBe("lead_discovery");
      // An invented need is the failure this asserts against: asking what
      // should be true of the restaurants is the layer not reading English.
      expect(["none", "offers_service"]).toContain(f.relation.type.value);
      expect(f.clarification.needed).toBe(false);
      expect(f.location?.value).toBeTruthy();
    });
  }

  it("a bare request is executable but says its scope is unbounded", () => {
    const f = frameOf("find businesses");
    expect(f.target.entity_type.value).toBe("business");
    expect(f.relation.type.value).toBe("none");
    expect(f.clarification.reason).toBe("underspecified_scope");
  });
});

describe("prospecting mode follows the relation", () => {
  const cases: [string, string][] = [
    ["coffee roasters within 15 km of Copenhagen", "fit_based"],
    ["coffee shops without websites", "opportunity_based"],
    ["companies looking for marketing help", "intent_based"],
    ["companies hiring React developers", "hiring_based"],
    ["recently funded AI startups", "event_based"],
  ];
  for (const [q, mode] of cases) {
    it(`"${q}" is ${mode}`, () => {
      expect(frameOf(q).prospecting_mode.value).toBe(mode);
    });
  }
});

describe("subject anchoring", () => {
  it("keeps the requested noun as the target, not the profession in the clause", () => {
    const f = frameOf("businesses looking for web designers");
    expect(f.target.entity_type.value).toBe("business");
    expect(f.relation.type.value).toBe("needs_service");
    expect(f.relation.object?.value).toContain("web designer");
  });

  it("reads a supplier advertising for work as seeking clients", () => {
    const f = frameOf("web designers looking for clients");
    expect(f.target.entity_type.value).toBe("person");
    expect(f.target.role?.value).toContain("web designer");
    expect(f.relation.type.value).toBe("seeking_client");
  });
});

describe("spans do not overlap", () => {
  it("claims the complete funding clause before reading a location", () => {
    const f = frameOf("haulage startups in Surabaya raising money");
    expect(f.location?.value).toBe("Surabaya");
    expect(f.location?.raw).toBe("in Surabaya");
    expect(f.relation.type.value).toBe("seeking_funding");
  });

  it("keeps legitimate multi-token and ordinary-word place names intact", () => {
    for (const [prompt, place] of [
      ["companies in New York hiring designers", "New York"],
      ["firms in Ho Chi Minh City seeking funding", "Ho Chi Minh City"],
      ["businesses near Salt Lake City with no website", "Salt Lake City"],
      ["companies in Money, Mississippi", "Money Mississippi"],
    ]) {
      expect(frameOf(prompt).location?.value).toBe(place);
    }
  });

  it("stops the location at the clause boundary", () => {
    const f = frameOf("robotics founders around Trondheim trying to hire embedded engineers right now");
    expect(f.location?.value).toBe("Trondheim");
    expect(f.location?.raw ?? "").not.toMatch(/hire|engineer/i);
    expect(f.relation.type.value).toBe("hiring");
    expect(f.temporal?.relation).toBe("current");
  });

  it("never files a time phrase as a place", () => {
    const f = frameOf("companies that posted a marketing role in the last two weeks");
    expect(f.temporal?.relation).toBe("within_last");
    expect(f.location).toBeNull();
    // The rule is about the value, not about this sentence: whatever ends up
    // in location must not be a duration.
    expect(f.location?.value ?? "").not.toMatch(/week|month|day|year/i);
  });
});

describe("temporal granularity stays exact", () => {
  const calendarCases = [
    ["ceramic studios in Faenza active this week", "this_week"],
    ["marine surveyors in Bergen hiring this month", "this_month"],
    ["cooperatives in Cordoba funded this quarter", "this_quarter"],
    ["founders attending Slush this year", "this_year"],
    ["glassblower openings in Liege last week", "last_week"],
    ["hydrologist job listings in Cuenca last month", "last_month"],
    ["robotics firms in Brno funded last quarter", "last_quarter"],
    ["publishers in Tartu that partnered last year", "last_year"],
  ] as const;

  for (const [query, relation] of calendarCases) {
    it(`preserves ${relation} in "${query}"`, () => {
      const temporal = frameOf(query).temporal;
      expect(temporal?.relation).toBe(relation);
      expect(temporal?.window).toBeNull();
    });
  }

  const rollingCases = [
    ["clinics posting roles within the last 30 days", "30d"],
    ["foundries hiring over the last 6 weeks", "6w"],
    ["aquaculture startups funded in the last 3 months", "3m"],
  ] as const;

  for (const [query, window] of rollingCases) {
    it(`keeps "${query}" as the rolling window ${window}`, () => {
      const temporal = frameOf(query).temporal;
      expect(temporal?.relation).toBe("within_last");
      expect(temporal?.window).toBe(window);
    });
  }

  it("repairs a model's nearest-enum substitution from temporal provenance", () => {
    const f = emptyFrame("forensic entomologist job listings in Tartu posted this month");
    f.temporal = {
      relation: "this_quarter",
      window: null,
      year: null,
      raw: "this month",
      confidence: 0.9,
    };

    const out = validateFrame(f);
    expect(out.frame.temporal).toMatchObject({
      relation: "this_month",
      window: null,
      year: null,
      raw: "this month",
    });
    expect(out.repairs).toContainEqual(
      expect.objectContaining({ code: "TEMPORAL_FROM_RAW", path: "temporal.relation" }),
    );
  });

  it("applies temporal provenance invariants recursively to compound subgoals", () => {
    const f = emptyFrame(
      "find violin makers in Cremona active this week and seed libraries in Ghent opened last month",
    );
    const first = emptyFrame("violin makers in Cremona active this week");
    first.temporal = {
      relation: "within_last",
      window: "1w",
      year: null,
      raw: "this week",
      confidence: 0.8,
    };
    const second = emptyFrame("seed libraries in Ghent opened last month");
    second.temporal = {
      relation: "within_last",
      window: "1m",
      year: null,
      raw: "last month",
      confidence: 0.8,
    };
    f.compound = {
      is_compound: true,
      subgoals: [
        {
          raw: first.input.raw,
          target: first.target,
          relation: first.relation,
          location: null,
          temporal: first.temporal,
          constraints: [],
        },
        {
          raw: second.input.raw,
          target: second.target,
          relation: second.relation,
          location: null,
          temporal: second.temporal,
          constraints: [],
        },
      ],
    };

    const out = validateFrame(f);
    expect(out.frame.compound.subgoals[0]?.temporal?.relation).toBe("this_week");
    expect(out.frame.compound.subgoals[0]?.temporal?.window).toBeNull();
    expect(out.frame.compound.subgoals[1]?.temporal?.relation).toBe("last_month");
    expect(out.frame.compound.subgoals[1]?.temporal?.window).toBeNull();
  });
});

describe("quantity survives", () => {
  it("reads a bare count as the requested amount", () => {
    expect(frameOf("give me 50 restaurants in Lisbon").quantity?.requested).toBe(50);
  });

  it("reads a floor as a minimum", () => {
    expect(frameOf("i need at least 25 dental practices in Malmo").quantity?.minimum).toBe(25);
    expect(frameOf("100+ businesses in Alberta").quantity?.minimum).toBe(100);
  });

  it("reads a ceiling as a maximum", () => {
    expect(frameOf("up to 50 boutique hotels near Tbilisi").quantity?.maximum).toBe(50);
  });

  it("does not turn 'as many as possible' into a number", () => {
    const q = frameOf("as many plumbers in Leeds as possible").quantity;
    expect(q?.unlimited).toBe(true);
    expect(q?.requested).toBeNull();
  });

  it("does not mistake a constraint's number for a quantity", () => {
    const f = frameOf("companies in Cork with at least 100 employees");
    expect(f.quantity?.requested ?? null).toBeNull();
    expect(f.constraints.some((c) => c.field === "employee_count" && c.value === 100)).toBe(true);
  });
});

describe("noun-phrase interpretation is open-world", () => {
  /**
   * A descriptor is asserted against `value` OR `normalized`, because the
   * user's own plural stays in `value` and the singular a matcher wants lives
   * in `normalized` — see `singularPhrase` in fallback.ts. Several of these
   * nouns are genuinely either an organization or its staff ("law firms",
   * "coffee roasters"), so the entity assertion is a set: a test that demanded
   * one of two defensible readings would be pinning a coin toss.
   */
  const cases: [string, string[], string][] = [
    ["dental practices in Leeds", ["business"], "dental practice"],
    ["coffee roasters near Copenhagen", ["business", "company"], "coffee roaster"],
    ["law firms across Ontario", ["business", "company"], "law firm"],
    ["heads of talent in Berlin", ["person"], "head of talent"],
    ["freelance copywriters in Dublin", ["person"], "freelance copywriter"],
  ];
  for (const [q, entities, descriptor] of cases) {
    it(`"${q}" reads as a ${entities.join(" or ")}`, () => {
      const f = frameOf(q);
      expect(entities).toContain(f.target.entity_type.value);
      const said = [
        f.target.role,
        f.target.category,
        f.target.job_title,
        f.target.business_type,
      ]
        .flatMap((d) => [d?.value, d?.normalized])
        .filter(Boolean)
        .join(" | ")
        .toLowerCase();
      expect(said).toContain(descriptor);
      expect(f.clarification.needed).toBe(false);
    });
  }
});

describe("what the user sells is not what the prospect needs", () => {
  it("records a sales offer as context and leaves the relation alone", () => {
    const f = frameOf("I sell website design. Find me 100 local businesses in Alberta");
    expect(f.user_context.selling?.service?.value ?? "").toMatch(/website design/i);
    expect(f.relation.type.value).toBe("none");
    expect(f.prospecting_mode.value).toBe("fit_based");
    expect(f.target.entity_type.value).toBe("business");
    expect(f.quantity?.requested ?? f.quantity?.minimum).toBe(100);
  });

  it("reads the gap when the user states it about the prospect", () => {
    const f = frameOf("find businesses in Alberta without websites because I sell web design");
    expect(f.relation.type.value).toBe("lacks_asset");
    expect(f.prospecting_mode.value).toBe("opportunity_based");
    expect(f.evidence.intent_signal_required).toBe(false);
  });
});

describe("a generic head noun names no category", () => {
  // `entity_type = company` plus `category = "companies"` is the same fact
  // twice, and the second copy reads downstream as a narrowing the user never
  // asked for. The words themselves must survive elsewhere in the frame.
  const generics: ReadonlyArray<[string, string]> = [
    ["companies in Napier hiring quantity surveyors", "companies"],
    ["find businesses in Tampere", "businesses"],
    ["people in Bergen", "people"],
    ["investors in Ljubljana", "investors"],
    ["organizations in Tartu", "organizations"],
  ];
  for (const [prompt, word] of generics) {
    it(`leaves every descriptor null for "${word}"`, () => {
      const f = frameOf(prompt);
      for (const d of [
        f.target.role,
        f.target.category,
        f.target.job_title,
        f.target.business_type,
        f.target.niche,
      ]) {
        expect(d?.value ?? null).toBeNull();
      }
      expect(f.target.descriptors).toHaveLength(0);
      // Not lost — still readable as the user's own wording.
      const kept = `${f.target.entity_type.raw ?? ""} ${f.input.raw}`.toLowerCase();
      expect(kept).toContain(word);
    });
  }

  it("keeps a real category that happens to end in a generic word", () => {
    const f = frameOf("logistics companies in Gdansk");
    const said = `${f.target.category?.value ?? ""} ${f.target.industry?.value ?? ""}`;
    expect(said.toLowerCase()).toContain("logistic");
  });

  // The rule used to live only inside the deterministic extractor, so a model
  // frame never met it — and the LLM is the production path. `category: "firm"`
  // reached a graded holdout frame that way.
  it("drops a restating descriptor the model wrote", () => {
    const f = emptyFrame("firms in Maribor that provide grant writing");
    f.target.entity_type = { value: "business", raw: "firms", confidence: 0.9 };
    f.target.category = openValue("firm", "firms");

    const { frame, repairs } = validateFrame(f);
    expect(frame.target.category).toBeNull();
    expect(repairs.map((r) => r.code)).toContain("GENERIC_DESCRIPTOR_DROPPED");
    expect(frame.target.entity_type.raw).toBe("firms");
  });

  it("leaves a stage alone — a startup is not a bare company", () => {
    const f = emptyFrame("aquaculture startups in Inverness");
    f.target.entity_type = { value: "business", raw: "startups", confidence: 0.9 };
    f.target.category = openValue("startup", "startups");

    const { frame } = validateFrame(f);
    expect(frame.target.category?.value).toBe("startup");
  });
});

describe("the head noun decides person-or-organization", () => {
  it("overrules an entity type read off the verb", () => {
    // A graded holdout frame: the model reasoned "who hires? an employer" and
    // answered business, filing the occupation as a business category. The noun
    // says whose request this is, and it is the same table the deterministic
    // reader answers from.
    const f = emptyFrame("wind turbine technicians in Ann Arbor hiring orthodontists");
    f.target.entity_type = { value: "business", raw: "wind turbine technicians", confidence: 0.95 };
    f.target.category = openValue("wind turbine technician", "wind turbine technicians");

    const { frame, repairs } = validateFrame(f);
    expect(frame.target.entity_type.value).toBe("person");
    expect(frame.target.role?.value).toBe("wind turbine technician");
    expect(frame.target.category).toBeNull();
    expect(repairs.map((r) => r.code)).toContain("ENTITY_TYPE_FROM_HEAD_NOUN");
  });

  it("spends nothing on an unrecognized vertical", () => {
    // The whole reason the LLM is the production path: it reads verticals the
    // table has never heard of. `guess: false` is what keeps this repair from
    // overwriting them — an unknown head is not evidence of anything.
    for (const [span, kind] of [
      ["waste haulage", "business"],
      ["sauna", "business"],
      ["bell foundry", "business"],
    ] as const) {
      const f = emptyFrame(`${span} in Tampere`);
      f.target.entity_type = { value: kind, raw: span, confidence: 0.9 };
      f.target.category = openValue(span, span);

      const { frame, repairs } = validateFrame(f);
      expect(frame.target.entity_type.value).toBe(kind);
      expect(repairs.map((r) => r.code)).not.toContain("ENTITY_TYPE_FROM_HEAD_NOUN");
    }
  });

  it("leaves a genuinely dual noun to whichever reading arrived", () => {
    // "orthodontists" and "quantity surveyors" are a person or a practice
    // depending on who is asking. The table says so itself, and a frame already
    // flying `entity_ambiguous` is saying so too — neither is an error to fix.
    const dual = emptyFrame("orthodontists in Tartu");
    dual.target.entity_type = { value: "business", raw: "orthodontists", confidence: 0.8 };
    dual.target.category = openValue("orthodontist", "orthodontists");
    expect(validateFrame(dual).frame.target.entity_type.value).toBe("business");

    const flagged = emptyFrame("luthiers in Cremona");
    flagged.target.entity_type = { value: "business", raw: "luthiers", confidence: 0.8 };
    flagged.target.entity_ambiguous = true;
    flagged.target.category = openValue("luthier", "luthiers");
    expect(validateFrame(flagged).frame.target.entity_type.value).toBe("business");
  });

  it("does not read the head off a clause", () => {
    // The last noun of "technicians in Ann Arbor hiring orthodontists" is the
    // OBJECT. A model that puts a whole clause in `raw` must not have its entity
    // type decided by the wrong end of it.
    const f = emptyFrame("marketing agencies in Ann Arbor hiring copywriters");
    f.target.entity_type = { value: "business", raw: "marketing agencies", confidence: 0.9 };
    f.target.category = openValue("marketing agencies in Ann Arbor hiring copywriters", null);

    const { frame } = validateFrame(f);
    expect(frame.target.entity_type.value).toBe("business");
  });

  it("flips the other way too", () => {
    // The dangerous pair in reverse: "businesses looking for web designers" must
    // not become a person search, and neither must a law firm.
    const f = emptyFrame("law firms in Rijeka looking for web designers");
    f.target.entity_type = { value: "person", raw: "law firms", confidence: 0.9 };
    f.target.role = openValue("law firm", "law firms");

    const { frame, repairs } = validateFrame(f);
    expect(frame.target.entity_type.value).toBe("company");
    expect(frame.target.category?.value).toBe("law firm");
    expect(repairs.map((r) => r.code)).toContain("ENTITY_TYPE_FROM_HEAD_NOUN");
  });

  it("reads the span the entity type was taken from", () => {
    // A graded holdout frame: business at 0.95, role and category both null, and
    // the occupation recorded nowhere but `entity_type.raw`. That span says which
    // words the type was read FROM, so it is a witness like any other — and here
    // the only one there is.
    const f = emptyFrame("brand strategists in Aberystwyth hiring brand strategists");
    f.target.entity_type = { value: "business", raw: "brand strategists", confidence: 0.95 };

    const { frame, repairs } = validateFrame(f);
    expect(frame.target.entity_type.value).toBe("person");
    expect(repairs.map((r) => r.code)).toContain("ENTITY_TYPE_FROM_HEAD_NOUN");
  });

  it("is not moved by a generic word in that span", () => {
    // "companies", "businesses", "people" say the type and nothing else, so they
    // can never contradict it. The fallback witness must not turn them into a
    // second vote on a reading nobody disputed.
    for (const [span, kind] of [
      ["companies", "company"],
      ["businesses", "business"],
      ["people", "person"],
    ] as const) {
      const f = emptyFrame(`${span} in Napier hiring quantity surveyors`);
      f.target.entity_type = { value: kind, raw: span, confidence: 0.9 };

      const { frame, repairs } = validateFrame(f);
      expect(frame.target.entity_type.value).toBe(kind);
      expect(repairs.map((r) => r.code)).not.toContain("ENTITY_TYPE_FROM_HEAD_NOUN");
    }
  });
});

describe("local lead-discovery entity disambiguation", () => {
  const location = (city: string) => ({
    value: city,
    raw: city,
    scope: "in" as const,
    radius: null,
    radius_unit: null,
    country_code: null,
    canonical: null,
    confidence: 0.9,
  });

  it("prefers a local establishment while preserving bare-noun ambiguity", () => {
    const f = emptyFrame("kilns in Regina");
    f.task_type = { value: "lead_discovery", raw: "find", confidence: 0.9 };
    f.relation.type = { value: "none", raw: null, confidence: 0.9 };
    f.relation.direction = { value: "none", raw: null, confidence: 0.9 };
    f.location = location("Regina");
    f.target.entity_type = { value: "product", raw: "kilns", confidence: 0.8 };
    f.target.category = openValue("kiln", "kilns");

    const { frame, repairs } = validateFrame(f);
    expect(frame.target.entity_type.value).toBe("business");
    expect(frame.target.entity_ambiguous).toBe(true);
    expect(repairs).toContainEqual(
      expect.objectContaining({ code: "LOCAL_LEAD_ENTITY_AMBIGUITY", path: "target.entity_type" }),
    );
  });

  it("keeps explicit multiword artifact targets as products", () => {
    for (const phrase of ["coffee machines", "solar panels", "commercial ovens"]) {
      const f = emptyFrame(`${phrase} in Kelowna`);
      f.task_type = { value: "lead_discovery", raw: "find", confidence: 0.9 };
      f.relation.type = { value: "none", raw: null, confidence: 0.9 };
      f.relation.direction = { value: "none", raw: null, confidence: 0.9 };
      f.location = location("Kelowna");
      f.target.entity_type = { value: "product", raw: phrase, confidence: 0.9 };
      f.target.category = openValue(phrase.replace(/s$/, ""), phrase);

      const { frame } = validateFrame(f);
      expect(frame.target.entity_type.value).toBe("product");
      expect(frame.target.entity_ambiguous).toBe(false);
    }
  });

  it("honors an explicit establishment head over a product label", () => {
    const f = emptyFrame("bike shops in Kelowna");
    f.task_type = { value: "lead_discovery", raw: "find", confidence: 0.9 };
    f.relation.type = { value: "none", raw: null, confidence: 0.9 };
    f.relation.direction = { value: "none", raw: null, confidence: 0.9 };
    f.location = location("Kelowna");
    f.target.entity_type = { value: "product", raw: "bike shops", confidence: 0.8 };
    f.target.category = openValue("bike shop", "bike shops");

    const { frame } = validateFrame(f);
    expect(frame.target.entity_type.value).toBe("business");
    expect(frame.target.entity_ambiguous).toBe(false);
  });

  it("applies the same local ambiguity rule inside compound subgoals", () => {
    const f = emptyFrame("kilns in Regina and commercial ovens in Kelowna");
    f.task_type = { value: "lead_discovery", raw: "find", confidence: 0.9 };
    f.relation.type = { value: "none", raw: null, confidence: 0.9 };
    f.relation.direction = { value: "none", raw: null, confidence: 0.9 };
    const goal = (value: string, raw: string, city: string) => ({
      raw: `${raw} in ${city}`,
      target: {
        ...structuredClone(f.target),
        entity_type: { value: "product" as const, raw, confidence: 0.9 },
        category: openValue(value, raw),
      },
      relation: structuredClone(f.relation),
      location: location(city),
      temporal: null,
      constraints: [],
    });
    f.compound = {
      is_compound: true,
      subgoals: [goal("kiln", "kilns", "Regina"), goal("commercial oven", "commercial ovens", "Kelowna")],
    };

    const { frame } = validateFrame(f);
    expect(frame.compound.subgoals[0]?.target.entity_type.value).toBe("business");
    expect(frame.compound.subgoals[0]?.target.entity_ambiguous).toBe(true);
    expect(frame.compound.subgoals[1]?.target.entity_type.value).toBe("product");
  });
});

describe('"this yr" names a year', () => {
  // Calendar-period relations preserve both their relative meaning and the
  // absolute year that downstream date arithmetic can use.

  it("reads the year off the clock", () => {
    const f = emptyFrame("bakeries that opened this yr");
    f.temporal = { relation: "in_year", window: null, year: null, raw: "this yr", confidence: 0.8 };

    const { frame, violations, repairs } = validateFrame(f);
    expect(frame.temporal?.relation).toBe("this_year");
    expect(frame.temporal?.year).toBe(String(new Date().getUTCFullYear()));
    expect(violations.map((v) => v.code)).not.toContain("TEMPORAL_YEAR_MISSING");
    expect(repairs.map((r) => r.code)).toContain("TEMPORAL_FROM_RAW");
  });

  it("prefers the year the phrase states over one elsewhere in the request", () => {
    const f = emptyFrame("agencies founded before 2019 that rebranded last yr");
    f.temporal = { relation: "in_year", window: null, year: null, raw: "last yr", confidence: 0.8 };

    const { frame } = validateFrame(f);
    expect(frame.temporal?.relation).toBe("last_year");
    expect(frame.temporal?.year).toBe(String(new Date().getUTCFullYear() - 1));
  });

  it("still reports a year it cannot read", () => {
    const f = emptyFrame("coopers funded at some point");
    f.temporal = { relation: "in_year", window: null, year: null, raw: null, confidence: 0.5 };

    const { violations } = validateFrame(f);
    expect(violations.map((v) => v.code)).toContain("TEMPORAL_YEAR_MISSING");
  });
});

describe("an absence has exactly one encoding", () => {
  // The validator already turned lacks_asset(X) into a negated exists
  // constraint. Only that direction existed, so a frame arriving with the
  // constraint alone stayed relation=none and read downstream as plain
  // discovery — the absence, which was the entire request, disappeared from
  // the field every later stage branches on.

  it("reads a negated exists constraint as lacks_asset", () => {
    const f = emptyFrame("sailmakers with no phone number");
    f.target.entity_type = { value: "business", raw: "sailmakers", confidence: 0.9 };
    f.target.category = openValue("sailmaker");
    f.relation.type = { value: "none", raw: null, confidence: 0.9 };
    f.relation.direction = { value: "none", raw: null, confidence: 0.9 };
    f.constraints = [
      {
        field: "phone",
        operator: "exists",
        value: null,
        unit: null,
        negated: true,
        raw: "no phone number",
        confidence: 0.9,
      },
    ];

    const { frame } = validateFrame(f);
    expect(frame.relation.type.value).toBe("lacks_asset");
    expect(frame.relation.object?.value).toBe("phone");
    // The whole reason the relation matters: the mode follows it, and the
    // mode is what tells retrieval this is an opportunity, not a directory.
    expect(frame.prospecting_mode.value).toBe("opportunity_based");
    // Derived, never duplicated — the constraint that produced it stays put.
    expect(frame.constraints).toHaveLength(1);
  });

  it("round-trips: both encodings of one request reach the same frame", () => {
    const viaConstraint = emptyFrame("x");
    viaConstraint.relation.type = { value: "none", raw: null, confidence: 0.9 };
    viaConstraint.constraints = [
      {
        field: "website",
        operator: "exists",
        value: null,
        unit: null,
        negated: true,
        raw: "no website",
        confidence: 0.9,
      },
    ];

    const viaRelation = emptyFrame("x");
    viaRelation.relation.type = { value: "lacks_asset", raw: "no website", confidence: 0.9 };
    viaRelation.relation.object = openValue("website", "no website");
    viaRelation.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.9 };

    const a = validateFrame(viaConstraint).frame;
    const b = validateFrame(viaRelation).frame;

    expect(a.relation.type.value).toBe(b.relation.type.value);
    expect(a.prospecting_mode.value).toBe(b.prospecting_mode.value);
    expect(a.constraints.map((c) => [c.field, c.operator, c.negated])).toEqual(
      b.constraints.map((c) => [c.field, c.operator, c.negated]),
    );
  });

  it("never overwrites a relation the user actually stated", () => {
    // "clinics hiring nurses, no website" is a hiring search. The absence
    // qualifies the clinics; it is not what is being looked for.
    const f = emptyFrame("clinics hiring nurses with no website");
    f.target.entity_type = { value: "business", raw: "clinics", confidence: 0.9 };
    f.relation.type = { value: "hiring", raw: "hiring", confidence: 0.9 };
    f.relation.object = openValue("nurse");
    f.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.9 };
    f.constraints = [
      {
        field: "website",
        operator: "exists",
        value: null,
        unit: null,
        negated: true,
        raw: "no website",
        confidence: 0.9,
      },
    ];

    const { frame } = validateFrame(f);
    expect(frame.relation.type.value).toBe("hiring");
    expect(frame.prospecting_mode.value).toBe("hiring_based");
  });

  it("leaves an ordinary negated constraint alone", () => {
    // "excluding Wrocław" is `eq + negated`, not an absence. Reading it as
    // lacks_asset would claim the user wants places that have no location.
    const f = emptyFrame("brand strategists excluding Wrocław");
    f.target.entity_type = { value: "person", raw: "brand strategists", confidence: 0.9 };
    f.relation.type = { value: "none", raw: null, confidence: 0.9 };
    f.constraints = [
      {
        field: "location",
        operator: "eq",
        value: "Wrocław",
        unit: null,
        negated: true,
        raw: "excluding Wrocław",
        confidence: 0.9,
      },
    ];

    expect(validateFrame(f).frame.relation.type.value).toBe("none");
  });

  it("does not record one absence twice when the extractor spells the field its own way", () => {
    // The prompt now asks for BOTH the relation and the constraint, so the
    // extractor supplies a constraint the validator used to add itself. It
    // spells the field as the user said it — "email address" — while the
    // derivation keys it "email", and an exact-match duplicate check sees two
    // different fields. Live frame from the seed-47713 smoke: one missing
    // email, filtered on twice.
    const f = emptyFrame("dive schools in Brno with no email address");
    f.target.entity_type = { value: "business", raw: "dive schools", confidence: 0.9 };
    f.relation.type = { value: "lacks_asset", raw: "no email address", confidence: 0.95 };
    f.relation.object = openValue("email address", "no email address");
    f.relation.direction = { value: "subject_to_object", raw: null, confidence: 0.9 };
    f.constraints = [
      {
        field: "email address",
        operator: "exists",
        value: null,
        unit: null,
        negated: true,
        raw: "no email address",
        confidence: 0.95,
      },
    ];

    const { frame } = validateFrame(f);
    expect(frame.constraints).toHaveLength(1);
    // Keyed, not left as prose — `raw` is where the user's wording belongs.
    // And keyed to the name the DELIVERED column carries, so the filter and
    // the column are the same fact.
    expect(frame.constraints[0].field).toBe("email");
    expect(frame.constraints[0].raw).toBe("no email address");
  });

  it("dedupes normalized phone absence constraints without merging distinct constraints", () => {
    const f = emptyFrame("orchards in Lublin with no phone number and no website");
    f.constraints = [
      { field: "phone_number", operator: "exists", value: null, unit: null, negated: true, raw: "no phone number", confidence: 0.9 },
      { field: "phone number", operator: "exists", value: null, unit: null, negated: true, raw: "no phone number", confidence: 0.9 },
      { field: "website", operator: "exists", value: null, unit: null, negated: true, raw: "no website", confidence: 0.9 },
    ];

    const { frame } = validateFrame(f);
    expect(frame.constraints.map((c) => c.field)).toEqual(["phone", "website"]);
  });

  it("drops unstated business-existence verification while preserving stated verification", () => {
    const unstated = emptyFrame("ceramic studios in Brno with no website");
    unstated.verification = [
      { kind: "business_exists", label: null, raw: "verify they exist" },
      { kind: "no_owned_website", label: null, raw: "no website" },
    ];
    expect(validateFrame(unstated).frame.verification.map((v) => v.kind)).toEqual(["no_owned_website"]);

    const stated = emptyFrame("confirm bakeries in Ghent exist before listing them");
    stated.verification = [{ kind: "business_exists", label: null, raw: "confirm bakeries exist" }];
    expect(validateFrame(stated).frame.verification.map((v) => v.kind)).toEqual(["business_exists"]);
  });

  it("names one delivered column once, however the extractor spelled it", () => {
    // Two live HOLDOUT frames: the same sentence shape produced "phone number"
    // and "Instagram" in one case and "phone"/"instagram" in another, which is
    // two column sets for one request — decided by nothing the user said.
    const f = emptyFrame(
      "100 quilt shops in Bergen, phone number required, Instagram if possible",
    );
    f.required_fields = [openValue("phone number"), openValue("Phone")];
    f.preferred_fields = [openValue("Instagram")];
    f.contact_requirements = [openValue("email address")];

    const { frame } = validateFrame(f);
    expect(frame.required_fields.map((x) => x.value)).toEqual(["phone"]);
    expect(frame.preferred_fields.map((x) => x.value)).toEqual(["instagram"]);
    expect(frame.contact_requirements.map((x) => x.value)).toEqual(["email"]);
    // The wording survives the keying — the inspector shows what was typed.
    expect(frame.required_fields[0].raw).toBe("phone number");
  });

  it("keeps an unrecognized ask in the user's own words", () => {
    // "their VAT number" is a real request. Slugging it to `vat_number` would
    // dress an ask nothing can serve as a known column; lowercasing is the
    // most we can claim.
    const f = emptyFrame("importers in Rijeka with their VAT number");
    f.required_fields = [openValue("VAT number")];

    const { frame } = validateFrame(f);
    expect(frame.required_fields.map((x) => x.value)).toEqual(["vat number"]);
  });
});

describe("a profession noun is both a person and a practice", () => {
  // The flag exists so neither reading has to be called an error. Nothing
  // downstream may turn it into a question: both readings find the same door.
  //
  // Which nouns carry it is a curated list on the deterministic side and a
  // stated rule on the LLM side, so the two are allowed to disagree about any
  // one word — the flag only ever WIDENS what the grader accepts, so a model
  // raising it where the lexicon does not cannot turn a right frame wrong.
  it("marks the ambiguity and does not ask about it", () => {
    const f = frameOf("orthodontists in Pereira hiring sound engineers");
    expect(f.target.entity_ambiguous).toBe(true);
    expect(f.clarification.needed).toBe(false);
  });

  it("leaves the flag down for a noun that names one kind of thing", () => {
    expect(frameOf("companies in Napier hiring quantity surveyors").target.entity_ambiguous).toBe(
      false,
    );
  });
});

describe("capital requests get their own prospecting mode", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["investors funding aquaculture startups", "investment_based"],
    ["startups in Riga seeking investors", "funding_based"],
    ["investors in Ljubljana", "fit_based"],
  ];
  for (const [prompt, mode] of cases) {
    it(`"${prompt}" is ${mode}`, () => {
      expect(frameOf(prompt).prospecting_mode.value).toBe(mode);
    });
  }
});

describe("job seekers, hiring employers, and posting discovery stay distinct", () => {
  const contrasts = [
    {
      prompt: "electricians in Plovdiv looking for jobs",
      entity: "person",
      task: "lead_discovery",
      relation: "seeking_job",
      mode: "job_based",
    },
    {
      prompt: "companies in Plovdiv hiring electricians",
      entity: "company",
      task: "lead_discovery",
      relation: "hiring",
      mode: "hiring_based",
    },
    {
      prompt: "electrician job postings in Plovdiv",
      entity: "job",
      task: "job_discovery",
      relation: "none",
      mode: "job_based",
    },
    {
      prompt: "hydrologist job listings in Cuenca from the last month",
      entity: "job",
      task: "job_discovery",
      relation: "none",
      mode: "job_based",
    },
  ] as const;

  for (const expected of contrasts) {
    it(`keeps "${expected.prompt}" in its own semantic class`, () => {
      const f = frameOf(expected.prompt);
      expect(f.target.entity_type.value).toBe(expected.entity);
      expect(f.task_type.value).toBe(expected.task);
      expect(f.relation.type.value).toBe(expected.relation);
      expect(f.prospecting_mode.value).toBe(expected.mode);
    });
  }

  it("produces three different semantic cores for the dangerous contrast", () => {
    const frames = contrasts.slice(0, 3).map((c) => frameOf(c.prompt));
    expect(new Set(frames.map(core)).size).toBe(3);
  });
});

describe("compound requests keep both halves", () => {
  it("backfills exact nested clause, target, and location provenance", () => {
    const f = emptyFrame(
      "find cider houses in Ghent and also find seed libraries near Kelowna",
    );
    const goal = (category: string, city: string, scope: "in" | "near") => ({
      raw: null,
      target: {
        ...structuredClone(f.target),
        entity_type: { value: "business" as const, raw: null, confidence: 0.9 },
        category: { ...openValue(category), raw: null },
      },
      relation: {
        ...structuredClone(f.relation),
        type: { value: "none" as const, raw: null, confidence: 0.9 },
        direction: { value: "none" as const, raw: null, confidence: 0.9 },
      },
      location: {
        value: city,
        raw: null,
        scope,
        radius: null,
        radius_unit: null,
        country_code: null,
        canonical: null,
        confidence: 0.8,
      },
      temporal: null,
      constraints: [],
    });
    f.compound = {
      is_compound: true,
      subgoals: [goal("cider house", "Ghent", "in"), goal("seed library", "Kelowna", "near")],
    };

    const { frame, repairs } = validateFrame(f);
    const [first, second] = frame.compound.subgoals;
    expect(first?.raw).toBe("find cider houses in Ghent");
    expect(first?.target.entity_type.raw).toBe("cider houses");
    expect(first?.target.category?.raw).toBe("cider houses");
    expect(first?.location?.raw).toBe("in Ghent");
    expect(first?.location?.canonical).toBe("Ghent");
    expect(second?.raw).toBe("find seed libraries near Kelowna");
    expect(second?.target.entity_type.raw).toBe("seed libraries");
    expect(second?.target.category?.raw).toBe("seed libraries");
    expect(second?.location?.raw).toBe("near Kelowna");
    expect(second?.location?.canonical).toBe("Kelowna");
    expect(repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "compound.subgoals[0].raw" }),
        expect.objectContaining({ path: "compound.subgoals[0].target.category.raw" }),
        expect.objectContaining({ path: "compound.subgoals[1].location.canonical" }),
      ]),
    );
  });

  it("backfills role provenance without changing nested person semantics", () => {
    const f = emptyFrame("find sound engineers in Brno and also find conservators in Ghent");
    const goal = (role: string, city: string) => ({
      raw: null,
      target: {
        ...structuredClone(f.target),
        entity_type: { value: "person" as const, raw: null, confidence: 0.9 },
        role: { ...openValue(role), raw: null },
      },
      relation: {
        ...structuredClone(f.relation),
        type: { value: "none" as const, raw: null, confidence: 0.9 },
        direction: { value: "none" as const, raw: null, confidence: 0.9 },
      },
      location: {
        value: city,
        raw: null,
        scope: "in" as const,
        radius: null,
        radius_unit: null,
        country_code: null,
        canonical: null,
        confidence: 0.8,
      },
      temporal: null,
      constraints: [],
    });
    f.compound = {
      is_compound: true,
      subgoals: [goal("sound engineer", "Brno"), goal("conservator", "Ghent")],
    };

    const { frame } = validateFrame(f);
    expect(frame.compound.subgoals[0]?.target.entity_type.value).toBe("person");
    expect(frame.compound.subgoals[0]?.target.role?.raw).toBe("sound engineers");
    expect(frame.compound.subgoals[1]?.target.entity_type.value).toBe("person");
    expect(frame.compound.subgoals[1]?.target.role?.raw).toBe("conservators");
  });

  it("runs target invariants recursively for unrelated compound subgoals", () => {
    const f = emptyFrame(
      "wind turbine technicians in Linz and law firms in Pécs and companies in Braga",
    );
    const subgoal = () => ({
      raw: null,
      target: structuredClone(f.target),
      relation: {
        ...structuredClone(f.relation),
        type: { value: "none" as const, raw: null, confidence: 0.9 },
        direction: { value: "none" as const, raw: null, confidence: 0.9 },
      },
      location: null,
      temporal: null,
      constraints: [],
    });
    const technician = subgoal();
    technician.target.entity_type = {
      value: "business",
      raw: "wind turbine technicians",
      confidence: 0.9,
    };
    technician.target.category = openValue(
      "wind turbine technician",
      "wind turbine technicians",
    );

    const firm = subgoal();
    firm.target.entity_type = { value: "person", raw: "law firms", confidence: 0.9 };
    firm.target.role = openValue("law firm", "law firms");

    const generic = subgoal();
    generic.target.entity_type = { value: "company", raw: "companies", confidence: 0.9 };
    generic.target.category = openValue("company", "companies");

    f.compound = { is_compound: true, subgoals: [technician, firm, generic] };

    const { frame, repairs } = validateFrame(f);
    const [personGoal, companyGoal, genericGoal] = frame.compound.subgoals;
    expect(personGoal?.target.entity_type.value).toBe("person");
    expect(personGoal?.target.role?.value).toBe("wind turbine technician");
    expect(personGoal?.target.category).toBeNull();
    expect(companyGoal?.target.entity_type.value).toBe("company");
    expect(companyGoal?.target.category?.value).toBe("law firm");
    expect(companyGoal?.target.role).toBeNull();
    expect(genericGoal?.target.category).toBeNull();
    expect(repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ENTITY_TYPE_FROM_HEAD_NOUN",
          path: "compound.subgoals[0].target.entity_type",
        }),
        expect.objectContaining({
          code: "ENTITY_TYPE_FROM_HEAD_NOUN",
          path: "compound.subgoals[1].target.entity_type",
        }),
        expect.objectContaining({
          code: "GENERIC_DESCRIPTOR_DROPPED",
          path: "compound.subgoals[2].target.category",
        }),
      ]),
    );
  });

  it("splits two populations into subgoals", () => {
    const f = frameOf("dentists in Perth and also orthodontists in Adelaide");
    expect(f.compound.is_compound).toBe(true);
    expect(f.compound.subgoals.length).toBeGreaterThanOrEqual(2);
    const said = JSON.stringify(f.compound.subgoals).toLowerCase();
    expect(said).toContain("perth");
    expect(said).toContain("adelaide");
    expect(said).toContain("orthodontist");
  });

  it("has no compound flag without subgoals", () => {
    const f = frameOf("dentists in Perth and also orthodontists in Adelaide");
    expect(blocking(f)).toHaveLength(0);
  });
});

describe("an excluded place is not also the place to search", () => {
  it("keeps a negated location out of the positive location", () => {
    const f = frameOf("freelance copywriters under $150/hour, excluding Toronto");
    expect(f.location?.value ?? null).not.toBe("Toronto");
    expect(
      f.constraints.some((c) => c.field === "location" && c.negated && /toronto/i.test(String(c.value))),
    ).toBe(true);
    expect(f.constraints.some((c) => c.field === "hourly_rate" && c.value === 150)).toBe(true);
  });

  // The deterministic reader cannot produce this shape; a model can, and did.
  it("drops a location whose own span is the exclusion, keeping the exclusion", () => {
    const f = emptyFrame("freelance retouchers, excluding Gdansk");
    f.location = {
      value: "Gdansk",
      raw: "excluding Gdansk",
      scope: "in",
      radius: null,
      radius_unit: null,
      country_code: null,
      canonical: null,
      confidence: 0.5,
    };

    const { frame, violations, repairs } = validateFrame(f);
    expect(frame.location).toBeNull();
    expect(repairs.map((r) => r.code)).toContain("LOCATION_WAS_AN_EXCLUSION");
    expect(
      frame.constraints.some(
        (c) => c.field === "location" && c.negated && String(c.value).toLowerCase() === "gdansk",
      ),
    ).toBe(true);
    expect(violations.map((v) => v.code)).not.toContain("LOCATION_EXCLUDED_AND_REQUIRED");
  });

  it("does not invent a second exclusion when the model already stated one", () => {
    const f = emptyFrame("freelance retouchers, excluding Gdansk");
    f.location = {
      value: "Gdansk",
      raw: "excluding Gdansk",
      scope: "in",
      radius: null,
      radius_unit: null,
      country_code: null,
      canonical: null,
      confidence: 0.5,
    };
    f.constraints = [
      {
        field: "location",
        operator: "eq",
        value: "Gdansk",
        unit: null,
        negated: true,
        raw: "excluding Gdansk",
        confidence: 0.9,
      },
    ];

    const { frame } = validateFrame(f);
    expect(frame.constraints.filter((c) => c.field === "location")).toHaveLength(1);
  });

  // The span says "in Gdansk" while something else says "not Gdansk". Nothing
  // in the frame says which one the user meant, so it is a question, not a
  // repair — the case the repair above must not swallow.
  it("still blocks a contradiction the span cannot settle", () => {
    const f = emptyFrame("retouchers in Gdansk but not Gdansk");
    f.location = {
      value: "Gdansk",
      raw: "in Gdansk",
      scope: "in",
      radius: null,
      radius_unit: null,
      country_code: null,
      canonical: null,
      confidence: 0.9,
    };
    f.constraints = [
      {
        field: "location",
        operator: "eq",
        value: "Gdansk",
        unit: null,
        negated: true,
        raw: "not Gdansk",
        confidence: 0.9,
      },
    ];

    const { violations } = validateFrame(f);
    expect(violations.map((v) => v.code)).toContain("LOCATION_EXCLUDED_AND_REQUIRED");
  });
});

// ── Clarification monotonicity ────────────────────────────────────────────

describe("a vertical on its own is not a target", () => {
  /** A model's answer to a bare vertical: an industry and a confident guess. */
  const bare = (word: string) => {
    const f = emptyFrame(word);
    f.target.entity_type = { value: "business", raw: word, confidence: 0.9 };
    f.target.industry = openValue(word, word);
    return f;
  };

  it("asks for scope rather than answering globally", () => {
    // Three graded LLM frames read a bare vertical as "every business in it",
    // at 0.9 confidence with no question asked. An industry says which market,
    // not what kind of thing to find in it.
    for (const word of ["proptech", "circular economy", "waste haulage"]) {
      const asked = syncClarification(bare(word)).clarification;
      expect(asked.needed).toBe(true);
      expect(asked.reason).toBe("underspecified_scope");
      expect(asked.fields).toEqual(["target.scope"]);
    }
  });

  it("does not care which slot the word landed in", () => {
    // The same two requests, filed differently by the same model: proptech as an
    // industry, pharmacovigilance and subtitling as a category. They are one
    // request, so the slot cannot be what decides whether to ask.
    for (const word of ["pharmacovigilance", "subtitling", "port logistics"]) {
      const f = bare(word);
      f.target.industry = null;
      f.target.category = openValue(word, word);
      const asked = syncClarification(f).clarification;
      expect(asked.needed).toBe(true);
      expect(asked.reason).toBe("underspecified_scope");
    }
  });

  it("does not read the vertical's own word back as a head noun", () => {
    // The deterministic engine reads "port logistics" as a business by the
    // suffix of its own last word, and records that word — stemmed — as the
    // span the type came from. That is not a noun beside the vertical.
    const f = bare("port logistics");
    f.target.entity_type = { value: "business", raw: "logistic", confidence: 0.4 };
    expect(syncClarification(f).clarification.needed).toBe(true);

    // A word the vertical does not contain is a real witness.
    f.target.entity_type = { value: "company", raw: "port logistics firms", confidence: 0.9 };
    expect(syncClarification(f).clarification.needed).toBe(false);
  });

  it("accepts the vertical itself when it already names a kind", () => {
    // "cafes" and "law firms" arrive in the same slot as "proptech" and are not
    // markets: nobody typing one is asking about an industry. A word the
    // head-noun table does not know — "saunas" — still gets the question, which
    // is the honest answer for an unbounded global request.
    for (const word of ["cafes", "law firms", "coffee roasters"]) {
      const f = bare(word);
      f.target.industry = null;
      f.target.category = openValue(word, word);
      expect(syncClarification(f).clarification.needed).toBe(false);
    }
  });

  it("accepts a place as the bound for an unfamiliar trade", () => {
    // "waste haulage" is unanswerable and "waste haulage in Tampere" is not,
    // and the place is the only thing in the frame that bounds it.
    const f = bare("waste haulage");
    f.location = {
      value: "Tampere",
      raw: "in Tampere",
      scope: "in",
      radius: null,
      radius_unit: null,
      country_code: null,
      canonical: null,
      confidence: 0.9,
    };
    expect(syncClarification(f).clarification.needed).toBe(false);
  });

  it("asks about scope, not about the target", () => {
    // The vertical WAS understood. Asking "what are you looking for?" throws
    // away the one half of a two-word request that was clear.
    const f = syncClarification(bare("proptech"));
    expect(f.clarification.fields).not.toContain("target.entity_type");
    expect(f.target.industry?.value).toBe("proptech");
  });

  it("stays quiet once a head noun names the kind", () => {
    const f = bare("proptech");
    f.target.entity_type = { value: "company", raw: "proptech companies", confidence: 0.95 };
    expect(syncClarification(f).clarification.needed).toBe(false);
  });

  it("stays quiet once anything else bounds the search", () => {
    const withCount = bare("proptech");
    withCount.quantity = {
      requested: 40,
      minimum: null,
      maximum: null,
      unlimited: false,
      approximate: false,
      raw: "40",
    };
    // A count is not scope on its own — but a relation, a constraint and a
    // narrowing noun each are, and those are the shapes a vertical arrives with.
    const withStage = bare("proptech");
    withStage.target.company_stage = openValue("startup", "startups");
    expect(syncClarification(withStage).clarification.needed).toBe(false);

    const withConstraint = bare("proptech");
    withConstraint.constraints = [
      {
        field: "website",
        operator: "exists",
        value: null,
        unit: null,
        raw: "without a website",
        negated: true,
        confidence: 0.9,
      },
    ];
    expect(syncClarification(withConstraint).clarification.needed).toBe(false);

    const withRelation = bare("proptech");
    withRelation.relation.type = { value: "hiring", raw: "hiring", confidence: 0.9 };
    withRelation.relation.object = openValue("data engineer", "data engineers");
    withRelation.relation.direction = { value: "subject_to_object", raw: "hiring", confidence: 0.9 };
    expect(syncClarification(withRelation).clarification.needed).toBe(false);
  });

  it("does not pre-empt a question that matters more", () => {
    // Scope is asked last on purpose: a frame that does not know WHAT it is
    // looking for must be asked that first.
    const f = bare("proptech");
    f.target.entity_type = { value: "unknown", raw: "", confidence: 0.2 };
    f.target.industry = null;
    expect(syncClarification(f).clarification.reason).toBe("missing_target");
  });
});

describe("clarification is monotonic", () => {
  it("only blocks on structurally blocking fields", () => {
    // An unknown industry is not worth a question. An unknown relation is.
    const f = frameOf("people in berlin");
    for (const field of f.clarification.fields) {
      expect(BLOCKING_FIELDS).toContain(field);
    }
  });

  it("never re-asks a field that was answered", () => {
    const f = frameOf("stuff about things maybe");
    let state = initState(f);

    const first = nextQuestion(state);
    expect(first).not.toBeNull();

    const answered = patchFrame(state, first!.field, first!.options[0] ?? "hiring");
    state = answered.state;

    expect(state.answered[first!.field]).toBeDefined();
    expect(unresolvedFields(state)).not.toContain(first!.field);
    expect(nextQuestion(state)?.field).not.toBe(first!.field);
  });

  it("records an answer it cannot map, rather than asking again", () => {
    // The worst outcome is a loop. An answer we do not understand still
    // closes the question; the frame carries the words for a human to read.
    const f = frameOf("stuff about things maybe");
    let state = initState(f);
    const q = nextQuestion(state)!;

    state = patchFrame(state, q.field, "something entirely unanticipated").state;

    expect(state.answered[q.field]).toBe("something entirely unanticipated");
    expect(unresolvedFields(state)).not.toContain(q.field);
  });

  it("does not re-parse the original query when patching", () => {
    // Patching must touch the answered field only. A re-parse would let an
    // answer about direction silently change the location.
    const f = frameOf("engineers around trondheim");
    const before = structuredClone(f);
    const state = initState(f);
    const q = nextQuestion(state);
    if (!q) return; // already understood; nothing to patch

    const after = patchFrame(state, q.field, q.options[0] ?? "hiring").state.frame;
    expect(after.location?.value).toBe(before.location?.value);
    expect(after.input.raw).toBe(before.input.raw);
  });

  it("terminates: repeated answering empties the unresolved set", () => {
    let state = initState(frameOf("stuff about things maybe"));
    for (let i = 0; i < BLOCKING_FIELDS.length + 2; i++) {
      const q = nextQuestion(state);
      if (!q) break;
      state = patchFrame(state, q.field, q.options[0] ?? "unknown").state;
    }
    expect(nextQuestion(state)).toBeNull();
    expect(unresolvedFields(state)).toHaveLength(0);
  });

  it("syncClarification agrees with the state machine", () => {
    // Two places compute "is a question needed". They must not disagree, or
    // the inspector shows a question the server does not think exists.
    for (const q of ["stuff about things maybe", "plumbers in toronto", "companies using shopify"]) {
      const f = frameOf(q);
      const state = initState(f);
      expect(f.clarification.needed).toBe(unresolvedFields(state).length > 0);
    }
  });
});
