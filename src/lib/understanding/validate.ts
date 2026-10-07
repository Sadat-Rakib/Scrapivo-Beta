/**
 * Understanding Engine — deterministic validator / normalizer.
 *
 * This layer CHECKS an interpretation. It never produces one. If the LLM says
 * "hiring" for a sentence that plainly describes someone job-hunting, the
 * answer is a violation, not a quiet rewrite into what we think was meant —
 * silent reinterpretation is how a parser stops being debuggable.
 *
 * Two kinds of output:
 *   violations — contradictions and structurally incomplete frames
 *   repairs    — normalizations we can justify without changing the meaning
 *                (canonical city name, alias resolution, evidence flags that
 *                follow mechanically from the relation)
 *
 * What is NEVER a violation: an unfamiliar role, industry, category, service,
 * product, technology, niche, job title or business type. "Actuarial
 * consultant" is not a parse failure.
 */

import { normalizeRole, extractTemporal } from "@/lib/search/search-spec-extract";
import { resolveCanonicalLocation, splitMultiPlace } from "@/lib/search/location-resolver";
import type { Constraint, OpenValue, Relation, Target, UnderstandingFrame } from "./frame";
import {
  canonicalWindow,
  detectRelation,
  detectTemporal as detectTemporalDeterministic,
  fieldRequirements,
  splitCompound,
} from "./fallback";
import { openValue } from "./frame";
import {
  classifyHead,
  hedgesTheAsk,
  isTemporalPhrase,
  narrowsTarget,
  opensWithExclusion,
  opensWithNearCue,
  RELATION_SIGNAL_RE,
} from "./lexicon";
import {
  canonicalize,
  CONSTRAINT_FIELD_ALIASES,
  EVIDENCE_BY_RELATION,
  isEntityType,
  keyDeliverableField,
  MODE_BY_RELATION,
  namedFamilyMember,
  RELATIONS_REQUIRING_OBJECT,
  TEMPORAL_RELATIONS,
  type ProspectingMode,
  type RelationType,
  type TemporalRelation,
} from "./vocab";

function isTemporalRelation(v: string): v is TemporalRelation {
  return (TEMPORAL_RELATIONS as readonly string[]).includes(v);
}

export type Severity = "error" | "warning";

export type Violation = {
  code: string;
  severity: Severity;
  message: string;
  /** Dotted path into the frame, for the inspector to highlight. */
  path: string;
};

export type Repair = {
  code: string;
  message: string;
  path: string;
};

export type ValidationResult = {
  frame: UnderstandingFrame;
  violations: Violation[];
  repairs: Repair[];
};

// ── Phrase evidence for direction contradictions ──────────────────────────
//
// Deliberately narrow. These fire only on unambiguous wording, because a
// false contradiction would reject a correct frame — worse than passing a
// doubtful one through to manual inspection.

const SEEKING_WORK_RE =
  /\b(?:looking|searching|hunting|on the hunt)\s+for\s+(?:a\s+|an\s+|new\s+)*(?:job|jobs|work|role|roles|position|positions|employment|gig|gigs|opportunit\w*)\b|\bjob[-\s]?seek(?:er|ers|ing)\b|\bseeking\s+(?:employment|work|a\s+job|a\s+role|a\s+new\s+role|opportunit\w*)\b|\bopen\s+to\s+work\b|\bwants?\s+a\s+job\b/i;

const HIRING_RE =
  /\b(?:hiring|to\s+hire|looking\s+to\s+hire|wants?\s+to\s+hire|trying\s+to\s+hire|recruit(?:ing|ers?)?|bring(?:ing)?\s+(?:on|in)\b|taking\s+on\b|staffing\s+up|adding\s+to\s+(?:the\s+)?team|expanding\s+(?:the\s+)?team|need(?:s|ing)?\s+to\s+hire)\b/i;

/** Relations that describe an action, so "which way round" is a real question. */
const DIRECTIONAL_RELATIONS: readonly RelationType[] = [
  "hiring",
  "seeking_job",
  "seeking_client",
  "asking_for_help",
  "needs_service",
  "offers_service",
  "uses_technology",
  "partnered_with",
  "attending_event",
  "received_funding",
  "seeking_funding",
  "investing_in",
  "custom",
];

// ── Helpers ───────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function normalizeOpen(
  ov: OpenValue | null,
  fn: (raw: string) => string | null,
): { changed: boolean; value: OpenValue | null } {
  if (!ov) return { changed: false, value: null };
  const next = fn(ov.value);
  if (!next || next === ov.normalized) return { changed: false, value: ov };
  return { changed: true, value: { ...ov, normalized: next } };
}

/**
 * The year a temporal phrase names, or null when it names none.
 *
 * A literal year wins over a relative one, and only the three relative phrases
 * that unambiguously name a single year are read — "recently" and "in the last
 * 2 months" name a window, which is a different field.
 */
function yearFrom(said: string | null | undefined): string | null {
  if (!said) return null;
  const literal = said.match(/\b(?:19|20)\d{2}\b/)?.[0];
  if (literal) return literal;
  const now = new Date().getUTCFullYear();
  if (/\bthis\s+(?:year|yr)\b/i.test(said)) return String(now);
  if (/\blast\s+(?:year|yr)\b/i.test(said)) return String(now - 1);
  if (/\bnext\s+(?:year|yr)\b/i.test(said)) return String(now + 1);
  return null;
}

/**
 * The machine key a constraint field is addressed by.
 *
 * `field` is a key, not prose — the wording the user typed lives in `raw`. Two
 * spellings of one key are two filters on one fact: an extractor emitting
 * `"email address"` where the alias table says `email_address` produced a frame
 * carrying the same absence twice, because the duplicate check below compares
 * exactly and the two strings are not equal.
 */
function fieldKey(field: string): string {
  // The filter vocabulary is asked FIRST, because the two tables disagree
  // deliberately where they overlap: "reviews" as a filter is a count to
  // compare, while "reviews" as a delivered column is the reviews themselves.
  // The delivered vocabulary is asked second so a contact field lands on one
  // name across both — filtering `email_address` while delivering `email` is
  // two names for one column, which is the defect this function exists for.
  const spoken = field.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  return canonicalize(spoken, CONSTRAINT_FIELD_ALIASES) ?? keyDeliverableField(spoken) ?? spoken.replace(/\s+/g, "_");
}

/**
 * The target fields a re-harvested word lands in, narrowest first.
 *
 * `entity_subtype` is absent on purpose: it is the field that answers "which
 * kind" for the vague entity types, and dropping it would trip
 * ENTITY_SUBTYPE_MISSING below over a word the frame does still carry.
 */
const REHARVESTABLE = [
  "company_stage",
  "industry",
  "niche",
  "business_type",
  "category",
  "role",
  "job_title",
] as const;

/** A field's own words, folded for comparison. Null when it recorded none. */
function spanOf(ov: OpenValue | null | undefined): string | null {
  const said = ov?.raw ?? ov?.value;
  const span = said?.trim().toLowerCase().replace(/\s+/g, " ");
  return span ? span : null;
}

/** Is `inner` a whole word or phrase sitting inside `outer`? */
function contains(outer: string, inner: string): boolean {
  if (outer.length <= inner.length) return false;
  const at = outer.indexOf(inner);
  if (at < 0) return false;
  const before = outer[at - 1];
  const after = outer[at + inner.length];
  // Plural and possessive tails still count as the same word: "seed" is inside
  // "seed libraries", and "writer" inside "medical writers".
  return (before === undefined || before === " ") && (after === undefined || after === " " || after === "s");
}

/** Which other field already recorded `span` whole, if any. */
function widerSpanHolder(
  target: Target,
  relation: Relation,
  slot: (typeof REHARVESTABLE)[number],
  span: string,
  targetPath: string,
  relationPath: string,
): string | null {
  const object = spanOf(relation.object);
  if (object && (contains(object, span) || object === span)) return `${relationPath}.object "${object}"`;
  for (const other of REHARVESTABLE) {
    if (other === slot) continue;
    const held = spanOf(target[other]);
    if (held && contains(held, span)) return `${targetPath}.${other} "${held}"`;
  }
  return null;
}

function hasConstraint(list: Constraint[], field: string, operator: string): boolean {
  const key = fieldKey(field);
  return list.some((c) => fieldKey(c.field) === key && c.operator === operator);
}

const TARGET_OPEN_SLOTS = [
  "entity_subtype",
  "role",
  "job_title",
  "industry",
  "category",
  "business_type",
  "niche",
  "company_stage",
] as const;

/** Escape one literal phrase for a Unicode regular expression. */
function reLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

/**
 * Recover the user's exact spelling for a semantic value without interpreting
 * any new meaning. Plural candidates are tried before the singular so
 * `board game café` points back to `board game cafés`, not a truncated span.
 */
function literalSpan(clause: string, value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;
  const candidates = [
    `${clean}s`,
    `${clean}es`,
    /[^aeiou]y$/i.test(clean) ? `${clean.slice(0, -1)}ies` : null,
    clean,
  ].filter((v): v is string => v != null);
  for (const candidate of candidates) {
    const match = new RegExp(reLiteral(candidate), "iu").exec(clause);
    if (match?.[0]) return match[0];
  }
  return null;
}

/** Include the locative cue because `in` vs `near` is provenance too. */
function locationSpan(clause: string, value: string): string | null {
  const place = literalSpan(clause, value);
  if (!place) return null;
  const at = clause.toLocaleLowerCase().indexOf(place.toLocaleLowerCase());
  if (at < 0) return place;
  const prefix = clause.slice(0, at);
  const cue = /(?:^|\s)(in|near|nearby|around|round|outside|across|throughout|within)\s*$/iu.exec(prefix);
  return cue ? `${cue[1]} ${place}` : place;
}

/**
 * Backfill only missing provenance on compound subgoals.
 *
 * The split is accepted only when it produces exactly as many ordered clauses
 * as the LLM produced subgoals. That makes this metadata propagation, not a
 * second semantic parser: no target, relation, object, location value, scope,
 * constraint, or direction is created or changed here.
 */
function propagateCompoundProvenance(
  frame: UnderstandingFrame,
  repairs: Repair[],
): void {
  const subgoals = frame.compound.subgoals;
  if (subgoals.length < 2) return;
  const { parts } = splitCompound(frame.input.raw);
  if (parts.length !== subgoals.length) return;

  subgoals.forEach((sg, i) => {
    const base = `compound.subgoals[${i}]`;
    const clause = parts[i]!.trim();
    if (!sg.raw && clause) {
      sg.raw = clause;
      repairs.push({
        code: "SUBGOAL_RAW_DERIVED",
        message: `subgoal ${i + 1} provenance -> "${clause}"`,
        path: `${base}.raw`,
      });
    }

    for (const slot of TARGET_OPEN_SLOTS) {
      const value = sg.target[slot];
      if (!value || value.raw) continue;
      const raw = literalSpan(clause, value.value);
      if (!raw) continue;
      value.raw = raw;
      repairs.push({
        code: "SUBGOAL_TARGET_RAW_DERIVED",
        message: `${slot} provenance -> "${raw}"`,
        path: `${base}.target.${slot}.raw`,
      });
    }
    for (const [slot, values] of [
      ["technologies", sg.target.technologies],
      ["descriptors", sg.target.descriptors],
    ] as const) {
      values.forEach((value, j) => {
        if (value.raw) return;
        const raw = literalSpan(clause, value.value);
        if (!raw) return;
        value.raw = raw;
        repairs.push({
          code: "SUBGOAL_TARGET_RAW_DERIVED",
          message: `${slot} provenance -> "${raw}"`,
          path: `${base}.target.${slot}[${j}].raw`,
        });
      });
    }

    if (!sg.target.entity_type.raw) {
      const raw =
        TARGET_OPEN_SLOTS.map((slot) => sg.target[slot]?.raw).find((v): v is string => !!v) ??
        sg.target.technologies.find((v) => v.raw)?.raw ??
        sg.target.descriptors.find((v) => v.raw)?.raw ??
        null;
      if (raw) {
        sg.target.entity_type.raw = raw;
        repairs.push({
          code: "SUBGOAL_ENTITY_RAW_DERIVED",
          message: `entity provenance -> "${raw}"`,
          path: `${base}.target.entity_type.raw`,
        });
      }
    }

    if (sg.relation.object && !sg.relation.object.raw) {
      const raw = literalSpan(clause, sg.relation.object.value);
      if (raw) {
        sg.relation.object.raw = raw;
        repairs.push({
          code: "SUBGOAL_OBJECT_RAW_DERIVED",
          message: `object provenance -> "${raw}"`,
          path: `${base}.relation.object.raw`,
        });
      }
    }

    if (sg.location) {
      if (!sg.location.raw) {
        const raw = locationSpan(clause, sg.location.value);
        if (raw) {
          sg.location.raw = raw;
          repairs.push({
            code: "SUBGOAL_LOCATION_RAW_DERIVED",
            message: `location provenance -> "${raw}"`,
            path: `${base}.location.raw`,
          });
        }
      }
      if (!sg.location.canonical) {
        const geo = resolveCanonicalLocation(sg.location.value, { gazetteer: true, correctTypos: true });
        if (geo?.name) {
          sg.location.canonical = geo.name;
          if (geo.country_code) sg.location.country_code = geo.country_code;
          repairs.push({
            code: "LOCATION_CANONICALIZED",
            message: `"${sg.location.value}" -> ${geo.name}`,
            path: `${base}.location.canonical`,
          });
        }
      }
    }
  });
}

/**
 * Normalize the semantic core shared by the root frame and compound subgoals.
 *
 * `SubgoalSchema` deliberately reuses `TargetSchema` and `RelationSchema`, but
 * schema reuse alone only checks shape. These meaning-preserving invariants
 * must follow the same recursion or one phrase can be a person at the root and
 * a business in the corresponding nested goal.
 */
function normalizeSemanticCore(
  target: Target,
  relation: Relation,
  targetPath: string,
  relationPath: string,
  violations: Violation[],
  repairs: Repair[],
  checkTargetCompleteness = true,
  localLeadDiscovery = false,
): void {
  const nounPhrase = (said: string | null | undefined): string | null => {
    const span = said?.trim().replace(/\s+/g, " ");
    if (!span) return null;
    if (span.split(" ").length > 5) return null;
    if (RELATION_SIGNAL_RE.test(span)) return null;
    return span;
  };
  const said = (ov: OpenValue | null | undefined) => nounPhrase(ov?.value ?? ov?.raw);
  const named = said(target.role) ?? said(target.category) ?? nounPhrase(target.entity_type.raw);
  const head = named ? classifyHead(named, { guess: false }) : null;
  const organization = ["business", "company", "organization", "investor"];
  let current = target.entity_type.value;

  // Seeking employment is an actor relation: its subject is a person. This is
  // the same invariant the deterministic extractor already applies, and it
  // must outrank occupational nouns that can also name a practice (for example
  // an electrician). A job target is handled separately below because the
  // posting itself is not the seeker.
  if (relation.type.value === "seeking_job" && current !== "person" && current !== "job") {
    const previous = current;
    target.entity_type = {
      value: "person",
      raw: target.entity_type.raw,
      confidence: relation.type.confidence,
    };
    current = "person";
    if (target.category && !target.role) {
      target.role = target.category;
      target.category = null;
    }
    repairs.push({
      code: "SEEKING_JOB_SUBJECT_PERSON",
      message: `seeking employment makes the subject a person rather than ${previous}`,
      path: `${targetPath}.entity_type`,
    });
  }
  const flip =
    head && !head.ambiguous && !target.entity_ambiguous && head.confidence >= 0.8
      ? head.kind === "person" && organization.includes(current)
        ? "person"
        : organization.includes(head.kind) &&
            current === "person" &&
            relation.type.value !== "seeking_job"
          ? head.kind
          : null
      : null;
  if (flip && isEntityType(flip)) {
    const from = flip === "person" ? ("category" as const) : ("role" as const);
    const to = flip === "person" ? ("role" as const) : ("category" as const);
    repairs.push({
      code: "ENTITY_TYPE_FROM_HEAD_NOUN",
      message: `"${named}" heads a ${flip}, so entity_type is ${flip} rather than ${current}`,
      path: `${targetPath}.entity_type`,
    });
    target.entity_type = { value: flip, raw: target.entity_type.raw, confidence: head!.confidence };
    if (target[from] && !target[to]) {
      target[to] = target[from];
      target[from] = null;
      repairs.push({
        code: "DESCRIPTOR_MOVED_WITH_ENTITY_TYPE",
        message: `"${named}" describes a ${flip}, so it is a ${to} rather than a ${from}`,
        path: `${targetPath}.${to}`,
      });
    }
  }

  // A plural premises-trade compound in a local lead search ("wedding
  // photographers in Cebu", "mechanics in Leeds") asks for the practices
  // people book — the deterministic extractor types the same noun business,
  // so the model's person reading must not send the run down the people
  // pipeline. Ambiguous heads never flip silently: the other reading stays
  // declared via entity_ambiguous, and a singular/article wording ("a wedding
  // photographer") or any relation verb keeps the person reading.
  const rawNamed = target.role?.raw ?? target.category?.raw ?? target.entity_type.raw ?? named ?? "";
  if (
    localLeadDiscovery &&
    relation.type.value === "none" &&
    current === "person" &&
    head && head.ambiguous && head.kind === "business" &&
    named && /(?:[^aeiou]s|ies|sses)$/i.test(named.trim()) &&
    !/\b(?:a|an|one)\s+(?:\w+\s+){0,3}\w+$/i.test(rawNamed.trim())
  ) {
    target.entity_type = {
      value: "business",
      raw: target.entity_type.raw,
      confidence: Math.max(head.confidence, 0.75),
    };
    target.entity_ambiguous = true;
    if (target.role && !target.category) {
      target.category = target.role;
      target.role = null;
    }
    repairs.push({
      code: "PLURAL_PREMISES_TRADE_BUSINESS",
      message: `"${named}" in a local lead search reads as the practices they run — entity_type is business (ambiguous) rather than person`,
      path: `${targetPath}.entity_type`,
    });
  }

  // A geographically scoped lead search normally asks for local entities, but
  // an open noun can also name the thing they provide ("showrooms" versus a
  // product sold by them). Prefer an explicit establishment head. For a bare,
  // unrecognized plural, use the lead-search prior but preserve the genuine
  // product/business ambiguity. Multiword artifact phrases retain the model's
  // product reading; their modifier is meaningful evidence, not mere locality.
  if (
    localLeadDiscovery &&
    relation.type.value === "none" &&
    target.entity_type.value === "product" &&
    named
  ) {
    const surface = nounPhrase(target.category?.raw ?? target.role?.raw ?? named);
    const contextualHead = surface ? classifyHead(surface) : null;
    const explicitOrganization =
      head && !head.ambiguous && head.confidence >= 0.8 && organization.includes(head.kind);
    const barePluralAmbiguity =
      head?.kind === "unknown" &&
      contextualHead?.kind === "business" &&
      contextualHead.ambiguous &&
      contextualHead.guessed === true &&
      contextualHead.modifiers.length === 0;

    if (explicitOrganization || barePluralAmbiguity) {
      target.entity_type = {
        value: explicitOrganization && isEntityType(head.kind) ? head.kind : "business",
        raw: target.entity_type.raw,
        confidence: explicitOrganization ? head.confidence : contextualHead!.confidence,
      };
      if (barePluralAmbiguity) target.entity_ambiguous = true;
      repairs.push({
        code: barePluralAmbiguity
          ? "LOCAL_LEAD_ENTITY_AMBIGUITY"
          : "LOCAL_LEAD_ESTABLISHMENT_HEAD",
        message: barePluralAmbiguity
          ? `bare local lead target "${surface}" can name a business or product; preferring business`
          : `"${named}" explicitly heads an establishment rather than a product`,
        path: `${targetPath}.entity_type`,
      });
    }
  }

  for (const slot of ["category", "role"] as const) {
    const held = target[slot];
    if (!held || narrowsTarget(held.value) || narrowsTarget(held.normalized)) continue;
    repairs.push({
      code: "GENERIC_DESCRIPTOR_DROPPED",
      message: `${slot} "${held.value}" only restates entity_type "${target.entity_type.value}" — it narrows nothing`,
      path: `${targetPath}.${slot}`,
    });
    target[slot] = null;
  }

  for (const slot of REHARVESTABLE) {
    if (slot === "industry" && relation.type.value === "offers_service" && /\bbrands?\b/i.test(target.category?.value ?? "")) continue;
    const held = target[slot];
    const span = spanOf(held);
    if (!span) continue;
    const wider = widerSpanHolder(target, relation, slot, span, targetPath, relationPath);
    if (!wider) continue;
    repairs.push({
      code: "SPAN_HARVESTED_TWICE",
      message: `${slot} "${held!.value}" was cut out of ${wider} — one word cannot narrow twice`,
      path: `${targetPath}.${slot}`,
    });
    target[slot] = null;
  }

  const entityType = target.entity_type.value;

  // A posting is the thing being discovered; it is not an actor seeking
  // employment. Keep that categorically separate from a PERSON looking for
  // work (`seeking_job`) and an employer looking for a person (`hiring`). The
  // job target already carries the title, while task and mode describe the
  // search, so a relation here would add a false proposition.
  const postingWasMadeAnActor =
    entityType === "job" && ["seeking_job", "hiring"].includes(relation.type.value);
  if (postingWasMadeAnActor) {
    relation.type = {
      value: "none",
      raw: null,
      confidence: relation.type.confidence,
    };
    relation.object = null;
    relation.label = null;
    relation.direction = {
      value: "none",
      raw: null,
      confidence: relation.direction.confidence,
    };
    repairs.push({
      code: "JOB_POSTING_RELATION_NONE",
      message:
        'a job posting is the target of discovery, not a job seeker or employer; relation is "none"',
      path: `${relationPath}.type`,
    });
  }
  const namesAKind =
    target.entity_subtype ??
    target.category ??
    target.business_type ??
    target.industry ??
    target.niche ??
    target.role;
  if (checkTargetCompleteness && (entityType === "other" || entityType === "organization") && !namesAKind) {
    violations.push({
      code: "ENTITY_SUBTYPE_MISSING",
      severity: "error",
      message: `entity_type "${entityType}" is too vague on its own — it needs a subtype or category (clinic, nonprofit, school, ...)`,
      path: `${targetPath}.entity_subtype`,
    });
  }

  const roleN = normalizeOpen(target.role, (v) => {
    const r = normalizeRole(v);
    return r && r !== v.trim().toLowerCase() ? r : null;
  });
  if (roleN.changed) {
    target.role = roleN.value;
    repairs.push({
      code: "ROLE_NORMALIZED",
      message: `role -> ${roleN.value?.normalized}`,
      path: `${targetPath}.role`,
    });
  }

  const objN = normalizeOpen(relation.object, (v) => canonicalize(v));
  if (objN.changed) {
    relation.object = objN.value;
    repairs.push({
      code: "OBJECT_NORMALIZED",
      message: `object -> ${objN.value?.normalized}`,
      path: `${relationPath}.object`,
    });
  }

}

type FrameTemporal = NonNullable<UnderstandingFrame["temporal"]>;

/**
 * Normalize temporal meaning from its provenance span. Calendar periods and
 * trailing durations are not interchangeable: "this month" is the current
 * calendar month, while "within the last month" is a rolling one-month window.
 * The same helper is used for root and compound-subgoal temporal fields.
 */
function normalizeTemporalCore(
  temporal: FrameTemporal,
  sourceText: string | null | undefined,
  path: string,
  violations: Violation[],
  repairs: Repair[],
): void {
  const source = temporal.raw?.trim() || sourceText?.trim() || "";
  const parsed = source ? detectTemporalDeterministic(source).temporal : null;
  if (parsed) {
    const relationChanged = temporal.relation !== parsed.relation;
    const windowChanged = temporal.window !== parsed.window;
    const yearChanged = temporal.year !== parsed.year;
    if (relationChanged || windowChanged || yearChanged) {
      repairs.push({
        code: "TEMPORAL_FROM_RAW",
        message: `"${parsed.raw ?? source}" means ${parsed.relation}`,
        path: `${path}.relation`,
      });
      temporal.relation = parsed.relation;
      temporal.window = parsed.window;
      temporal.year = parsed.year;
    }
    temporal.raw ??= parsed.raw;
  }

  if (temporal.relation === "within_last" && !temporal.window) {
    violations.push({
      code: "TEMPORAL_WINDOW_MISSING",
      severity: "error",
      message: '"within_last" needs a window — within the last WHAT?',
      path: `${path}.window`,
    });
  }

  const keyed = canonicalWindow(temporal.window);
  if (keyed && keyed !== temporal.window) {
    repairs.push({
      code: "TEMPORAL_WINDOW_KEYED",
      message: `window "${temporal.window}" keyed as ${keyed}`,
      path: `${path}.window`,
    });
    temporal.window = keyed;
  }

  if (temporal.relation === "in_year" && temporal.year == null) {
    const derived = yearFrom(temporal.raw) ?? yearFrom(sourceText);
    if (derived == null) {
      violations.push({
        code: "TEMPORAL_YEAR_MISSING",
        severity: "error",
        message: '"in_year" needs a year',
        path: `${path}.year`,
      });
    } else {
      temporal.year = derived;
      repairs.push({
        code: "TEMPORAL_YEAR_DERIVED",
        message: `"${temporal.raw ?? sourceText}" reads as ${derived}`,
        path: `${path}.year`,
      });
    }
  }
}

// ── The validator ─────────────────────────────────────────────────────────

export function validateFrame(input: UnderstandingFrame): ValidationResult {
  const frame = clone(input);
  const violations: Violation[] = [];
  const repairs: Repair[] = [];

  const raw = frame.input.raw ?? "";

  // — one fact, one key ——————————————————————————————————————————————
  //
  // Done before anything reads a constraint, so every later rule — the absence
  // converse below, the duplicate check on the lacks_asset side — compares one
  // spelling against one spelling rather than against whichever the extractor
  // happened to produce.

  for (const c of frame.constraints) {
    const key = fieldKey(c.field);
    if (key !== c.field) {
      repairs.push({
        code: "CONSTRAINT_FIELD_KEYED",
        message: `constraint field "${c.field}" keyed as ${key}`,
        path: "constraints",
      });
      c.field = key;
    }
  }
  {
    const seen = new Set<string>();
    frame.constraints = frame.constraints.filter((c) => {
      const key = JSON.stringify([c.field, c.operator, c.value, c.unit, c.negated]);
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      repairs.push({
        code: "CONSTRAINT_SEMANTIC_DEDUPED",
        message: `duplicate ${c.field} ${c.operator} constraint removed after field normalization`,
        path: "constraints",
      });
      return false;
    });
  }

  // A DELIVERED field is a key for the same reason a filtered one is: something
  // downstream selects columns by it and decides which rows are usable without
  // it. One model answered "Give me 100 quilt shops in Bergen, phone number
  // required, Instagram if possible" with `phone number` / `Instagram` and the
  // same model answered the same sentence about farriers with `phone` /
  // `instagram` — two row shapes for one request, decided by nothing the user
  // said.
  //
  // Only a field the vocabulary RECOGNIZES is keyed. "their VAT number" is a
  // genuine ask and stays in the user's words; slugging it to `vat_number`
  // would dress an unknown ask as a known column. `raw` is untouched either
  // way, so the inspector still shows what was typed.
  for (const list of [
    { name: "required_fields", items: frame.required_fields },
    { name: "preferred_fields", items: frame.preferred_fields },
    { name: "contact_requirements", items: frame.contact_requirements },
  ] as const) {
    const seen = new Set<string>();
    const kept: OpenValue[] = [];
    for (const f of list.items) {
      const keyed = keyDeliverableField(f.value) ?? f.value.trim().toLowerCase();
      // A family answered where a member was asked for is a wider request than
      // the one typed — "insta if possible" came back as `socials`, three
      // columns for a sentence that named one. The raw span decides, and it
      // only ever narrows: a value already as specific as the span is left be.
      const narrower = namedFamilyMember(keyed, f.raw);
      const key = narrower ?? keyed;
      if (key !== f.value) {
        repairs.push({
          code: narrower ? "FIELD_NARROWED_TO_NAMED_CHANNEL" : "FIELD_NAME_KEYED",
          message: narrower
            ? `${list.name} "${f.value}" narrowed to ${key} — the request names that channel`
            : `${list.name} "${f.value}" keyed as ${key}`,
          path: list.name,
        });
        f.raw ??= f.value;
        f.value = key;
      }
      // Keying can collapse two spellings into one entry — "phone" beside
      // "phone number" is one column asked for twice.
      if (seen.has(key)) {
        repairs.push({
          code: "FIELD_NAME_DEDUPED",
          message: `${list.name} names ${key} more than once`,
          path: list.name,
        });
        continue;
      }
      seen.add(key);
      kept.push(f);
    }
    if (list.name === "required_fields") frame.required_fields = kept;
    else if (list.name === "preferred_fields") frame.preferred_fields = kept;
    else frame.contact_requirements = kept;
  }

  // — a hedged ask is not a requirement ——————————————————————————————
  //
  // A required field is a filter: a row without it is dropped. So reading
  // "phone would b great" as a requirement discards rows the user would have
  // taken, and the hedge is right there in the span. A model answered exactly
  // that, and the deterministic reader did too until the marker learnt the
  // slang spelling of "be" — one cue list now serves both (`hedgesTheAsk`).
  //
  // The reverse is never done: an unhedged ask stays where the extractor put
  // it, because plenty of preferred fields are asked for plainly and promoting
  // those would invent the filter this repair exists to remove.
  {
    const hedged = frame.required_fields.filter((f) => hedgesTheAsk(f.raw));
    if (hedged.length) {
      frame.required_fields = frame.required_fields.filter((f) => !hedgesTheAsk(f.raw));
      for (const f of hedged) {
        repairs.push({
          code: "FIELD_HEDGED_NOT_REQUIRED",
          message: `"${f.raw}" hedges the ask, so ${f.value} is preferred, not required`,
          path: "required_fields",
        });
        if (!frame.preferred_fields.some((p) => p.value === f.value)) frame.preferred_fields.push(f);
      }
    }
  }

  // — an ask the extraction read past ————————————————————————————————
  //
  // "…funded this yr + founders names if u can" came back with the funding and
  // the year and no owner_name, while the same model on the same sentence shape
  // about a different trade kept it. A dropped field is the quietest loss a
  // frame can carry: nothing else in it disagrees, so no invariant fires and
  // the run reads as a clean pass with a stated wish missing.
  //
  // The deterministic reader is re-run over the raw input and only what IT
  // finds is added. It wants a marker word AND a field the vocabulary
  // recognizes, so this cannot mint a column out of prose, and the bucket is
  // the one it chose — a hedge stays a preference.
  //
  // `name` and `evidence` are excluded because that reader INFERS them: every
  // request implies a name, and `evidence` restates a verification ask that
  // lives in its own list. Importing an inference would invent the requirement
  // this repair exists to stop losing.
  {
    const already = new Set(
      [...frame.required_fields, ...frame.preferred_fields, ...frame.contact_requirements].map(
        (f) => f.value,
      ),
    );
    const read = fieldRequirements(frame.input.raw ?? "");
    for (const [bucket, items] of [
      ["required_fields", read.required],
      ["preferred_fields", read.preferred],
    ] as const) {
      for (const f of items) {
        if (f.value === "name" || f.value === "evidence") continue;
        if (already.has(f.value)) continue;
        already.add(f.value);
        frame[bucket].push(f);
        repairs.push({
          code: "FIELD_RECOVERED_FROM_INPUT",
          message: `"${f.raw}" asks for ${f.value}, which the extraction did not carry`,
          path: bucket,
        });
      }
    }
  }

  // — an absence stated as a constraint IS lacks_asset ————————————————
  //
  // The converse of the rule further down, which turns lacks_asset(X) into a
  // negated `exists` constraint on X. Only that one direction existed, so one
  // meaning had two legal encodings: "sailmakers in Salta with no phone
  // number" came back from one extractor as lacks_asset(phone) and from
  // another as relation=none plus NOT exists(phone). Both are lossless and
  // only one is canonical, so every reader of `relation` saw plain discovery
  // for half of them — and the mode stayed fit_based when the whole point of
  // the request was the absence.
  //
  // Derived here, ahead of the read below, so the existing cascade does the
  // rest by itself: the mode becomes opportunity_based, the evidence flags
  // follow the relation, and the constraint rule further down finds its
  // constraint already present and writes nothing.
  //
  // Gated on `none` so a stated relation is never overwritten. "clinics in
  // Kaunas hiring nurses, no website" keeps `hiring`; its absence stays a
  // constraint, which is the correct reading — the absence qualifies the
  // target there, it is not what the user is looking for.

  if (frame.relation.type.value === "none") {
    const absence = frame.constraints.find(
      (c) => c.negated && c.operator === "exists" && c.field.trim().length > 0,
    );
    if (absence) {
      const field = absence.field.trim();
      frame.relation.type = {
        value: "lacks_asset",
        raw: frame.relation.type.raw,
        confidence: absence.confidence,
      };
      frame.relation.object ??= openValue(
        field,
        absence.raw,
        canonicalize(field) ?? field,
        absence.confidence,
      );
      frame.relation.direction = {
        value: "subject_to_object",
        raw: frame.relation.direction.raw,
        confidence: absence.confidence,
      };
      repairs.push({
        code: "ABSENCE_RELATION_DERIVED",
        message: `a negated "${field}" is an absence, so the relation is lacks_asset(${field}) rather than plain discovery`,
        path: "relation.type",
      });
    }
  }

  // — a custom relation our ontology does have a member for ——————————————
  //
  // "businesses partnered with Contentful" and "businesses partnered with
  // Twilio" both came back as `custom`, and each then failed a different way:
  // one carried the object and no label, the other the label and no object. The
  // relationship was read correctly both times — `partnered_with` is a member,
  // and the model reached for the escape hatch instead of it.
  //
  // So the wording is re-read by the SAME reader the deterministic extractor
  // uses (`detectRelation`), over the span the model itself recorded. That is
  // deliberately not a second cue table living here: a copy would let the
  // member a frame is given and the member a frame is graded against disagree
  // about the same three words. Measured over the labels this escape actually
  // receives, it names a member for the four that have one — partnered
  // with/partners with/integrated with, using X, attending X, hiring X — and
  // reports none for the ones that genuinely have not ("accredited by the CQC",
  // "regulated by the FCA", "franchisees of a chain"), which stay custom.
  //
  // Renaming, not reinterpreting: the model's own confidence and direction are
  // kept, and the object is only FILLED when absent. A frame that already said
  // which way round the relation points is never argued with.

  if (frame.relation.type.value === "custom") {
    const said = frame.relation.label?.trim() || frame.relation.type.raw?.trim() || "";
    const subject = classifyHead(
      frame.target.role?.value ??
        frame.target.category?.value ??
        frame.target.entity_type.raw ??
        frame.target.entity_type.value,
    );
    const member = said ? detectRelation(said, subject) : null;
    const named = member && member.type !== "custom" && member.type !== "none" && member.type !== "unknown";

    if (named) {
      repairs.push({
        code: "CUSTOM_RELATION_IS_A_MEMBER",
        message: `"${said}" is ${member.type}, which our ontology has a member for — custom is for what it does not`,
        path: "relation.type",
      });
      frame.relation.type = {
        value: member.type,
        raw: frame.relation.type.raw ?? said,
        confidence: frame.relation.type.confidence,
      };
      frame.relation.label = null;
      frame.relation.object ??= member.object;
      if (frame.relation.direction.value === "unknown" && member.direction !== "unknown") {
        frame.relation.direction = {
          value: member.direction,
          raw: frame.relation.direction.raw,
          confidence: member.confidence,
        };
      }
    } else if (!frame.relation.label?.trim() && said) {
      // Still custom, and the label is where its meaning lives. `type.raw` is
      // the wording the type was read from, so the label is recoverable exactly
      // — asking the model to repeat one span into two fields is a structural
      // tax, and the violation it earns says nothing a reader did not know.
      frame.relation.label = said.slice(0, 200);
      repairs.push({
        code: "CUSTOM_RELATION_LABEL_FROM_RAW",
        message: `custom relation labelled "${said}" from the span it was read off`,
        path: "relation.label",
      });
    }
  }

  // Root and nested semantic cores enter through the same normalizer. Run the
  // root before relation-dependent checks so every later invariant observes
  // the normalized relation.
  normalizeSemanticCore(
    frame.target,
    frame.relation,
    "target",
    "relation",
    violations,
    repairs,
    false,
    frame.task_type.value === "lead_discovery" && frame.location !== null,
  );
  const relation = frame.relation.type.value;

  // — structural completeness —————————————————————————————————————

  if (relation === "custom" && !frame.relation.label?.trim()) {
    violations.push({
      code: "CUSTOM_RELATION_WITHOUT_LABEL",
      severity: "error",
      message:
        'relation.type is "custom" but no label was given — a custom relation carries its meaning in the label',
      path: "relation.label",
    });
  }

  // — the three relation escapes mean three different things ————————————
  //
  // Collapsing them is what made plain discovery ask what should be true of
  // the restaurants. `none` is a confident answer, `unknown` is a failure to
  // read, `custom` is a success that our ontology has no member for.

  if (relation === "none") {
    if (frame.relation.object) {
      violations.push({
        code: "NONE_RELATION_WITH_OBJECT",
        severity: "error",
        message:
          'relation.type is "none" but an object was recorded — either no relationship was requested, or there is one and it needs naming',
        path: "relation.object",
      });
    }
    if (frame.relation.direction.value !== "none") {
      frame.relation.direction = { value: "none", raw: null, confidence: frame.relation.type.confidence };
      repairs.push({
        code: "DIRECTION_NONE",
        message: 'no relation was requested, so direction is "none" rather than unknown',
        path: "relation.direction",
      });
    }
  }

  if (relation === "unknown") {
    // Something in the wording must have suggested a relationship. If nothing
    // did, `unknown` is the layer failing to notice a plain request and the
    // honest answer is `none` — but that is a MEANING change, so it is a
    // violation for a reviewer rather than a silent rewrite.
    if (!RELATION_SIGNAL_RE.test(raw)) {
      violations.push({
        code: "UNKNOWN_RELATION_WITHOUT_SIGNAL",
        severity: "error",
        message:
          'relation.type is "unknown" but the text carries no relationship wording — plain entity discovery is relation "none", not a parse failure',
        path: "relation.type",
      });
    }
    if (frame.relation.direction.value !== "unknown") {
      violations.push({
        code: "UNKNOWN_RELATION_WITH_DIRECTION",
        severity: "warning",
        message: "the relation could not be read, so its direction cannot be known either",
        path: "relation.direction",
      });
    }
  }

  // — the head noun decides person-or-organization ——————————————————————
  //
  // "wind turbine technicians in Ann Arbor hiring orthodontists" came back as a
  // BUSINESS with a category of "wind turbine technician": the model read the
  // employer off the verb ("who hires? a company") and overruled the noun that
  // says whose request this is. The head noun is the more reliable witness, and
  // it is the same table the deterministic reader answers from — so this is one
  // answer reaching both extractors, not a second opinion about the sentence.
  //
  // Three things keep it narrow:
  //   · `guess: false` withholds the shape-based backstops, so an unrecognised
  //     vertical ("waste haulage", "saunas") returns `unknown` and nothing is
  //     touched. The open-world contract is why the LLM is the production path;
  //     this repair must never spend it.
  //   · a head the table itself calls ambiguous is left alone — "orthodontists"
  //     and "quantity surveyors" are legitimately either, which is what
  //     `entity_ambiguous` exists to say. A frame already flying that flag is
  //     likewise left alone.
  //   · only person↔organization flips. `business` vs `company` is one class to
  //     every reader in the engine (vocab.ts), so trading them would be churn.
  {
    const nounPhrase = (said: string | null | undefined): string | null => {
      const span = said?.trim().replace(/\s+/g, " ");
      if (!span) return null;
      // Only a bare noun phrase. A wide span — the whole sentence, or a clause
      // carrying the relation — ends on the WRONG head: the last noun of
      // "technicians in Ann Arbor hiring orthodontists" is the object.
      if (span.split(" ").length > 5) return null;
      if (RELATION_SIGNAL_RE.test(span)) return null;
      return span;
    };
    // `entity_type.raw` is a witness in its own right, and sometimes the only
    // one: "brand strategists in Aberystwyth hiring brand strategists" came
    // back as a business whose role and category were both null, with the
    // occupation recorded nowhere but that span. Read last, so a descriptor the
    // model did fill still decides.
    const said = (ov: OpenValue | null | undefined) => nounPhrase(ov?.value ?? ov?.raw);
    const named =
      said(frame.target.role) ?? said(frame.target.category) ?? nounPhrase(frame.target.entity_type.raw);
    const head = named ? classifyHead(named, { guess: false }) : null;
    const organization = ["business", "company", "organization", "investor"];
    const current = frame.target.entity_type.value;
    const flip =
      head && !head.ambiguous && !frame.target.entity_ambiguous && head.confidence >= 0.8
        ? head.kind === "person" && organization.includes(current)
          ? "person"
        : organization.includes(head.kind) &&
            current === "person" &&
            frame.relation.type.value !== "seeking_job"
            ? head.kind
            : null
        : null;
    if (flip && isEntityType(flip)) {
      const from = flip === "person" ? ("category" as const) : ("role" as const);
      const to = flip === "person" ? ("role" as const) : ("category" as const);
      repairs.push({
        code: "ENTITY_TYPE_FROM_HEAD_NOUN",
        message: `"${named}" heads a ${flip}, so entity_type is ${flip} rather than ${current}`,
        path: "target.entity_type",
      });
      frame.target.entity_type = {
        value: flip,
        raw: frame.target.entity_type.raw,
        confidence: head!.confidence,
      };
      // The word itself moves with the reading: an occupation is a role, not a
      // business category, and a search reading `category` would filter the
      // wrong column for it.
      if (frame.target[from] && !frame.target[to]) {
        frame.target[to] = frame.target[from];
        frame.target[from] = null;
        repairs.push({
          code: "DESCRIPTOR_MOVED_WITH_ENTITY_TYPE",
          message: `"${named}" describes a ${flip}, so it is a ${to} rather than a ${from}`,
          path: `target.${to}`,
        });
      }
    }
  }

  // A descriptor that only restates the entity type narrows nothing: "firms in
  // Maribor" is a request about businesses, and a category of "firm" adds a
  // filter that every candidate satisfies. The deterministic extractor has
  // always refused to write one; the rule lives HERE as well because the LLM is
  // the production path and its frames never met it — which is how
  // `category = "firm"` reached a graded holdout frame.
  //
  // The word is not lost: `entity_type.raw` and `input.raw` still carry it.
  for (const slot of ["category", "role"] as const) {
    const held = frame.target[slot];
    if (!held || narrowsTarget(held.value) || narrowsTarget(held.normalized)) continue;
    repairs.push({
      code: "GENERIC_DESCRIPTOR_DROPPED",
      message: `${slot} "${held.value}" only restates entity_type "${frame.target.entity_type.value}" — it narrows nothing`,
      path: `target.${slot}`,
    });
    frame.target[slot] = null;
  }

  // One word, one field. A model that has been told every narrowing word must
  // land somewhere will sometimes land one TWICE: "seed libraries" arrived as
  // category "seed library" AND company_stage "seed", which claims the place
  // was funded at seed stage — a qualification nobody typed, and one a search
  // would then demand. "freelance medical writers" grew an industry of
  // "medical" out of the middle of its own role. The tell is containment: the
  // narrow field's span sits INSIDE a span another field already recorded
  // whole.
  //
  // The wider span wins, because it is the phrase the user actually typed. A
  // tie goes to relation.object — "firms that provide voiceover" states the
  // relation in a clause, so a category of "voiceover" is the invented half.
  // Spans that merely sit side by side ("seed-stage fintechs" -> stage
  // "seed-stage" + category "fintechs") contain nothing and are left alone.
  for (const slot of REHARVESTABLE) {
    // A brand's sold product can also name its market: "brands selling
    // skincare" needs the offer relation and skincare industry for retrieval.
    if (slot === "industry" && frame.relation.type.value === "offers_service" && /\bbrands?\b/i.test(frame.target.category?.value ?? "")) continue;
    const held = frame.target[slot];
    const span = spanOf(held);
    if (!span) continue;
    const wider = widerSpanHolder(frame.target, frame.relation, slot, span, "target", "relation");
    if (!wider) continue;
    repairs.push({
      code: "SPAN_HARVESTED_TWICE",
      message: `${slot} "${held!.value}" was cut out of ${wider} — one word cannot narrow twice`,
      path: `target.${slot}`,
    });
    frame.target[slot] = null;
  }

  const entityType = frame.target.entity_type.value;
  // `organization` and `other` are the deliberately vague members, so something
  // has to say WHICH kind. A subtype is the named slot for it, but a category,
  // business type or industry answers the same question — "nonprofits in
  // Nairobi" arrives as organization + category "nonprofit" and is not missing
  // anything. Only a frame carrying no descriptor at all is incomplete.
  const namesAKind =
    frame.target.entity_subtype ??
    frame.target.category ??
    frame.target.business_type ??
    frame.target.industry ??
    frame.target.niche ??
    frame.target.role;
  if ((entityType === "other" || entityType === "organization") && !namesAKind) {
    violations.push({
      code: "ENTITY_SUBTYPE_MISSING",
      severity: "error",
      message: `entity_type "${entityType}" is too vague on its own — it needs a subtype or category (clinic, nonprofit, school, ...)`,
      path: "target.entity_subtype",
    });
  }

  if (RELATIONS_REQUIRING_OBJECT.includes(relation) && !frame.relation.object) {
    violations.push({
      code: "RELATION_OBJECT_MISSING",
      severity: "error",
      message: `relation "${relation}" needs an object`,
      path: "relation.object",
    });
  }

  if (
    DIRECTIONAL_RELATIONS.includes(relation) &&
    frame.relation.direction.value === "unknown"
  ) {
    violations.push({
      code: "DIRECTION_UNKNOWN",
      severity: "error",
      message: `relation "${relation}" is directional but direction is unknown — this is the distinction between offering and needing`,
      path: "relation.direction",
    });
  }

  // — direction contradictions ————————————————————————————————————
  //
  // The rule is about DIRECTION, not about the subject's entity type. A
  // founder hiring on behalf of their company is a person subject and a
  // perfectly valid hiring frame; requiring an employer-shaped subject would
  // reject the single most common people query we have.

  const saysSeekingWork = SEEKING_WORK_RE.test(raw);
  const saysHiring = HIRING_RE.test(raw);

  if (relation === "hiring" && saysSeekingWork && !saysHiring) {
    violations.push({
      code: "CONTRADICTORY_DIRECTION",
      severity: "error",
      message:
        'the text describes someone looking for work, which is not "hiring" — did you mean seeking_job?',
      path: "relation.type",
    });
  }

  if (relation === "seeking_job" && saysHiring && !saysSeekingWork) {
    violations.push({
      code: "CONTRADICTORY_DIRECTION",
      severity: "error",
      message:
        'the text describes someone hiring, which is not "seeking_job" — did you mean hiring?',
      path: "relation.type",
    });
  }

  if (relation === "hiring") {
    const obj = frame.relation.object;
    const objCanon = obj ? (canonicalize(obj.value) ?? obj.value.toLowerCase()) : null;
    if (objCanon === "employment") {
      violations.push({
        code: "CONTRADICTORY_OBJECT",
        severity: "error",
        message: 'hiring acts on people, not on "employment" — this reads like seeking_job',
        path: "relation.object",
      });
    }
    if (frame.relation.direction.value === "object_to_subject") {
      violations.push({
        code: "DIRECTION_SUSPECT",
        severity: "warning",
        message: "hiring is normally subject_to_object (the employer acts on the role)",
        path: "relation.direction",
      });
    }
  }

  // — compound requests ——————————————————————————————————————————
  //
  // Never silently keep one half. Either both are represented, or the frame
  // does not get to claim it is compound.

  if (frame.compound.is_compound && frame.compound.subgoals.length < 2) {
    violations.push({
      code: "COMPOUND_WITHOUT_SUBGOALS",
      severity: "error",
      message:
        "the request was marked compound but fewer than two subgoals were extracted — the other half would be silently dropped",
      path: "compound.subgoals",
    });
  }
  if (!frame.compound.is_compound && frame.compound.subgoals.length > 1) {
    frame.compound.is_compound = true;
    repairs.push({
      code: "COMPOUND_INFERRED",
      message: "multiple subgoals present, marking the request compound",
      path: "compound.is_compound",
    });
  }

  propagateCompoundProvenance(frame, repairs);

  // A subgoal that says nothing is a dropped half wearing a placeholder. It
  // reads as a handled compound in the inspector, which is worse than an
  // honest clarification.
  frame.compound.subgoals.forEach((sg, i) => {
    const base = `compound.subgoals[${i}]`;
    normalizeSemanticCore(
      sg.target,
      sg.relation,
      `${base}.target`,
      `${base}.relation`,
      violations,
      repairs,
      true,
      frame.task_type.value === "lead_discovery" && sg.location !== null,
    );
    if (sg.temporal) {
      normalizeTemporalCore(sg.temporal, sg.raw, `${base}.temporal`, violations, repairs);
    }
    const carries =
      (sg.target?.role ?? sg.target?.category ?? sg.target?.industry ?? sg.target?.business_type) != null ||
      sg.location != null ||
      sg.relation != null;
    if (!carries) {
      violations.push({
        code: "SUBGOAL_EMPTY",
        severity: "error",
        message: `subgoal ${i + 1} names no target, place or relation — half the request is missing`,
        path: base,
      });
    }
  });

  // — prospecting mode ————————————————————————————————————————————
  //
  // The mode is what makes this a lead engine rather than a search box, so a
  // frame is not allowed to leave it unknown once the relation is known. Where
  // the relation implies exactly one mode, disagreement is a repair (the
  // relation is the stronger signal — it was read off the wording); where the
  // relation is `none`, the mode follows the target.

  const impliedMode = MODE_BY_RELATION[relation];
  const mode = frame.prospecting_mode.value;

  if (impliedMode && mode !== impliedMode && mode !== "custom") {
    frame.prospecting_mode = {
      value: impliedMode,
      raw: frame.prospecting_mode.raw,
      confidence: Math.max(frame.prospecting_mode.confidence, frame.relation.type.confidence),
    };
    repairs.push({
      code: "MODE_FROM_RELATION",
      message: `relation "${relation}" implies prospecting_mode ${impliedMode} (was ${mode})`,
      path: "prospecting_mode",
    });
  } else if (relation === "none" && (mode === "unknown" || mode === "intent_based")) {
    const fallbackMode: ProspectingMode = entityType === "job" ? "job_based" : "fit_based";
    frame.prospecting_mode = {
      value: fallbackMode,
      raw: frame.prospecting_mode.raw,
      confidence: 0.7,
    };
    repairs.push({
      code: "MODE_FROM_TARGET",
      message: `no relationship was requested, so this is ${fallbackMode} discovery — not an intent search`,
      path: "prospecting_mode",
    });
  } else if (relation === "custom" && mode === "unknown") {
    // A relationship we understood but cannot name canonically has a mode we
    // cannot name either. "custom" says that honestly; "unknown" would claim we
    // failed to read a request we in fact read.
    frame.prospecting_mode = {
      value: "custom",
      raw: frame.prospecting_mode.raw,
      confidence: frame.relation.type.confidence,
    };
    repairs.push({
      code: "MODE_CUSTOM_FROM_RELATION",
      message: `the relation is custom ("${frame.relation.label ?? "unlabelled"}"), so the prospecting mode is custom too`,
      path: "prospecting_mode",
    });
  }

  if (frame.prospecting_mode.value === "unknown" && relation !== "unknown") {
    violations.push({
      code: "PROSPECTING_MODE_UNKNOWN",
      severity: "error",
      message:
        "prospecting_mode is unknown although the relation was read — every valid frame must say what kind of prospecting this is",
      path: "prospecting_mode",
    });
  }

  if (frame.prospecting_mode.value === "custom" && !frame.relation.label?.trim()) {
    violations.push({
      code: "CUSTOM_MODE_WITHOUT_LABEL",
      severity: "warning",
      message: 'prospecting_mode "custom" carries its meaning in relation.label, which is empty',
      path: "prospecting_mode",
    });
  }

  // — task type ———————————————————————————————————————————————
  //
  // This engine does one thing: it finds prospects. So a frame that names what
  // it is looking for IS a lead-discovery frame, and deriving that from the
  // entity type is bookkeeping rather than interpretation. The error is kept
  // for the case that remains genuinely unreadable — nothing to search for.

  if (frame.task_type.value === "unknown") {
    const readable = entityType !== "unknown" || relation !== "unknown";
    if (readable) {
      const derived = entityType === "job" ? "job_discovery" : "lead_discovery";
      frame.task_type = {
        value: derived,
        raw: frame.task_type.raw,
        confidence: Math.max(frame.task_type.confidence, 0.7),
      };
      repairs.push({
        code: "TASK_TYPE_FROM_TARGET",
        message:
          entityType !== "unknown"
            ? `a request naming a ${entityType} to find is ${derived}`
            : `a request naming a "${relation}" relationship to look for is ${derived}`,
        path: "task_type",
      });
    } else {
      violations.push({
        code: "TASK_TYPE_UNKNOWN",
        severity: "error",
        message: "task_type is unknown — a frame that does not say what is being attempted is not executable",
        path: "task_type",
      });
    }
  }

  // — location ————————————————————————————————————————————————

  // A location whose OWN span is the exclusion phrase is not a search area,
  // and no reading of the sentence makes it one: "excluding Gdansk" arrived as
  // {value: "Gdansk", raw: "excluding Gdansk", scope: "in"}, which searches the
  // one city the user ruled out. The deterministic reader cannot produce this
  // — it reads exclusions before places precisely so an excluded town cannot
  // become the positive one — so the guard lives here, where the model's
  // output arrives.
  //
  // Repaired rather than reported, unlike the contradiction below: which of
  // the two readings is the misread is normally a real question, and here the
  // span answers it. The exclusion survives as a constraint, synthesized when
  // the model did not also emit one, because dropping the location alone would
  // turn a misread into a lost filter.
  if (frame.location && opensWithExclusion(frame.location.raw)) {
    const place = frame.location.value.trim();
    const already = frame.constraints.some(
      (c) =>
        c.field === "location" &&
        (c.negated || c.operator === "neq") &&
        typeof c.value === "string" &&
        c.value.trim().toLowerCase() === place.toLowerCase(),
    );
    if (!already) {
      frame.constraints.push({
        field: "location",
        operator: "eq",
        value: place,
        unit: null,
        negated: true,
        raw: frame.location.raw,
        confidence: frame.location.confidence,
      });
    }
    repairs.push({
      code: "LOCATION_WAS_AN_EXCLUSION",
      message: `"${frame.location.raw}" excludes ${place} — it is not the area to search${
        already ? "" : ", and is kept as a constraint"
      }`,
      path: "location",
    });
    frame.location = null;
  }

  if (frame.location) {
    // Hallucinated-place guard: a live model once read "mostly north
    // america/europe" as location "North Salt Lake" (a real Utah city nobody
    // named), pinning a worldwide ask to one suburb. A location that is
    // neither a literal span of the user's text nor carries a raw span that
    // is, names no place the user asked about — drop it and let geo_scope
    // speak. Canonicalizations stay safe: "ny" (raw) or "Tallinn, Estonia"
    // both trace to the input. Punctuation is folded before matching, because
    // "Money, Mississippi" canonically reads "Money Mississippi".
    const fold = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
    const haystack = fold(frame.input.raw);
    const appears = (needle: string | null | undefined) =>
      !!needle && haystack.includes(fold(needle));
    const tracesToInput =
      appears(frame.location.value) || appears(frame.location.raw);
    if (!tracesToInput) {
      repairs.push({
        code: "LOCATION_NOT_IN_INPUT",
        message: `location "${frame.location.value}" does not come from the user's text — dropped rather than pinning the search to a place nobody named`,
        path: "location",
      });
      frame.meta.notes.push(`dropped unverifiable location "${frame.location.value}" (not in input)`);
      frame.location = null;
    }
  }

  if (frame.location) {
    // "outside Turku" searches AROUND Turku. A model answered one of these
    // `scope: "in"`, which is the reverse of the only reading the words have,
    // and it is not the exclusion handled above either. The deterministic
    // reader takes the same answer from the same preposition (`scopeFor`), so
    // both read one cue list. Repaired rather than reported: the span states
    // the direction outright, leaving no second reading for a question to
    // resolve.
    // `unknown` is the same repair, not a softer case of it. One run answered
    // "ouside turku" with `in` and "outside trois-rivières" with `unknown`,
    // from wording that differs by a typo — and an unknown scope is read
    // downstream as "no instruction about the area", which is exactly what
    // "outside" was. Fixing only the reversed one leaves the same sentence
    // landing two ways.
    if (
      (frame.location.scope === "in" || frame.location.scope === "unknown") &&
      opensWithNearCue(frame.location.raw)
    ) {
      repairs.push({
        code: "LOCATION_SCOPE_FROM_RAW",
        message:
          frame.location.scope === "in"
            ? `"${frame.location.raw}" searches near ${frame.location.value}, not inside it`
            : `"${frame.location.raw}" says which way to look from ${frame.location.value} — that is not an unknown scope`,
        path: "location.scope",
      });
      frame.location.scope = "near";
    }

    if (frame.location.scope === "within_radius" && frame.location.radius == null) {
      violations.push({
        code: "RADIUS_MISSING",
        severity: "error",
        message: 'scope "within_radius" needs a radius',
        path: "location.radius",
      });
    }

    // A temporal phrase is never a place. "in the last two weeks" reaches the
    // place parser looking exactly like "in Lisbon", and the frame that came
    // back from it had a location nobody could search and no temporal at all.
    if (isTemporalPhrase(frame.location.value)) {
      violations.push({
        code: "TEMPORAL_AS_LOCATION",
        severity: "error",
        message: `"${frame.location.value}" is a time expression, not a place — this belongs in temporal`,
        path: "location.value",
      });
    }

    // A place span that swallowed the rest of the sentence is the failure that
    // let "around Trondheim trying to hire embedded engineers right now" pass
    // as a location. Two independent symptoms, either of which is conclusive.
    if (RELATION_SIGNAL_RE.test(frame.location.value)) {
      violations.push({
        code: "LOCATION_CONTAINS_RELATION",
        severity: "error",
        message: `the location "${frame.location.value}" contains relationship wording — the place span did not stop at the clause boundary`,
        path: "location.value",
      });
    }
    if (frame.location.value.trim().split(/\s+/).length > 5) {
      violations.push({
        code: "LOCATION_OVERLONG",
        severity: "error",
        message: `the location "${frame.location.value}" is too long to be a place name`,
        path: "location.value",
      });
    }

    // "excluding Toronto" must never coexist with location = Toronto. This is
    // the whole request inverted, and it reads as a plausible frame.
    const positive = frame.location.value.trim().toLowerCase();
    const excluded = frame.constraints.find(
      (c) =>
        c.field === "location" &&
        (c.negated || c.operator === "neq") &&
        typeof c.value === "string" &&
        c.value.trim().toLowerCase() === positive,
    );
    if (excluded) {
      violations.push({
        code: "LOCATION_EXCLUDED_AND_REQUIRED",
        severity: "error",
        message: `"${frame.location.value}" is both the search area and an exclusion — one of the two is a misread`,
        path: "location.value",
      });
    }
    // Canonicalization is a best effort by design: an obscure town that the
    // resolver has never heard of stays exactly as the user typed it, with
    // canonical null. Unknown places must not block understanding. A model
    // that merely echoed the typed span as "canonical" did not canonicalize.
    // The world gazetteer (when the server registered one) resolves real
    // cities and repairs a one-edit misspelling ("lipzig" -> Leipzig).
    const echoed = !!frame.location.canonical && frame.location.canonical.trim().toLowerCase() === frame.location.value.trim().toLowerCase();
    if (!frame.location.canonical || echoed) {
      const geo = resolveCanonicalLocation(frame.location.value, { gazetteer: true, correctTypos: true });
      if (geo?.name && (!echoed || geo.name !== frame.location.canonical || (geo.country_code && !frame.location.country_code))) {
        frame.location.canonical = geo.name;
        if (geo.country_code) frame.location.country_code = geo.country_code;
        repairs.push({
          code: "LOCATION_CANONICALIZED",
          message: `"${frame.location.value}" -> ${geo.name}`,
          path: "location.canonical",
        });
      }
    }
  }

  // — temporal ————————————————————————————————————————————————

  if (frame.temporal) {
    normalizeTemporalCore(frame.temporal, raw, "temporal", violations, repairs);
  }

  if (!frame.temporal || frame.temporal.relation === "unknown") {
    const direct = detectTemporalDeterministic(raw).temporal;
    if (direct) {
      frame.temporal = direct;
      repairs.push({
        code: "TEMPORAL_DERIVED",
        message: `temporal derived from the text: ${direct.relation}`,
        path: "temporal",
      });
    } else {
      const t = extractTemporal(raw);
      const rel = t.relation && isTemporalRelation(t.relation) ? t.relation : null;
      if (rel) {
        frame.temporal = {
          relation: rel,
          window: t.signal_recency,
          year: t.year,
          raw: null,
          confidence: 0.6,
        };
        repairs.push({
          code: "TEMPORAL_DERIVED",
          message: `temporal derived from the text: ${rel}`,
          path: "temporal",
        });
      }
    }
  }

  // — open descriptors: normalize, never reject ——————————————————————

  const roleN = normalizeOpen(frame.target.role, (v) => {
    const r = normalizeRole(v);
    return r && r !== v.trim().toLowerCase() ? r : null;
  });
  if (roleN.changed) {
    frame.target.role = roleN.value;
    repairs.push({
      code: "ROLE_NORMALIZED",
      message: `role -> ${roleN.value?.normalized}`,
      path: "target.role",
    });
  }

  const objN = normalizeOpen(frame.relation.object, (v) => canonicalize(v));
  if (objN.changed) {
    frame.relation.object = objN.value;
    repairs.push({
      code: "OBJECT_NORMALIZED",
      message: `object -> ${objN.value?.normalized}`,
      path: "relation.object",
    });
  }

  // — evidence obligations ————————————————————————————————————————

  const expected = EVIDENCE_BY_RELATION[relation];
  if (expected) {
    if (frame.evidence.claim_evidence_required !== expected.claim) {
      frame.evidence.claim_evidence_required = expected.claim;
      repairs.push({
        code: "CLAIM_EVIDENCE_SET",
        message: `relation "${relation}" implies claim_evidence_required=${expected.claim}`,
        path: "evidence.claim_evidence_required",
      });
    }
    if (frame.evidence.intent_signal_required !== expected.intent) {
      frame.evidence.intent_signal_required = expected.intent;
      repairs.push({
        code: "INTENT_SIGNAL_SET",
        message: `relation "${relation}" implies intent_signal_required=${expected.intent}`,
        path: "evidence.intent_signal_required",
      });
    }
  }
  if (relation === "investing_in" && /\b(?:actively|recent|recently|actual|current)\b/i.test(raw)) {
    frame.evidence.intent_signal_required = true;
  }

  // — lacks_asset(website) is a constraint, not just a relation ——————————
  //
  // Kept deliberately distinct from needs_service(website_creation): having no
  // website is an observable absence; wanting one built is a stated desire.

  if (relation === "lacks_asset") {
    const objCanon = frame.relation.object
      ? (frame.relation.object.normalized ??
        canonicalize(frame.relation.object.value) ??
        frame.relation.object.value.toLowerCase())
      : null;
    if (objCanon && !hasConstraint(frame.constraints, objCanon, "exists")) {
      frame.constraints.push({
        field: objCanon,
        operator: "exists",
        value: null,
        unit: null,
        negated: true,
        raw: frame.relation.object?.raw ?? null,
        confidence: frame.relation.type.confidence,
      });
      repairs.push({
        code: "ABSENCE_CONSTRAINT_ADDED",
        message: `lacks_asset(${objCanon}) recorded as a negated exists constraint`,
        path: "constraints",
      });
    }
  }

  // — extensible kinds need their label ——————————————————————————————

  // `business_exists` is a user-requested verification only when the input
  // explicitly asks to verify existence. A candidate existing is an internal
  // retrieval invariant, not provenance the model may invent from a few-shot
  // example. Other verification kinds retain their own stated raw spans.
  const explicitlyRequestsBusinessExistence =
    /\b(?:verify|confirm|check|prove|validate|ensure)\b[\s\S]{0,80}\b(?:exist|exists|existence|operating|legitimate|real)\b/i.test(raw) ||
    /\b(?:exist|exists|existence|operating|legitimate|real)\b[\s\S]{0,80}\b(?:verify|confirm|check|prove|validate|ensure)\b/i.test(raw);
  if (!explicitlyRequestsBusinessExistence) {
    const before = frame.verification.length;
    frame.verification = frame.verification.filter((v) => v.kind !== "business_exists");
    if (frame.verification.length !== before) {
      repairs.push({
        code: "UNSTATED_BUSINESS_EXISTS_DROPPED",
        message: "business_exists requires an explicit user verification request; candidate existence is not user provenance",
        path: "verification",
      });
    }
  }

  frame.verification.forEach((v, i) => {
    if (v.kind === "other" && !v.label?.trim()) {
      violations.push({
        code: "VERIFICATION_LABEL_MISSING",
        severity: "error",
        message: 'verification kind "other" needs a label saying what to verify',
        path: `verification[${i}].label`,
      });
    }
  });
  frame.output.forEach((o, i) => {
    if (o.kind === "other" && !o.label?.trim()) {
      violations.push({
        code: "OUTPUT_LABEL_MISSING",
        severity: "error",
        message: 'output kind "other" needs a label saying what to produce',
        path: `output[${i}].label`,
      });
    }
  });

  // — quantity sanity ————————————————————————————————————————————

  const q = frame.quantity;
  if (q) {
    if (q.requested != null && q.minimum != null && q.minimum > q.requested) {
      violations.push({
        code: "QUANTITY_INCONSISTENT",
        severity: "warning",
        message: "minimum exceeds requested",
        path: "quantity",
      });
    }
    if (q.minimum != null && q.maximum != null && q.minimum > q.maximum) {
      violations.push({
        code: "QUANTITY_INCONSISTENT",
        severity: "error",
        message: `minimum ${q.minimum} exceeds maximum ${q.maximum} — nothing can satisfy this`,
        path: "quantity",
      });
    }
    if (q.unlimited && (q.requested != null || q.maximum != null)) {
      violations.push({
        code: "QUANTITY_UNLIMITED_WITH_CAP",
        severity: "error",
        message: '"as many as possible" cannot also carry a requested count or a cap',
        path: "quantity",
      });
    }
    if (
      !q.unlimited &&
      q.requested == null &&
      q.minimum == null &&
      q.maximum == null
    ) {
      violations.push({
        code: "QUANTITY_EMPTY",
        severity: "warning",
        message: "a quantity was recorded with no number and no unlimited flag — it carries nothing",
        path: "quantity",
      });
    }
  }

  // — the user's offer is not the prospect's proven need ————————————————
  //
  // "I sell website design. Find me 100 local businesses in Alberta" must not
  // become business → needs_service(website design). The only evidence for
  // that relation would be the user's own sales pitch, which says nothing
  // about any prospect. A frame is allowed to carry BOTH — but only when the
  // prospect side was stated separately.

  const selling =
    frame.user_context?.selling?.service?.value ?? frame.user_context?.selling?.product?.value ?? null;
  if (selling && (relation === "needs_service" || relation === "asking_for_help")) {
    const objValue = frame.relation.object?.value ?? "";
    const sameThing =
      objValue.trim().toLowerCase() === selling.trim().toLowerCase() ||
      (frame.relation.object?.normalized != null &&
        frame.relation.object.normalized === canonicalize(selling));
    // The relation has to have been READ somewhere. If the object is simply
    // the user's own offer echoed back and no wording announced a need, the
    // need was invented.
    if (sameThing && !RELATION_SIGNAL_RE.test(raw.replace(/\bi\s+(?:sell|offer|provide|do)\b[^.;\n]*/gi, ""))) {
      violations.push({
        code: "USER_OFFER_AS_PROSPECT_NEED",
        severity: "error",
        message: `"${selling}" is what the USER sells — it is not evidence that any prospect needs it`,
        path: "relation.type",
      });
    }
  }

  return { frame, violations, repairs };
}

export function hasBlockingViolation(violations: Violation[]): boolean {
  return violations.some((v) => v.severity === "error");
}
