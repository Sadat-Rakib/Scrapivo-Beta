/**
 * Understanding Engine — monotonic clarification.
 *
 * The rule this module exists to enforce: an answer is never lost and a
 * resolved question is never asked again. The old clarifier re-ran extraction
 * over the original query on every turn, so an answer that the regex layer
 * disagreed with was silently overwritten and the same question came back —
 * which is what made the product feel like it was not listening.
 *
 * Here, an answer PATCHES the frame and is recorded in `answered`. Unresolved
 * fields are computed as (blocking fields of the frame) MINUS (answered), so
 * once a field is answered it cannot re-enter the unresolved set regardless of
 * what any later extraction thinks. The original query is never re-parsed.
 *
 * Pure module: no LLM, no I/O, no DB.
 */

import { resolveCanonicalLocation } from "@/lib/search/location-resolver";
import type { UnderstandingFrame } from "./frame";
import { openValue } from "./frame";
import { purposeFromFrame, repairExplicitPurpose } from "./purpose";
import { classifyHead, narrowsTarget, RELATION_SIGNAL_RE } from "./lexicon";
import {
  canonicalize,
  isDirection,
  isEntityType,
  isRelationType,
  OBJECT_ALIASES,
  RELATIONS_REQUIRING_OBJECT,
  type ClarificationReason,
} from "./vocab";

/**
 * The only fields that may ever block. Everything else is optional by design:
 * asking about seniority, quantity or output format is noise, not clarity.
 *
 * `target.scope` is the one addition that is not a parse failure — "find
 * businesses" is understood perfectly and still not executable, because it
 * names no place and no kind. It asks for the highest-information missing
 * thing rather than reporting a relation we never needed.
 */
export const BLOCKING_FIELDS = [
  "target.entity_type",
  "target.scope",
  "user_context.objective",
  "relation.type",
  "relation.object",
  "relation.direction",
  "compound.split",
] as const;
export type BlockingField = (typeof BLOCKING_FIELDS)[number];

/** A blocker plus WHY, so a reviewer can tell a real ambiguity from the layer
 *  failing to read plain English. */
export type Blocker = { field: BlockingField; reason: ClarificationReason };

export type ClarificationState = {
  version: "u1";
  frame: UnderstandingFrame;
  /** field id -> the user's own answer text. Append-only. */
  answered: Record<string, string>;
  /** Every field ever asked, in order. Append-only; used to avoid repeats even
   *  for a field an answer failed to resolve. */
  asked: string[];
  turns: number;
};

export type Question = {
  field: BlockingField;
  question: string;
  /** Suggested answers. Free text is always accepted too. */
  options: string[];
};

export function initState(frame: UnderstandingFrame): ClarificationState {
  return { version: "u1", frame, answered: {}, asked: [], turns: 0 };
}

// ── What is actually missing ──────────────────────────────────────────────

/**
 * A field blocks only when the frame cannot express it AND the user has not
 * already told us. Note the second clause: this is the whole monotonicity
 * guarantee, and it is a set difference rather than a re-derivation on purpose.
 *
 * The rule that keeps this quiet: `relation = none` NEVER blocks. "restaurants
 * in Lisbon" requested no relationship, and asking what should be true of the
 * restaurants is the layer admitting it cannot tell a complete request from an
 * incomplete one. Only `unknown` — wording that announced a relationship we
 * failed to read — is a blocker.
 */
export function blockers(state: ClarificationState): Blocker[] {
  const { frame, answered } = state;
  const out: Blocker[] = [];
  const unanswered = (f: BlockingField) => !answered[f];

  // An unfamiliar head noun is not an ambiguity. The phrase is preserved as a
  // category either way, so we ask only when NOTHING names the target — no
  // entity type, no role, no category, no industry, no business type.
  const namesTarget = Boolean(
    frame.target.role?.value ||
      frame.target.category?.value ||
      frame.target.industry?.value ||
      frame.target.business_type?.value ||
      frame.target.entity_subtype?.value ||
      frame.target.job_title?.value ||
      frame.target.niche?.value,
  );
  const typeKnown = frame.target.entity_type.value !== "unknown";

  if (!typeKnown && !namesTarget && unanswered("target.entity_type")) {
    out.push({ field: "target.entity_type", reason: "missing_target" });
  } else if (!typeKnown && frame.target.entity_type.confidence < 0.4 && unanswered("target.entity_type")) {
    // Recognized as a thing, genuinely undecided which kind — "veterinary
    // orthopaedic specialists" is a person or a practice and guessing is worse
    // than one question.
    out.push({ field: "target.entity_type", reason: "ambiguous_entity" });
  }

  if (frame.relation.type.value === "unknown" && unanswered("relation.type")) {
    // Only ask when the text actually announced a relationship. Otherwise the
    // honest reading is "none", and a question here is pure noise.
    if (RELATION_SIGNAL_RE.test(frame.input.raw)) {
      out.push({ field: "relation.type", reason: "unreadable_relation" });
    }
  }

  // Direction and object only matter once there IS a relation. Asking which way
  // `none` points, or what it acts on, is a question with no meaning.
  const rel = frame.relation.type.value;
  const hasRelation = rel !== "unknown" && rel !== "none";

  if (hasRelation && !frame.relation.object && RELATION_NEEDS_OBJECT.has(rel) && unanswered("relation.object")) {
    out.push({ field: "relation.object", reason: "missing_relation_object" });
  }
  if (hasRelation && frame.relation.direction.value === "unknown" && unanswered("relation.direction")) {
    out.push({ field: "relation.direction", reason: "ambiguous_direction" });
  }

  // A compound request that SPLIT cleanly is understood — both halves are in
  // the frame, and the caller runs each. Asking which to do first would be
  // asking about execution, not about meaning. Only a split we could not make
  // blocks, because that is the case where half a request would be discarded.
  if (frame.compound.is_compound && frame.compound.subgoals.length < 2 && unanswered("compound.split")) {
    out.push({ field: "compound.split", reason: "compound_parse_uncertain" });
  }

  if (out.length === 0 && hasScope(frame) &&
      ["person", "company", "business", "investor"].includes(frame.target.entity_type.value) &&
      !purposeFromFrame(frame) && !frame.user_context.objective?.value &&
      unanswered("user_context.objective")) {
    out.push({ field: "user_context.objective", reason: "missing_purpose" });
  }

  // Last, and only when nothing above blocks: understood but unrunnable.
  // "find businesses" — a real request, missing the one thing that would make
  // it a search. Deliberately last so it never pre-empts a real ambiguity.
  if (out.length === 0 && unanswered("target.scope") && !hasScope(frame)) {
    out.push({ field: "target.scope", reason: "underspecified_scope" });
  }

  return out;
}

/**
 * A frame is runnable when it narrows WHAT beyond a bare entity type, or
 * carries a relation, constraint or subgoal that selects a subset.
 *
 * A place is deliberately NOT enough on its own. "people in london" and
 * "businesses in Alberta" name a city and a province and still describe every
 * inhabitant of them: WHERE bounds a search that already knows what it is
 * looking for, and cannot supply the WHAT. Counting the location as scope is
 * what made this frame runnable while the extractor itself had already marked
 * it `underspecified_scope`, so the one honest question in the request was
 * asked and then withdrawn.
 */
function hasScope(frame: UnderstandingFrame): boolean {
  if (frame.constraints.length > 0) return true;
  if (frame.compound.subgoals.length > 0) return true;
  const rel = frame.relation.type.value;
  if (rel !== "none" && rel !== "unknown") return true;
  const t = frame.target;
  return Boolean(
    narrows(t.role) ||
      namesAKind(frame) ||
      narrows(t.business_type) ||
      narrows(t.job_title) ||
      t.company_stage?.value ||
      t.technologies.length > 0,
  );
}

/**
 * A field of activity narrows the search only once something says what kind of
 * thing to find in it.
 *
 * "proptech", "pharmacovigilance", "subtitling" name a market or a trade, not a
 * population: each could mean the companies, the investors behind them, their
 * founders or their job ads, and one word on its own says which nowhere.
 * Counting the word as scope had the LLM answer all three globally at ~0.9
 * confidence with no question asked — a silent guess, and the same shape as
 * "find businesses", which this function has always held back. Which SLOT the
 * word landed in cannot be the test: the model filed proptech as an industry
 * and pharmacovigilance as a category, and they are the same request.
 *
 * Three things make such a word answerable, and any one is enough:
 *
 *   · a head noun beside it. `entity_type.raw` records the words the type was
 *     read FROM, so "proptech companies" puts one there while bare "proptech"
 *     leaves it empty or holding the vertical itself. Equality is not a strong
 *     enough test of "itself": the deterministic engine read "port logistics"
 *     as a business by the suffix of its own last word and recorded the span as
 *     "logistic", which is not a second word beside the vertical — it is one of
 *     the vertical's own, stemmed. The span counts only when it brings a word
 *     the vertical does not already contain.
 *   · the word ITSELF naming a kind of thing — "cafes", "law firms", "roofing
 *     contractors" all resolve in the head-noun table, and nobody typing one
 *     is asking about a market.
 *   · a place. An unfamiliar trade plus a city is a complete request: "saunas
 *     in Tampere" is answerable and "waste haulage" is not, and the difference
 *     is the only thing in the frame that bounds it. (A place is not enough
 *     when the WHAT is generic — "businesses in Alberta" — but that case never
 *     reaches here, because a generic descriptor does not narrow.)
 *
 * `guess: false` is deliberate: the shape-based backstops would read an
 * unfamiliar vertical as a business by suffix and answer the question this
 * function exists to ask.
 */
function namesAKind(frame: UnderstandingFrame): boolean {
  const t = frame.target;
  const vertical = [t.category, t.industry, t.niche]
    .find((v) => narrows(v))
    ?.value?.trim()
    .toLowerCase();
  if (!vertical) return false;

  if (addsAWord(t.entity_type.raw, vertical)) return true;
  if (classifyHead(vertical, { guess: false }).kind !== "unknown") return true;
  return Boolean(frame.location?.value);
}

/** Does `said` name anything the vertical does not already say? Stems crudely,
 *  because the two spans are the same words in different numbers far more often
 *  than they are genuinely different words. */
function addsAWord(said: string | null | undefined, vertical: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((w) => w.replace(/(?:ies|es|s)$/, "")),
    );
  const mine = words(said ?? "");
  if (mine.size === 0) return false;
  const theirs = words(vertical);
  return [...mine].some((w) => !theirs.has(w));
}

function narrows(v: { value: string } | null | undefined): boolean {
  return narrowsTarget(v?.value);
}

/**
 * Read from `vocab`, never restated. A local copy of this set drifted to
 * include `hiring`, so "cto types in the bay who r hiring" — a complete request
 * for employers with any open role — was held back for a question about which
 * role. The validator raises its error from the same list, so a second copy
 * means the question and the error can disagree about the same frame.
 */
const RELATION_NEEDS_OBJECT = new Set<string>(RELATIONS_REQUIRING_OBJECT);

/** Field ids only — kept for callers that do not care why. */
export function unresolvedFields(state: ClarificationState): BlockingField[] {
  return blockers(state).map((b) => b.field);
}

export function isSettled(state: ClarificationState): boolean {
  return blockers(state).length === 0;
}

// ── One question at a time ────────────────────────────────────────────────

/**
 * The next question, or null when nothing genuinely blocks. One question per
 * turn: a form of four dropdowns is how a search becomes homework.
 */
export function nextQuestion(state: ClarificationState): Question | null {
  const list = blockers(state);
  if (list.length === 0) return null;

  // Fixed priority: what we are looking for, then what is true of them, then
  // which way round, then which half of a compound request.
  const { field } = list[0]!;

  switch (field) {
    case "target.entity_type":
      return {
        field,
        question: "Are you looking for people or for companies/businesses?",
        options: ["People", "Companies", "Local businesses", "Job postings"],
      };
    case "target.scope": {
      // The one question worth asking about a request we understood: it offers
      // both axes at once, because either answer makes the search runnable.
      const what = describeTarget(state.frame);
      return {
        field,
        question: `Where should I look for ${what}, or what kind of ${what} do you want?`,
        options: [],
      };
    }
    case "user_context.objective":
      return {
        field,
        question: "What are you trying to do with these results?",
        options: ["Research", "Find prospects", "Recruit", "Find partners"],
      };
    case "relation.object": {
      const rel = state.frame.relation.type.value;
      const verb =
        rel === "hiring"
          ? "hiring for"
          : rel === "needs_service" || rel === "asking_for_help"
            ? "looking for help with"
            : rel === "uses_technology"
              ? "using"
              : rel === "lacks_asset"
                ? "missing"
                : "doing";
      return {
        field,
        question: `What should they be ${verb}?`,
        options: [],
      };
    }
    case "relation.type": {
      const what = describeTarget(state.frame);
      return {
        field,
        question: `What should be true of the ${what} you want?`,
        options: [
          "They are hiring",
          "They need a service",
          "They offer a service",
          "They are looking for work",
          "Something else",
        ],
      };
    }
    case "relation.direction": {
      const obj = state.frame.relation.object?.value ?? "that";
      return {
        field,
        question: `Which way round: do they provide ${obj}, or do they need ${obj}?`,
        options: [`They provide ${obj}`, `They need ${obj}`],
      };
    }
    case "compound.split": {
      const subs = state.frame.compound.subgoals;
      const labels = subs.map((s) => truncate(subgoalLabel(s), 60));
      return {
        field,
        // Said plainly, because the alternative — quietly running half of it —
        // is the failure this field exists to prevent.
        question:
          labels.length >= 2
            ? "That reads as two separate searches. Which one should I run first?"
            : "That reads as more than one search. Which part should I run first?",
        options: labels.length ? [...labels, "Both, separately"] : ["First part", "Second part"],
      };
    }
    default:
      return null;
  }
}

// ── Applying an answer ────────────────────────────────────────────────────

export type PatchResult = {
  state: ClarificationState;
  /** False when the answer was recorded but could not be mapped onto the frame;
   *  the field is still marked answered so it is not asked a second time. */
  applied: boolean;
  note: string;
};

/**
 * Patch the frame with one answer.
 *
 * What this function deliberately does NOT do: look at `frame.input.raw`. It
 * edits the field the question was about and nothing else, so an answer cannot
 * be argued with by a re-read of the original sentence.
 */
export function patchFrame(
  state: ClarificationState,
  field: BlockingField,
  answerRaw: string,
): PatchResult {
  const answer = (answerRaw ?? "").trim();
  const frame = structuredClone(state.frame);
  const answered = { ...state.answered };
  const asked = state.asked.includes(field) ? state.asked : [...state.asked, field];

  // Recorded before we know whether it maps cleanly. An unmappable answer is
  // still an answer, and re-asking it would be the exact bug this prevents.
  answered[field] = answer;

  let applied = false;
  let note = "";

  if (!answer) {
    note = "empty answer — field marked answered so it is not repeated";
  } else {
    switch (field) {
      case "user_context.objective": {
        frame.user_context.objective = openValue(answer, answer, null, 1);
        applied = true;
        note = `purpose recorded from the user's answer`;
        break;
      }
      case "target.entity_type": {
        const t = interpretEntityType(answer);
        if (t) {
          frame.target.entity_type = { value: t, raw: answer, confidence: 0.95 };
          if ((t === "organization" || t === "other") && !frame.target.entity_subtype) {
            frame.target.entity_subtype = openValue(answer, answer, null, 0.7);
          }
          applied = true;
          note = `entity_type set to ${t} from the user's answer`;
        } else {
          // Understood as a thing, just not one of our members.
          frame.target.entity_type = { value: "other", raw: answer, confidence: 0.6 };
          frame.target.entity_subtype = openValue(answer, answer, null, 0.7);
          applied = true;
          note = `entity_type kept as other with subtype "${answer}" rather than forced into a member`;
        }
        break;
      }

      case "relation.type": {
        const r = interpretRelation(answer);
        if (r.type) {
          frame.relation.type = { value: r.type, raw: answer, confidence: 0.9 };
          frame.relation.label = r.type === "custom" ? r.label : null;
          if (r.direction) {
            frame.relation.direction = { value: r.direction, raw: answer, confidence: 0.9 };
          }
          if (r.object && !frame.relation.object) {
            frame.relation.object = openValue(
              r.object,
              answer,
              canonicalize(r.object, OBJECT_ALIASES),
              0.7,
            );
          }
          applied = true;
          note = `relation set to ${r.type}${r.label ? ` (${r.label})` : ""}`;
        } else {
          frame.relation.type = { value: "custom", raw: answer, confidence: 0.6 };
          frame.relation.label = answer.slice(0, 200);
          frame.relation.direction = {
            value: "subject_to_object",
            raw: answer,
            confidence: 0.6,
          };
          applied = true;
          note = `relation recorded as custom "${answer}" — understood, just not a standard member`;
        }
        break;
      }

      case "target.scope": {
        // Either axis is acceptable and we do not know in advance which the
        // user will give. A place answer is only read as a place when the
        // resolver recognizes it — otherwise it narrows WHAT, not WHERE, and
        // guessing would put "coffee roasters" in the location field.
        const place = looksLikePlace(answer);
        if (place) {
          frame.location = {
            value: place,
            raw: answer,
            scope: "in",
            radius: null,
            radius_unit: null,
            country_code: null,
            canonical: null,
            confidence: 0.9,
          };
          applied = true;
          note = `location set to ${place} from the user's answer`;
        } else {
          frame.target.descriptors = [
            ...frame.target.descriptors,
            openValue(answer, answer, null, 0.8),
          ].slice(0, 20);
          if (!frame.target.category) {
            frame.target.category = openValue(answer, answer, null, 0.8);
          }
          applied = true;
          note = `narrowed the target with "${answer}" (read as a kind, not a place)`;
        }
        break;
      }

      case "relation.object": {
        frame.relation.object = openValue(
          answer,
          answer,
          canonicalize(answer, OBJECT_ALIASES),
          0.9,
        );
        applied = true;
        note = `relation object set to "${answer}"`;
        break;
      }

      case "relation.direction": {
        const d = interpretDirection(answer, frame);
        if (d) {
          frame.relation.direction = { value: d, raw: answer, confidence: 0.9 };
          applied = true;
          note = `direction set to ${d}`;
        } else {
          note = "direction answer was not decisive — left unknown rather than guessed";
        }
        break;
      }

      case "compound.split": {
        const pick = interpretSplit(answer, frame);
        if (pick === "both") {
          // Both halves stay, and the request stays marked compound: the caller
          // is expected to run each subgoal. Nothing is discarded.
          applied = true;
          note = "user asked for both — subgoals kept, caller runs each";
        } else if (pick !== null) {
          const chosen = frame.compound.subgoals[pick];
          if (chosen) {
            frame.target = chosen.target;
            frame.relation = chosen.relation;
            frame.location = chosen.location;
            frame.temporal = chosen.temporal;
            frame.constraints = chosen.constraints;
            frame.compound = { is_compound: false, subgoals: [] };
            applied = true;
            note = `narrowed to subgoal ${pick + 1}: ${truncate(subgoalLabel(chosen), 80)}`;
          }
        } else {
          note = "could not tell which half was chosen — both subgoals kept";
        }
        break;
      }
    }
  }

  const next: ClarificationState = {
    ...state,
    frame,
    answered,
    asked,
    turns: state.turns + 1,
  };

  // Recompute the clarification block from the new state, so the frame's own
  // view of what is missing never disagrees with the state machine's.
  next.frame.clarification = clarificationBlock(next);
  next.frame.meta = {
    ...next.frame.meta,
    notes: [...next.frame.meta.notes, `clarify(${field}): ${note}`].slice(-20),
  };

  return { state: next, applied, note };
}

/** The clarification block for a state — one place, so the frame's own account
 *  of what is missing can never disagree with `blockers()`. */
function clarificationBlock(state: ClarificationState): UnderstandingFrame["clarification"] {
  const list = blockers(state);
  if (list.length === 0) {
    return { needed: false, fields: [], reason: null, question: null };
  }
  return {
    needed: true,
    fields: list.map((b) => b.field),
    reason: list[0]!.reason,
    question: nextQuestion(state)?.question ?? null,
  };
}

/** Refresh the clarification block without answering anything — used right
 *  after extraction so the frame reports the same thing the state machine does. */
export function syncClarification(frame: UnderstandingFrame): UnderstandingFrame {
  const out = repairExplicitPurpose(structuredClone(frame));
  out.clarification = clarificationBlock(initState(out));
  return out;
}

// ── Answer interpretation (deterministic, small on purpose) ───────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s/+-]/g, " ").replace(/\s+/g, " ").trim();
}

function interpretEntityType(answer: string): UnderstandingFrame["target"]["entity_type"]["value"] | null {
  const a = norm(answer);
  if (isEntityType(a)) return a;
  if (/\b(people|person|individuals?|humans?|founders?|engineers?|candidates?)\b/.test(a))
    return "person";
  if (/\b(job|jobs|postings?|vacanc(y|ies)|roles? open)\b/.test(a)) return "job";
  if (/\b(local business|local businesses|shops?|stores?|restaurants?|clinics?)\b/.test(a))
    return "business";
  if (/\b(compan(y|ies)|startups?|firms?|employers?|orgs)\b/.test(a)) return "company";
  if (/\b(investors?|vcs?|funds?|angels?)\b/.test(a)) return "investor";
  if (/\b(nonprofits?|charit(y|ies)|schools?|universit(y|ies)|councils?|municipalit(y|ies))\b/.test(a))
    return "organization";
  return null;
}

type RelationHint = {
  type: UnderstandingFrame["relation"]["type"]["value"] | null;
  label: string | null;
  direction: UnderstandingFrame["relation"]["direction"]["value"] | null;
  object: string | null;
};

function interpretRelation(answer: string): RelationHint {
  const a = norm(answer);
  if (isRelationType(a) && a !== "custom") {
    return { type: a, label: null, direction: "subject_to_object", object: null };
  }
  if (/\b(hiring|recruit|looking to hire|want to hire|need staff)\b/.test(a))
    return { type: "hiring", label: null, direction: "subject_to_object", object: null };
  if (/\b(looking for work|seeking (a )?job|job seek|want a job|unemployed|open to work)\b/.test(a))
    return { type: "seeking_job", label: null, direction: "subject_to_object", object: "employment" };
  if (/\b(need|needs|needing|require|want|looking for) (a |an )?(service|help|support)?/.test(a) && /\bneed|require|want\b/.test(a))
    return { type: "needs_service", label: null, direction: "subject_to_object", object: null };
  if (/\b(offer|offers|provide|provides|sell|sells|they provide)\b/.test(a))
    return { type: "offers_service", label: null, direction: "subject_to_object", object: null };
  if (/\b(us(e|es|ing)|built on|running on|powered by)\b/.test(a))
    return { type: "uses_technology", label: null, direction: "subject_to_object", object: null };
  if (/\b(missing|lacks?|lacking|has no|no website|without)\b/.test(a))
    return { type: "lacks_asset", label: null, direction: "subject_to_object", object: null };
  if (/\b(partner|partnered|integrat(e|ed|ion))\b/.test(a))
    return { type: "partnered_with", label: null, direction: "subject_to_object", object: null };
  if (/\b(attend|attending|going to|exhibiting)\b/.test(a))
    return { type: "attending_event", label: null, direction: "subject_to_object", object: null };
  if (/\b(raised|funding|funded|series [a-d]|seed round)\b/.test(a))
    return { type: "received_funding", label: null, direction: "object_to_subject", object: null };
  if (/\b(something else|other|none of these)\b/.test(a))
    return { type: null, label: null, direction: null, object: null };
  return { type: null, label: null, direction: null, object: null };
}

function interpretDirection(
  answer: string,
  frame: UnderstandingFrame,
): UnderstandingFrame["relation"]["direction"]["value"] | null {
  const a = norm(answer);
  if (isDirection(a)) return a;
  const obj = frame.relation.object?.value ? norm(frame.relation.object.value) : null;

  const provides = /\b(provide|provides|offer|offers|sell|sells|supply|supplies|do|does)\b/.test(a);
  const needs = /\b(need|needs|want|wants|require|requires|looking for|searching for)\b/.test(a);
  if (provides && !needs) return "subject_to_object";
  if (needs && !provides) return "object_to_subject";
  if (obj && a === `they provide ${obj}`) return "subject_to_object";
  if (obj && a === `they need ${obj}`) return "object_to_subject";
  if (/\b(both|either|mutual)\b/.test(a)) return "mutual";
  return null;
}

/** Returns an index into subgoals, "both", or null when undecidable. */
function interpretSplit(answer: string, frame: UnderstandingFrame): number | "both" | null {
  const a = norm(answer);
  if (/\b(both|all|each|separately)\b/.test(a)) return "both";
  if (/\b(first|1st|one|former)\b/.test(a)) return 0;
  if (/\b(second|2nd|two|latter)\b/.test(a)) return 1;
  if (/\b(third|3rd|three)\b/.test(a)) return 2;

  const n = Number.parseInt(a, 10);
  if (Number.isFinite(n) && n >= 1 && n <= frame.compound.subgoals.length) return n - 1;

  // The answer may be one of the offered labels, echoed back.
  const idx = frame.compound.subgoals.findIndex((s) => {
    const label = norm(truncate(subgoalLabel(s), 60));
    return label.length > 6 && (a.includes(label) || label.includes(a));
  });
  return idx >= 0 ? idx : null;
}

/**
 * Is this answer a PLACE? Only the gazetteer may say yes. The alternative —
 * "it has no space in it, so it is probably a city" — puts "roasters" in the
 * location field, and a wrong location is a wrong search with no symptom.
 */
function looksLikePlace(answer: string): string | null {
  const stripped = answer
    .trim()
    .replace(/^(?:in|near|around|within|across|throughout|at)\s+/i, "")
    .replace(/[.?!,;]+$/, "")
    .trim();
  if (!stripped || stripped.split(/\s+/).length > 4) return null;
  const hit = resolveCanonicalLocation(stripped);
  return hit?.name ? stripped : null;
}

// ── Small helpers ─────────────────────────────────────────────────────────

function describeTarget(frame: UnderstandingFrame): string {
  const t = frame.target;
  if (t.role?.value) return `${t.role.value}s`;
  if (t.category?.value) return t.category.value;
  if (t.entity_subtype?.value) return `${t.entity_subtype.value}s`;
  switch (t.entity_type.value) {
    case "person":
      return "people";
    case "company":
      return "companies";
    case "business":
      return "businesses";
    case "investor":
      return "investors";
    case "organization":
      return "organizations";
    case "job":
      return "job postings";
    default:
      return "results";
  }
}

/**
 * What to call one half of a compound request when asking which half to run.
 *
 * `raw` is the span the user actually typed and is always the better label —
 * but it is nullable, because an extractor can split a request correctly and
 * still not quote it. An absent span must not become an empty option: the
 * question would offer the user a blank to choose between. The composed
 * fallback describes the subgoal out of its own fields instead, so both
 * halves stay nameable and distinguishable.
 */
function subgoalLabel(s: UnderstandingFrame["compound"]["subgoals"][number]): string {
  const said = s.raw?.trim();
  if (said) return said;

  const head =
    s.target.role?.value ??
    s.target.category?.value ??
    s.target.job_title?.value ??
    s.target.business_type?.value ??
    s.target.entity_type.value;
  const rel = s.relation.type.value;
  const obj = s.relation.object?.value;
  const verb = rel === "none" || rel === "unknown" ? "" : ` ${rel.replace(/_/g, " ")}`;
  const where = s.location?.value ? ` in ${s.location.value}` : "";
  return `${head}${verb && obj ? `${verb} ${obj}` : verb}${where}`;
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}
