/**
 * Gate 1 grader.
 *
 * Runs the Understanding Engine over TRAIN, a freshly-drawn HOLDOUT and a
 * freshly-drawn CHAOS set, and writes a markdown report containing the FULL
 * frame for every case.
 *
 * Read the last paragraph of this comment before trusting any number it
 * prints. "892/892 PASS" does not mean understanding works. It means the
 * implementation did not violate its own automated expectations. The
 * expectations are deliberately partial — they assert entity type, relation,
 * direction, location and evidence, and nothing else — so a frame can satisfy
 * every one of them and still be a bad reading of the sentence. Gate 1 closes
 * when a human has read the HOLDOUT and CHAOS frames in this report, not when
 * this script is green.
 *
 * Usage:
 *   npm run verify:understanding
 *   npm run verify:understanding -- --seed 4242 --holdout 120 --chaos 120
 *   npm run verify:understanding -- --report-dir "$TEMP/scrapivo-gate1"
 *   npm run verify:understanding -- --set train
 *   npm run verify:understanding -- --deterministic     (no LLM; fallback only)
 */

import "./_env.mts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  TRAIN,
  generateChaos,
  generateHoldout,
  sizeOf,
  smokeCases,
  type Case,
  type Expect,
  type SizeGroup,
} from "../src/lib/understanding/corpus";
import { extractFrameLLM } from "../src/lib/understanding/extract.server";
import { extractFrameDeterministic } from "../src/lib/understanding/fallback";
import { syncClarification } from "../src/lib/understanding/clarify-state";
import { validateFrame, type Repair, type Violation } from "../src/lib/understanding/validate";
import type { UnderstandingFrame } from "../src/lib/understanding/frame";
import { mustAbortRequiredLlmRun, sameLocation } from "./verify-understanding-runner";
import { ensureCityGazetteer } from "../src/lib/search/gazetteer.server";
import { cityGazetteerRegistered } from "../src/lib/search/location-resolver";

// ── Arguments ─────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const SEED = Number.parseInt(arg("seed", String(Date.now() % 100000)), 10);
const HOLDOUT_N = Number.parseInt(arg("holdout", "80"), 10);
const CHAOS_N = Number.parseInt(arg("chaos", "80"), 10);
const ONLY = flag("smoke") ? "smoke" : arg("set", "all");
const REPORT_DIR = arg("report-dir", "");
const DETERMINISTIC = flag("deterministic");
/** Pin certification to one gateway/model. Empty string means "the ladder". */
const PROVIDER = arg("provider", "");
const MODEL = arg("model", "");
const PIN =
  PROVIDER || MODEL
    ? { gateway: PROVIDER || undefined, model: MODEL || undefined }
    : undefined;
/**
 * The invariant this whole flag exists for: a run that fell back to keyword
 * extraction has not tested the model, and must not be able to report a pass.
 *
 * Without it the failure mode is silent and convincing — every provider is out
 * of quota, the deterministic extractor answers all 24 cases, every check goes
 * green, and the report reads like an LLM certification. `--require-llm` makes
 * the run state `LLM VALIDATION INVALID` and exit non-zero instead.
 */
const REQUIRE_LLM = flag("require-llm");
/** Already the default for grading; accepted so the intent can be written out. */
const NO_CACHE = flag("no-cache") || true;
/**
 * One at a time by default, and paced.
 *
 * The free tiers this runs against are rate-limited per MINUTE, not per
 * request: Groq allows 8,000 tokens/min and a query costs roughly 2,500 of
 * them. Four parallel workers therefore spend the whole minute's budget in the
 * first two seconds, every subsequent call 429s, and after three refusals the
 * router's circuit breaker parks the provider for five minutes — at which
 * point every case silently falls back to the deterministic extractor and the
 * report grades the wrong thing while looking fine. Pacing is not politeness
 * here; it is the difference between measuring the LLM and not measuring it.
 */
const CONCURRENCY = Number.parseInt(arg("concurrency", "1"), 10);
/** Milliseconds between the START of one LLM call and the next. */
const PACE_MS = Number.parseInt(arg("pace", DETERMINISTIC ? "0" : "8000"), 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Grading ───────────────────────────────────────────────────────────────

type Check = { name: string; ok: boolean; detail: string };

type Graded = {
  case: Case;
  frame: UnderstandingFrame;
  violations: Violation[];
  repairs: Repair[];
  checks: Check[];
  pass: boolean;
  error: string | null;
  /** Gateway-reported spend. Null on the fallback path and on `--deterministic`. */
  usage: { prompt: number | null; completion: number | null } | null;
};

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const words = (s: string | null | undefined) => lc(s).split(/\s+/).filter(Boolean);

function oneOf<T extends string>(want: T | T[] | undefined, got: string): boolean | null {
  if (want === undefined) return null;
  return Array.isArray(want) ? (want as string[]).includes(got) : want === got;
}

/** Every phrase in the target block, which is where a target may legitimately
 *  land: "dental practices" may be a category on one reading and a role on
 *  another, and the corpus should not have to guess which. */
function targetPhrase(f: UnderstandingFrame): string {
  return [
    f.target.role?.value,
    f.target.role?.normalized,
    f.target.job_title?.value,
    f.target.category?.value,
    f.target.category?.normalized,
    f.target.business_type?.value,
    f.target.industry?.value,
    f.target.niche?.value,
    f.target.entity_subtype?.value,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

/**
 * Number is not meaning. The corpus writes "head of talent" and a request says
 * "heads of talent"; grading those as different answers measures the grader's
 * own spelling preference, not whether the request was understood. Folded on
 * BOTH sides with the grader's own rule — deliberately not the extractor's, so
 * a bug there cannot make a frame agree with itself.
 */
function foldPlural(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      if (/(?:ss|us|is|ous)$/.test(w)) return w;
      if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
      if (/(?:ches|shes|xes|zes)$/.test(w)) return w.slice(0, -2);
      return w.replace(/s$/, "");
    })
    .join(" ");
}

/**
 * The grader keeps its OWN vocabulary of relation and temporal cues rather than
 * importing the extractor's. A contamination check built from the extractor's
 * own lists can only catch what those lists already know about, which is the
 * opposite of an independent check: the words the extractor forgot are exactly
 * the words that end up inside a location.
 */
const RELATION_CUES =
  /\b(looking|seeking|need|needs|needing|want|wants|hiring|hire|recruit|recruiting|offer|offers|offering|provide|provides|providing|serve|serves|serving|using|uses|raised|raising|funded|funding|without|with no|lacks|lacking|partnered|attending|tryna|trying to|posted|asking)\b/i;

const TEMPORAL_CUES =
  /\b(today|yesterday|now|rn|recent|recently|currently|this (?:week|month|year|yr|quarter)|last (?:week|month|year|yr|quarter|\d+)|past (?:week|month|year|\d+)|\d+\s*(?:days?|weeks?|months?|years?)|20\d\d|q[1-4])\b/i;

const QUANTITY_CUES =
  /\b(\d{1,5}\s*\+|at least\s+\d|minimum\s+\d|min\.?\s+\d|up to\s+\d|no more than\s+\d|around\s+\d|about\s+\d|~\s*\d|\d{1,5}\s+(?!\s)(?:[a-z-]+s\b)|as many as (?:possible|you|u)|top\s+\d)/i;

/**
 * A time WINDOW filters the prospects; an urgency adverb describes the request.
 * "posted in the last 2 weeks" narrows who comes back, so losing it loses
 * meaning — but "phone would b great, thx, asap" and "verified as currently
 * open" say nothing about when anything happened, and demanding a temporal for
 * those measures politeness. Only the window forms are required to survive.
 */
const TEMPORAL_WINDOW_CUES =
  /\b(today|yesterday|this (?:week|month|year|yr|quarter)|last (?:week|month|year|yr|quarter|\d+)|past (?:week|month|year|\d+)|\d+\s*(?:days?|weeks?|months?|years?)|since\s+20\d\d|20\d\d|q[1-4])\b/i;

/**
 * CHAOS corrupts the PROMPT on purpose while the expectation keeps naming the
 * concept, so an extractor that faithfully reports the span the user typed —
 * `grant writinng`, `preeira` — is doing exactly what §6 asks of it and must
 * not be scored as wrong. Comparison for open strings is therefore approximate:
 * every word of the expectation has to find a word in the frame that is within
 * a length-scaled edit distance of it.
 *
 * Deliberately NOT used for the closed enums. A relation is either `hiring` or
 * it is not, and "near enough" on a structural field is how a grader stops
 * grading.
 *
 * Transpositions count as ONE edit (Damerau), because swapped adjacent letters
 * are what typing actually produces: `kumsai` for Kumasi, `haualge` for
 * haulage. Plain Levenshtein scores each of those 2 and spends a whole word's
 * budget on a single slip of the fingers, so the grader was failing frames that
 * had captured the right span verbatim — the behaviour §6 asks for.
 */
function editDistance(a: string, b: string): number {
  let twoBack = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let row = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j]!, twoBack[j - 2]! + 1);
      }
    }
    [twoBack, prev, row] = [prev, row, twoBack];
  }
  return prev[b.length]!;
}

/** One transposition or dropped letter per four characters, and no more: at a
 *  flatter rate "seo" would match "ceo". */
function nearWord(want: string, got: string): boolean {
  if (want === got) return true;
  const budget = want.length <= 4 ? 1 : Math.floor(want.length / 4);
  return Math.abs(want.length - got.length) <= budget && editDistance(want, got) <= budget;
}

function nearlyHas(hay: string, needle: string): boolean {
  if (hay.includes(needle.toLowerCase())) return true;
  if (foldPlural(hay).includes(foldPlural(needle))) return true;
  // Both the written and the plural-folded forms, because the fold is
  // ASYMMETRIC on a typo: it refuses an `-us` ending (campus, analysis is not
  // a plural) and strips a bare `-s`, so "aarhus" stayed six letters while the
  // typo "aarhs" became four — two apart, over the one-edit budget, for a word
  // that is one dropped keystroke from what was wanted. Comparing as written
  // costs nothing and catches exactly that case.
  const gotRaw = words(hay.toLowerCase());
  const gotFolded = words(foldPlural(hay));
  return words(needle.toLowerCase()).every(
    (w) =>
      gotRaw.some((g) => nearWord(w, g)) || gotFolded.some((g) => nearWord(foldPlural(w), g)),
  );
}

function grade(c: Case, frame: UnderstandingFrame, violations: Violation[]): Check[] {
  const e: Expect = c.expect;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean | null, detail: string) => {
    if (ok !== null) checks.push({ name, ok, detail });
  };
  const has = (hay: string, needle: string) => nearlyHas(hay, needle);

  // ── Expectation axes (§20). Only the ones the case names are graded. ────
  add("TASK_TYPE", oneOf(e.task_type, frame.task_type.value), `want ${fmt(e.task_type)} · got ${frame.task_type.value}`);
  add(
    "PROSPECTING_MODE",
    oneOf(e.prospecting_mode, frame.prospecting_mode.value),
    `want ${fmt(e.prospecting_mode)} · got ${frame.prospecting_mode.value}`,
  );
  // A noun that is legitimately both a practitioner and a practice —
  // "orthodontists", "luthiers" — has two correct answers, and the frame says
  // so (`target.entity_ambiguous`). Scoring one of them as an error would be
  // grading the coin toss rather than the understanding; what must not happen
  // is the frame claiming an ambiguity it does not have, which is why this
  // only relaxes between the person/business/company readings and only when
  // the frame declared it.
  const entityGot = frame.target.entity_type.value;
  const declaredAmbiguous =
    frame.target.entity_ambiguous === true &&
    ["person", "business", "company"].includes(entityGot) &&
    (Array.isArray(e.entity_type) ? e.entity_type : [e.entity_type]).every(
      (v) => typeof v === "string" && ["person", "business", "company"].includes(v),
    );
  add(
    "ENTITY_TYPE",
    e.entity_type === undefined
      ? null
      : oneOf(e.entity_type, entityGot) || declaredAmbiguous,
    `want ${fmt(e.entity_type)} · got ${entityGot}${declaredAmbiguous ? " (declared ambiguous)" : ""}`,
  );
  add(
    "TARGET_PHRASE",
    e.target === undefined ? null : has(targetPhrase(frame), e.target),
    `want ~"${e.target}" · got "${targetPhrase(frame) || "—"}"`,
  );
  add(
    "ROLE",
    e.role === undefined ? null : has(targetPhrase(frame), e.role),
    `want ~"${e.role}" · got "${lc(frame.target.role?.value) || "—"}"`,
  );
  add(
    "CATEGORY",
    e.category === undefined ? null : has(targetPhrase(frame), e.category),
    `want ~"${e.category}" · got "${lc(frame.target.category?.value) || "—"}"`,
  );
  add(
    "INDUSTRY",
    e.industry === undefined ? null : has(targetPhrase(frame), e.industry),
    `want ~"${e.industry}" · got "${lc(frame.target.industry?.value) || "—"}"`,
  );
  add(
    "RELATION",
    oneOf(e.relation, frame.relation.type.value),
    `want ${fmt(e.relation)} · got ${frame.relation.type.value}`,
  );
  add(
    "OBJECT",
    e.object === undefined
      ? null
      : has(lc(frame.relation.object?.value), e.object) ||
          has(lc(frame.relation.object?.normalized), e.object),
    `want ~"${e.object}" · got ${frame.relation.object?.value ?? "null"}`,
  );
  add(
    "DIRECTION",
    e.direction === undefined ? null : frame.relation.direction.value === e.direction,
    `want ${e.direction} · got ${frame.relation.direction.value}`,
  );
  add(
    "LOCATION",
    e.location === undefined
      ? null
      : sameLocation(e.location, frame.location?.value, frame.location?.country_code) ||
          sameLocation(e.location, frame.location?.canonical, frame.location?.country_code),
    `want ~"${e.location}" · got ${frame.location?.value ?? "null"}`,
  );
  add(
    "NO_LOCATION",
    e.no_location === undefined ? null : frame.location === null,
    `want none · got ${frame.location?.value ?? "null"}`,
  );
  add(
    "LOCATION_SCOPE",
    e.location_scope === undefined ? null : frame.location?.scope === e.location_scope,
    `want ${e.location_scope} · got ${frame.location?.scope ?? "null"}`,
  );
  add(
    "TEMPORAL",
    e.temporal === undefined ? null : (frame.temporal !== null) === e.temporal,
    `want ${e.temporal ? "present" : "absent"} · got ${frame.temporal ? `${frame.temporal.relation} ${frame.temporal.window ?? frame.temporal.year ?? ""}`.trim() : "null"}`,
  );
  add(
    "QUANTITY",
    e.quantity === undefined ? null : frame.quantity?.requested === e.quantity,
    `want ${e.quantity} · got ${frame.quantity?.requested ?? "null"}`,
  );
  add(
    "QUANTITY_MIN",
    e.quantity_min === undefined ? null : frame.quantity?.minimum === e.quantity_min,
    `want >=${e.quantity_min} · got ${frame.quantity?.minimum ?? "null"}`,
  );
  add(
    "QUANTITY_MAX",
    e.quantity_max === undefined ? null : frame.quantity?.maximum === e.quantity_max,
    `want <=${e.quantity_max} · got ${frame.quantity?.maximum ?? "null"}`,
  );
  add(
    "QUANTITY_UNLIMITED",
    e.quantity_unlimited === undefined ? null : frame.quantity?.unlimited === true,
    `want unlimited · got ${JSON.stringify(frame.quantity)}`,
  );
  add(
    "CONSTRAINTS",
    e.min_constraints === undefined ? null : frame.constraints.length >= e.min_constraints,
    `want >=${e.min_constraints} · got ${frame.constraints.length} [${frame.constraints.map((x) => x.field).join(",")}]`,
  );
  add(
    "NEGATION",
    e.negated === undefined
      ? null
      : e.negated.every((f) => frame.constraints.some((k) => k.field === f && k.negated)),
    `want negated ${e.negated?.join(",")} · got ${frame.constraints.filter((k) => k.negated).map((k) => k.field).join(",") || "none"}`,
  );
  add(
    "USER_CONTEXT",
    e.user_selling === undefined
      ? null
      : has(lc(frame.user_context.selling?.service?.value), e.user_selling) ||
          has(lc(frame.user_context.selling?.product?.value), e.user_selling),
    `want ~"${e.user_selling}" · got ${frame.user_context.selling?.service?.value ?? frame.user_context.selling?.product?.value ?? "null"}`,
  );
  add(
    "REQUIRED_FIELDS",
    e.required_fields === undefined
      ? null
      : e.required_fields.every((f) => frame.required_fields.some((x) => x.value === f)),
    `want ${e.required_fields?.join(",")} · got ${frame.required_fields.map((x) => x.value).join(",") || "none"}`,
  );
  add(
    "PREFERRED_FIELDS",
    e.preferred_fields === undefined
      ? null
      : e.preferred_fields.every((f) => frame.preferred_fields.some((x) => x.value === f)),
    `want ${e.preferred_fields?.join(",")} · got ${frame.preferred_fields.map((x) => x.value).join(",") || "none"}`,
  );
  add(
    "VERIFICATION",
    e.min_verification === undefined ? null : frame.verification.length >= e.min_verification,
    `want >=${e.min_verification} · got ${frame.verification.length}`,
  );
  add(
    "OUTPUT",
    e.output === undefined
      ? null
      : e.output.every((k) => frame.output.some((o) => o.kind === k || o.label === k)),
    `want ${e.output?.join(",")} · got ${frame.output.map((o) => o.kind).join(",") || "none"}`,
  );
  add(
    "CLAIM_EVIDENCE",
    e.claim_evidence_required === undefined
      ? null
      : frame.evidence.claim_evidence_required === e.claim_evidence_required,
    `want ${e.claim_evidence_required} · got ${frame.evidence.claim_evidence_required}`,
  );
  add(
    "INTENT_SIGNAL",
    e.intent_signal_required === undefined
      ? null
      : frame.evidence.intent_signal_required === e.intent_signal_required,
    `want ${e.intent_signal_required} · got ${frame.evidence.intent_signal_required}`,
  );
  add(
    "COMPOUND",
    e.compound === undefined ? null : frame.compound.is_compound === e.compound,
    `want ${e.compound} · got ${frame.compound.is_compound} (${frame.compound.subgoals.length} subgoals)`,
  );
  add(
    "SUBGOALS",
    e.min_subgoals === undefined ? null : frame.compound.subgoals.length >= e.min_subgoals,
    `want >=${e.min_subgoals} · got ${frame.compound.subgoals.length}`,
  );
  add(
    "CLARIFICATION",
    e.clarification === undefined
      ? null
      : e.clarification === "required"
        ? frame.clarification.needed
        : !frame.clarification.needed,
    `want ${e.clarification} · got ${frame.clarification.needed ? `needed (${frame.clarification.reason ?? "?"})` : "not needed"} [${frame.clarification.fields.join(",")}]`,
  );

  // ── Structural invariants (§20). Graded on EVERY case, named or not.
  //    "The expected field is right" is not a pass when another field
  //    swallowed half the sentence — that is the exact shape of the failure
  //    the old grader let through.
  for (const k of structuralChecks(c, frame, violations)) checks.push(k);

  return checks;
}

/**
 * Independent of what the case expects, and independent of the extractor's own
 * vocabularies. Each one corresponds to a way a frame can be malformed while
 * every named expectation still passes.
 */
function structuralChecks(
  c: Case,
  f: UnderstandingFrame,
  violations: Violation[],
): Check[] {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });

  // The validator's own verdict. An error-severity violation is the frame
  // being internally inconsistent, which no expectation excuses.
  const blocking = violations.filter((v) => v.severity === "error");
  add(
    "NO_BLOCKING_VIOLATIONS",
    blocking.length === 0,
    blocking.map((v) => `${v.code}@${v.path}`).join(", ") || "none",
  );

  const locText = `${lc(f.location?.value)} ${lc(f.location?.raw)}`.trim();
  if (locText) {
    add(
      "LOCATION_NO_RELATION_TEXT",
      !RELATION_CUES.test(locText),
      `location carries relation wording: "${f.location?.raw ?? f.location?.value}"`,
    );
    add(
      "LOCATION_NO_TEMPORAL_TEXT",
      !TEMPORAL_CUES.test(lc(f.location?.value)),
      `location carries temporal wording: "${f.location?.value}"`,
    );
    // A place name is one to four words ("Trois-Rivières", "New South Wales").
    // Anything longer is a clause that was never clipped.
    add(
      "LOCATION_NOT_A_CLAUSE",
      words(f.location?.value).length <= 4,
      `location is ${words(f.location?.value).length} words: "${f.location?.value}"`,
    );
  }

  // §9 as a corpus-independent check: the prompt names a time and the frame
  // recorded no time. Either it was dropped or it went somewhere else.
  if (TEMPORAL_WINDOW_CUES.test(c.prompt) && f.temporal === null && !f.compound.is_compound) {
    add("TEMPORAL_NOT_LOST", false, `prompt names a time window; frame.temporal is null`);
  }

  // §12: a place the user excluded must not also be the place we search.
  const excluded = f.constraints
    .filter((k) => k.field === "location" && k.negated)
    .map((k) => lc(String(k.value)));
  if (excluded.length && f.location) {
    add(
      "EXCLUDED_LOCATION_NOT_PRIMARY",
      !excluded.some((x) => x && (lc(f.location?.value).includes(x) || x.includes(lc(f.location?.value)))),
      `"${f.location.value}" is both the search area and an exclusion`,
    );
  }

  // §10: the prompt asked for an amount and the frame forgot it. A number a
  // constraint already claimed is not a lost quantity — "at least 100
  // employees" and "within 30 miles" are filters, and the cue regex cannot
  // tell them from "at least 100 leads" without reading the noun after them.
  if (QUANTITY_CUES.test(c.prompt)) {
    const q = f.quantity;
    const carried =
      !!q && (q.requested !== null || q.minimum !== null || q.maximum !== null || q.unlimited);
    // A number the temporal window owns is not a lost quantity either: "posted
    // in the last 30 days" names no amount of leads, and the cue regex reads
    // "30 days" as one because it cannot see which field claimed it. Nor is a
    // search radius: "within 10 miles of Ballarat" is a geography, and reading
    // it as a request for ten rows failed two otherwise-correct frames.
    const numbersInPrompt = c.prompt.match(/\d{1,5}/g) ?? [];
    const claimed = new Set([
      ...f.constraints.flatMap((k) => String(k.value).match(/\d{1,5}/g) ?? []),
      ...(`${f.temporal?.window ?? ""} ${f.temporal?.raw ?? ""} ${f.temporal?.year ?? ""}`.match(
        /\d{1,5}/g,
      ) ?? []),
      ...(f.location?.radius == null ? [] : [String(f.location.radius)]),
    ]);
    const unclaimed = numbersInPrompt.filter((n) => !claimed.has(n));
    if (carried || unclaimed.length > 0) {
      add("QUANTITY_NOT_LOST", carried, `prompt names an amount; quantity is ${JSON.stringify(q)}`);
    }
  }

  // §13: claiming compound and carrying one goal is worse than not splitting.
  if (f.compound.is_compound) {
    add(
      "COMPOUND_KEEPS_SUBGOALS",
      f.compound.subgoals.length >= 2 || f.clarification.needed,
      `${f.compound.subgoals.length} subgoals, clarification ${f.clarification.needed ? "asked" : "not asked"}`,
    );
  }

  // §14: a plain entity request must not be interrogated about a relationship
  // it never implied.
  if (f.relation.type.value === "none" && f.clarification.needed) {
    add(
      "NO_RELATION_CLARIFICATION",
      !f.clarification.fields.some((x) => x.startsWith("relation")),
      `asked about ${f.clarification.fields.join(",")} for a request with no relation`,
    );
  }

  // §3: a relation that is meaningless without its object.
  //
  // `hiring` is deliberately absent. "agencies that are hiring right now" is a
  // complete request — an employer with any open role — and requiring an object
  // there fails a frame that read the sentence correctly. The kept entries are
  // the ones where the sentence is genuinely unfinished: "companies that need"
  // is not a search until you know what they need.
  const needsObject = new Set([
    "needs_service",
    "offers_service",
    "lacks_asset",
    "has_asset",
    "uses_technology",
  ]);
  if (needsObject.has(f.relation.type.value)) {
    add(
      "RELATION_HAS_OBJECT",
      !!f.relation.object?.value,
      `${f.relation.type.value} with no object`,
    );
  }

  // §20 NO_EXTRANEOUS_CAPTURE: a field holding a sentence instead of a phrase.
  //
  // Measured per descriptor, never over `targetPhrase`. That helper joins every
  // slot AND each one's normalized twin so an expectation can match whichever
  // slot a reading chose — which makes its width roughly twice the number of
  // slots filled, and reads a correct four-word category as a nine-word clause.
  const long: string[] = [];
  const widest = Math.max(
    0,
    ...[
      f.target.role,
      f.target.job_title,
      f.target.category,
      f.target.business_type,
      f.target.industry,
      f.target.niche,
      f.target.entity_subtype,
    ].map((d) => words(d?.value).length),
  );
  if (widest > 6) long.push(`target(${widest}w)`);
  if (words(f.relation.object?.value).length > 6)
    long.push(`object(${words(f.relation.object?.value).length}w)`);
  for (const k of f.constraints) {
    if (typeof k.value === "string" && words(k.value).length > 5) long.push(`constraint:${k.field}`);
  }
  add("NO_EXTRANEOUS_CAPTURE", long.length === 0, long.join(", ") || "none");

  return out;
}

/** The semantic core, for pair comparison. Presentation and provenance are
 *  excluded: two frames differing only in a confidence score are the same
 *  reading, and would make a pair look distinguished when it is not. */
function semanticCore(f: UnderstandingFrame): string {
  return JSON.stringify({
    entity: f.target.entity_type.value,
    subtype: f.target.entity_subtype?.value ?? null,
    role: lc(f.target.role?.value) || null,
    category: lc(f.target.category?.value) || null,
    industry: lc(f.target.industry?.value) || null,
    relation: f.relation.type.value,
    label: lc(f.relation.label) || null,
    object: lc(f.relation.object?.value) || null,
    direction: f.relation.direction.value,
    on_behalf: f.organization_context.on_behalf_of_company,
    claim: f.evidence.claim_evidence_required,
    intent: f.evidence.intent_signal_required,
  });
}

// ── Running ───────────────────────────────────────────────────────────────

/** Every provider was busy at once — worth waiting out, unlike a real fault. */
function looksRateLimited(err: string | null): boolean {
  return !!err && /429|rate.?limit|too many requests|quota/i.test(err);
}

/**
 * A per-minute limit refills while the run waits; a per-DAY one does not. Told
 * apart, the second is the only honest reason to stop a run early — grading two
 * hundred cases on the deterministic fallback produces a long report that
 * measures something nobody asked about, and reads exactly like a real one.
 */
function looksDailyExhausted(err: string | null): boolean {
  return !!err && /per day|\bTPD\b|per-day|daily limit|free-models-per-day/i.test(err);
}

/** Set once the day's budget is gone, so the remaining cases stop pretending. */
let dailyExhausted: string | null = null;
let requiredLlmFallback: Graded | null = null;

class DailyBudgetGone extends Error {}

async function runOne(c: Case): Promise<Graded> {
  try {
    const llmOpts = { bypassCache: NO_CACHE, waitForSlotMs: 45_000, pin: PIN };
    let extracted = DETERMINISTIC
      ? { frame: extractFrameDeterministic(c.prompt), error: null, usage: null }
      : await extractFrameLLM(c.prompt, llmOpts);

    // One bounded retry, and only for a rate limit the run can outlast. A case
    // graded on the fallback measures the fallback, so it is worth 30 seconds
    // to avoid — but a spent daily budget will not refill in 30 seconds, and a
    // genuinely broken provider must not turn into a stalled run.
    if (
      !DETERMINISTIC &&
      extracted.frame.meta.fallback_used &&
      looksRateLimited(extracted.error) &&
      !looksDailyExhausted(extracted.error)
    ) {
      process.stdout.write("~");
      await sleep(30_000);
      extracted = await extractFrameLLM(c.prompt, llmOpts);
    }

    if (!DETERMINISTIC && !REQUIRE_LLM && looksDailyExhausted(extracted.error)) {
      dailyExhausted ??= extracted.error;
    }

    const { frame: validated, violations, repairs } = validateFrame(extracted.frame);
    const frame = syncClarification(validated);
    const checks = grade(c, frame, violations);
    return {
      case: c,
      frame,
      violations,
      repairs,
      checks,
      pass: checks.every((k) => k.ok),
      error: extracted.error,
      usage: extracted.usage,
    };
  } catch (err) {
    const frame = extractFrameDeterministic(c.prompt);
    frame.meta.fallback_used = true;
    frame.meta.notes.push("LLM extraction threw; deterministic fallback used by verifier");
    return {
      case: c,
      frame,
      violations: [],
      repairs: [],
      checks: [{ name: "ran", ok: false, detail: String(err) }],
      pass: false,
      error: err instanceof Error ? err.message : String(err),
      usage: null,
    };
  }
}

/** Next moment a call may START, so the pace holds across workers. */
let gate = 0;

async function takeSlot() {
  if (PACE_MS <= 0) return;
  const now = Date.now();
  const start = Math.max(now, gate);
  gate = start + PACE_MS;
  if (start > now) await sleep(start - now);
}

async function runAll(cases: Case[]): Promise<Graded[]> {
  const out: Graded[] = new Array(cases.length);
  let next = 0;
  const started = Date.now();
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    for (;;) {
      if (requiredLlmFallback) return;
      const i = next++;
      if (i >= cases.length) return;
      if (dailyExhausted) throw new DailyBudgetGone(dailyExhausted);
      await takeSlot();
      if (requiredLlmFallback) return;
      out[i] = await runOne(cases[i]!);
      // "f" is the one that matters: the case ran, but on the deterministic
      // fallback, so its frame says nothing about the LLM prompt.
      const g = out[i]!;
      process.stdout.write(g.frame.meta.fallback_used ? "f" : g.pass ? "." : "x");
      if (mustAbortRequiredLlmRun(REQUIRE_LLM, DETERMINISTIC, g.frame.meta.fallback_used)) {
        requiredLlmFallback ??= g;
        return;
      }
      if (i % 20 === 19) {
        const done = i + 1;
        const rate = (Date.now() - started) / done;
        const left = Math.round(((cases.length - done) * rate) / 1000);
        process.stdout.write(` ${done}/${cases.length} ~${left}s left\n`);
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  return out.filter((g): g is Graded => g !== undefined);
}

// ── Reporting ─────────────────────────────────────────────────────────────

type PairVerdict = {
  a: Graded;
  b: Graded;
  distinct: boolean;
};

function pairVerdicts(graded: Graded[]): PairVerdict[] {
  const byId = new Map(graded.map((g) => [g.case.id, g]));
  const seen = new Set<string>();
  const out: PairVerdict[] = [];
  for (const g of graded) {
    const other = g.case.pairWith ? byId.get(g.case.pairWith) : undefined;
    if (!other) continue;
    const key = [g.case.id, other.case.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: g, b: other, distinct: semanticCore(g.frame) !== semanticCore(other.frame) });
  }
  return out;
}

function frameBlock(g: Graded): string {
  const f = g.frame;
  const m = f.meta;
  const lines: string[] = [];

  lines.push(`#### ${g.pass ? "PASS" : "FAIL"} · \`${g.case.id}\``);
  lines.push("");
  lines.push(`> ${g.case.prompt}`);
  lines.push("");
  if (g.case.note) lines.push(`_note: ${g.case.note}_`, "");
  lines.push(
    `Extractor: **${m.extractor === "llm" ? "LLM" : "Deterministic"}** · Provider: ${m.provider ?? (m.cached ? "cache" : "—")} · Prompt: ${m.prompt_version ?? "—"} · Time: ${m.latency_ms} ms · Fallback: ${m.fallback_used ? "Yes" : "No"}`,
  );
  lines.push("");

  // The readable summary is what actually gets eyeballed; the JSON below it is
  // for when the summary looks wrong and you need to know why.
  lines.push("| field | value |");
  lines.push("| --- | --- |");
  lines.push(`| Task | ${f.task_type.value} |`);
  lines.push(`| Prospecting mode | ${f.prospecting_mode.value} |`);
  lines.push(`| Target | ${f.target.entity_type.value}${f.target.entity_subtype ? ` / ${f.target.entity_subtype.value}` : ""} |`);
  if (f.target.role) lines.push(`| Role | ${f.target.role.value} |`);
  if (f.target.job_title) lines.push(`| Job title | ${f.target.job_title.value} |`);
  if (f.target.industry) lines.push(`| Industry | ${f.target.industry.value} |`);
  if (f.target.category) lines.push(`| Category | ${f.target.category.value} |`);
  if (f.target.business_type) lines.push(`| Business type | ${f.target.business_type.value} |`);
  if (f.target.company_stage) lines.push(`| Company stage | ${f.target.company_stage.value} |`);
  if (f.target.technologies.length)
    lines.push(`| Technologies | ${f.target.technologies.map((t) => t.value).join(", ")} |`);
  const sells = f.user_context.selling?.service?.value ?? f.user_context.selling?.product?.value;
  if (sells) lines.push(`| User sells | ${sells} |`);
  if (f.user_context.objective) lines.push(`| User objective | ${f.user_context.objective.value} |`);
  lines.push(`| Relation | ${f.relation.type.value}${f.relation.label ? ` (${f.relation.label})` : ""} |`);
  lines.push(`| Subject | ${targetPhrase(f) || f.target.entity_type.value} |`);
  lines.push(`| Object | ${f.relation.object?.value ?? "—"} |`);
  lines.push(`| Direction | ${f.relation.direction.value} |`);
  lines.push(`| On behalf of company | ${f.organization_context.on_behalf_of_company} |`);
  lines.push(
    `| Location | ${f.location ? `${f.location.value} (${f.location.scope}${f.location.radius ? ` ${f.location.radius}${f.location.radius_unit ?? ""}` : ""}) — raw "${f.location.raw}"` : "—"} |`,
  );
  lines.push(
    `| Temporal | ${f.temporal ? `${[f.temporal.relation, f.temporal.window, f.temporal.year].filter(Boolean).join(" · ")} — raw "${f.temporal.raw}"` : "—"} |`,
  );
  lines.push(
    `| Quantity | ${f.quantity ? quantityText(f.quantity) : "—"} |`,
  );
  lines.push(
    `| Constraints | ${f.constraints.length ? f.constraints.map(constraintText).join("; ") : "—"} |`,
  );
  lines.push(
    `| Required fields | ${f.required_fields.map((x) => x.value).join(", ") || "—"} |`,
  );
  lines.push(
    `| Preferred fields | ${f.preferred_fields.map((x) => x.value).join(", ") || "—"} |`,
  );
  lines.push(
    `| Verification | ${f.verification.map((v) => v.label ?? v.kind).join(", ") || "—"} |`,
  );
  lines.push(`| Output | ${f.output.map((o) => o.label ?? o.kind).join(", ") || "—"} |`);
  lines.push(`| Claim evidence required | ${f.evidence.claim_evidence_required ? "Yes" : "No"} |`);
  lines.push(`| Intent signal required | ${f.evidence.intent_signal_required ? "Yes" : "No"} |`);
  lines.push(
    `| Compound | ${f.compound.is_compound ? `Yes (${f.compound.subgoals.length})` : "No"} |`,
  );
  lines.push(
    `| Clarification | ${f.clarification.needed ? `${f.clarification.reason ?? "?"} · [${f.clarification.fields.join(", ")}] — ${f.clarification.question ?? ""}` : "None"} |`,
  );
  lines.push("");

  if (f.compound.subgoals.length) {
    lines.push("Subgoals:");
    lines.push("");
    for (const s of f.compound.subgoals) {
      lines.push(
        `- ${s.target.entity_type.value} · ${[s.target.role?.value, s.target.category?.value].filter(Boolean).join(" / ") || "—"} · ${s.relation?.type.value ?? "none"} · ${s.location?.value ?? "—"}`,
      );
    }
    lines.push("");
  }

  const failed = g.checks.filter((k) => !k.ok);
  if (failed.length) {
    lines.push("Failed checks:");
    lines.push("");
    for (const k of failed) lines.push(`- \`${k.name}\` — ${k.detail}`);
    lines.push("");
  }
  if (g.violations.length) {
    lines.push("Violations:");
    lines.push("");
    for (const v of g.violations) lines.push(`- **${v.severity}** \`${v.code}\` @ \`${v.path}\` — ${v.message}`);
    lines.push("");
  }
  if (g.repairs.length) {
    lines.push("Normalizations:");
    lines.push("");
    for (const r of g.repairs) lines.push(`- \`${r.path}\` — ${r.message}`);
    lines.push("");
  }
  if (g.error) lines.push(`Extraction error: \`${g.error}\``, "");

  lines.push("<details><summary>Full frame</summary>", "");
  lines.push("```json");
  lines.push(JSON.stringify(f, null, 2));
  lines.push("```");
  lines.push("", "</details>", "");
  return lines.join("\n");
}

function constraintText(c: {
  field: string;
  operator: string;
  value: unknown;
  unit: string | null;
  negated: boolean;
}): string {
  const v = Array.isArray(c.value) ? c.value.join("|") : String(c.value ?? "");
  return `${c.negated ? "NOT " : ""}${c.field} ${c.operator} ${v}${c.unit ? ` ${c.unit}` : ""}`.trim();
}

function quantityText(q: NonNullable<UnderstandingFrame["quantity"]>): string {
  const bits = [
    q.requested !== null ? `requested ${q.requested}` : "",
    q.minimum !== null ? `min ${q.minimum}` : "",
    q.maximum !== null ? `max ${q.maximum}` : "",
    q.unlimited ? "unlimited" : "",
    q.approximate ? "approximate" : "",
  ].filter(Boolean);
  return `${bits.join(", ") || "—"}${q.raw ? ` — raw "${q.raw}"` : ""}`;
}

// ── Aggregates the final report is required to carry (§29) ────────────────

type AxisStat = { ok: number; total: number };

function axisAccuracy(graded: Graded[]): Map<string, AxisStat> {
  const out = new Map<string, AxisStat>();
  for (const g of graded) {
    for (const k of g.checks) {
      const s = out.get(k.name) ?? { ok: 0, total: 0 };
      s.total += 1;
      if (k.ok) s.ok += 1;
      out.set(k.name, s);
    }
  }
  return out;
}

/** Named counts, so a regression in any single failure mode is legible even
 *  when the overall pass rate barely moves. */
function failureCounters(graded: Graded[]) {
  const failedAxis = (g: Graded, name: string) =>
    g.checks.some((k) => k.name === name && !k.ok);
  return {
    wrong_direction: graded.filter((g) => failedAxis(g, "DIRECTION")).length,
    wrong_target: graded.filter(
      (g) => failedAxis(g, "ENTITY_TYPE") || failedAxis(g, "TARGET_PHRASE"),
    ).length,
    wrong_relation: graded.filter((g) => failedAxis(g, "RELATION")).length,
    location_contamination: graded.filter(
      (g) =>
        failedAxis(g, "LOCATION_NO_RELATION_TEXT") || failedAxis(g, "LOCATION_NOT_A_CLAUSE"),
    ).length,
    temporal_contamination: graded.filter(
      (g) => failedAxis(g, "LOCATION_NO_TEMPORAL_TEXT") || failedAxis(g, "TEMPORAL_NOT_LOST"),
    ).length,
    quantity_loss: graded.filter((g) => failedAxis(g, "QUANTITY_NOT_LOST")).length,
    compound_loss: graded.filter((g) => failedAxis(g, "COMPOUND_KEEPS_SUBGOALS")).length,
    unnecessary_clarification: graded.filter(
      (g) => failedAxis(g, "NO_RELATION_CLARIFICATION") || failedAxis(g, "CLARIFICATION"),
    ).length,
    extraneous_capture: graded.filter((g) => failedAxis(g, "NO_EXTRANEOUS_CAPTURE")).length,
    blocking_violations: graded.filter((g) => failedAxis(g, "NO_BLOCKING_VIOLATIONS")).length,
  };
}

function sizeTable(graded: Graded[]): string[] {
  const groups: SizeGroup[] = ["tiny", "small", "medium", "large"];
  const lines = ["| size | cases | passed |", "| --- | --- | --- |"];
  for (const s of groups) {
    const g = graded.filter((x) => sizeOf(x.case.prompt) === s);
    if (!g.length) continue;
    lines.push(`| ${s} | ${g.length} | ${g.filter((x) => x.pass).length}/${g.length} |`);
  }
  return lines;
}

function setSection(title: string, graded: Graded[], readMe: string): string {
  const pass = graded.filter((g) => g.pass).length;
  const pairs = pairVerdicts(graded);
  const collapsed = pairs.filter((p) => !p.distinct);

  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`Cases: **${graded.length}** · Passed automated checks: **${pass}/${graded.length}**`);
  if (pairs.length) {
    lines.push(
      `Adversarial pairs: **${pairs.length}** · Distinct frames: **${pairs.length - collapsed.length}/${pairs.length}**`,
    );
  }
  lines.push("");
  lines.push(readMe);
  lines.push("");

  lines.push(...sizeTable(graded));
  lines.push("");

  const counters = failureCounters(graded);
  lines.push("| failure mode | cases |");
  lines.push("| --- | --- |");
  lines.push(`| collapsed adversarial pairs | ${collapsed.length} |`);
  for (const [k, n] of Object.entries(counters)) lines.push(`| ${k.replace(/_/g, " ")} | ${n} |`);
  lines.push("");

  const axes = [...axisAccuracy(graded)].sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total);
  lines.push("<details><summary>Per-axis accuracy</summary>", "");
  lines.push("| axis | correct | graded | % |");
  lines.push("| --- | --- | --- | --- |");
  for (const [name, s] of axes) {
    lines.push(`| ${name} | ${s.ok} | ${s.total} | ${Math.round((s.ok / s.total) * 100)}% |`);
  }
  lines.push("", "</details>", "");

  if (collapsed.length) {
    lines.push("### Collapsed pairs — Gate 1 failures");
    lines.push("");
    lines.push(
      "These two prompts mean different things and produced the same semantic core. This is the exact failure the gate exists to catch, and it is not negotiable by any passing check above.",
    );
    lines.push("");
    for (const p of collapsed) {
      lines.push(`- \`${p.a.case.id}\` “${p.a.case.prompt}”`);
      lines.push(`  \`${p.b.case.id}\` “${p.b.case.prompt}”`);
      lines.push(`  → both: ${semanticCore(p.a.frame)}`);
    }
    lines.push("");
  }

  const fails = graded.filter((g) => !g.pass);
  if (fails.length) {
    lines.push("### Cases that failed a check");
    lines.push("");
    for (const g of fails) lines.push(frameBlock(g));
  }

  lines.push("### Every frame");
  lines.push("");
  for (const g of graded) lines.push(frameBlock(g));

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  await ensureCityGazetteer();
  if (!cityGazetteerRegistered()) throw new Error("city gazetteer failed to register");

  const holdout = generateHoldout(SEED, HOLDOUT_N);
  const chaos = generateChaos(SEED, CHAOS_N);

  const sets: { name: string; cases: Case[]; readMe: string }[] = [];
  // §26 phase 1. Ten unseen cases, one per semantic family, to be read by hand
  // before any larger batch is worth its quota.
  if (ONLY === "smoke") {
    sets.push({
      name: "SMOKE",
      cases: smokeCases(SEED),
      readMe:
        "Ten unseen cases, one per semantic family (plain entity · needs vs offers · hiring vs seeking job · opportunity · quantity · negation · temporal · compound · chaos · long). Read all ten frames. A systemic error here is a reason to stop and fix rather than spend the rest of the day's budget.",
    });
  }
  if (ONLY === "all" || ONLY === "train") {
    sets.push({
      name: "TRAIN",
      cases: TRAIN,
      readMe:
        "Hand-written. Tuning against these is allowed, which is also why a green TRAIN section proves nothing on its own.",
    });
  }
  if (ONLY === "all" || ONLY === "holdout") {
    sets.push({
      name: "HOLDOUT",
      cases: holdout,
      readMe:
        "Generated fresh from the pools at grading time. Never hand-fix one of these prompts: if a holdout case is wrong, the extractor's reasoning is wrong.",
    });
  }
  if (ONLY === "all" || ONLY === "chaos") {
    sets.push({
      name: "CHAOS",
      cases: chaos,
      readMe:
        "Holdout prompts plus typos, slang, casing, punctuation and emoji. Every mangle preserves meaning, so a failure here is a robustness failure and not a wrong expectation.",
    });
  }

  const pinLabel = PIN ? `${PIN.gateway ?? "*"}:${PIN.model ?? "*"}` : "ladder";
  console.log(
    `Gate 1 grader · seed=${SEED} · holdout=${HOLDOUT_N} · chaos=${CHAOS_N} · extractor=${DETERMINISTIC ? "deterministic" : "llm"}` +
      (DETERMINISTIC ? "" : ` · pin=${pinLabel}${REQUIRE_LLM ? " · require-llm" : ""}`),
  );

  const results: { name: string; graded: Graded[]; readMe: string }[] = [];
  for (const s of sets) {
    console.log(`\n${s.name} (${s.cases.length} cases)`);
    results.push({ name: s.name, graded: await runAll(s.cases), readMe: s.readMe });
  }

  // Persist the drawn cases so a report can be reproduced even if the pools or
  // the generator change later.
  const outDir = REPORT_DIR ? resolve(REPORT_DIR) : join(process.cwd(), "reports", "understanding");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `gate1-${stamp}-seed${SEED}`;

  writeFileSync(
    join(outDir, `${base}.cases.json`),
    JSON.stringify({ seed: SEED, holdout, chaos }, null, 2),
    "utf8",
  );

  const head: string[] = [];
  head.push(`# Gate 1 — Understanding report`);
  head.push("");
  head.push(`Generated ${new Date().toISOString()}`);
  head.push("");
  head.push(
    `Seed \`${SEED}\` · holdout ${HOLDOUT_N} · chaos ${CHAOS_N} · extractor **${DETERMINISTIC ? "deterministic" : "LLM"}**` +
      (DETERMINISTIC ? "" : ` · model \`${pinLabel}\`${REQUIRE_LLM ? " · `--require-llm`" : ""}`),
  );
  head.push("");
  head.push("## How to read this");
  head.push("");
  head.push(
    "A pass count is not evidence that understanding works. The expectations here are partial by design — entity type, relation, direction, location, evidence — so a frame can satisfy all of them and still be a poor reading of the sentence. **Gate 1 closes by reading the HOLDOUT and CHAOS frames below**, not by this file being green.",
  );
  head.push("");
  head.push("Two things in here are non-negotiable regardless of the counts:");
  head.push("");
  head.push(
    "1. **Collapsed pairs.** Two prompts that mean opposite things must not produce the same semantic core.",
  );
  head.push(
    "2. **Silently halved compound requests.** A compound frame carrying fewer than two subgoals has discarded part of what was asked.",
  );
  head.push("");

  // Latency, because the practical question is whether understanding itself is
  // what makes the product feel slow.
  const all = results.flatMap((r) => r.graded);
  const times = all.map((g) => g.frame.meta.latency_ms).sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))] ?? 0;
  const fellBack = all.filter((g) => g.frame.meta.fallback_used).length;
  head.push("## Cost of understanding");
  head.push("");
  head.push(
    `| cases | p50 | p90 | max | fell back to deterministic |`,
  );
  head.push(`| --- | --- | --- | --- | --- |`);
  head.push(
    `| ${all.length} | ${p(0.5)} ms | ${p(0.9)} ms | ${times.at(-1) ?? 0} ms | ${fellBack} |`,
  );
  head.push("");

  // Tokens, which is what a prompt compression has to move. Reported as a sum
  // and a per-case mean over the cases the gateway actually costed: a gateway
  // that reports no usage would otherwise drag the mean toward zero and make a
  // fat prompt look cheap.
  const costed = all.filter((g) => g.usage);
  if (costed.length > 0) {
    const sum = (pick: (u: NonNullable<Graded["usage"]>) => number | null) =>
      costed.reduce((n, g) => n + (pick(g.usage!) ?? 0), 0);
    const inTok = sum((u) => u.prompt);
    const outTok = sum((u) => u.completion);
    const per = (n: number) => Math.round(n / costed.length);
    head.push(
      `| costed calls | prompt tokens | completion tokens | mean in | mean out |`,
      `| --- | --- | --- | --- | --- |`,
      `| ${costed.length}/${all.length} | ${inTok.toLocaleString()} | ${outTok.toLocaleString()} | ${per(inTok)} | ${per(outTok)} |`,
      "",
    );
  }
  if (DETERMINISTIC) {
    head.push(
      "> **This run graded the deterministic fallback, not the LLM.** Every frame below was produced by keyword extraction with no model call. It is the right way to see what a user gets when the model is unreachable, and it is not a reading of the understanding prompt — for that, run without `--deterministic`.",
    );
    head.push("");
  } else if (fellBack > 0 && REQUIRE_LLM) {
    // Loudest line in the document, and first: a certification run that fell
    // back measured the keyword extractor. Every count below it is about
    // something other than the model named in the header.
    head.push(
      `> # LLM VALIDATION INVALID`,
      ">",
      `> ${fellBack} of ${all.length} cases were answered by the deterministic fallback, so this run did **not** certify ${PIN ? `\`${PIN.gateway ?? "*"}:${PIN.model ?? "*"}\`` : "any model"}. The pass counts below describe the fallback. Re-run once the provider is reachable; do not cite this file as an LLM result.`,
    );
    head.push("");
  } else if (fellBack > 0) {
    head.push(
      `> **${fellBack} of ${all.length} cases never reached the model.** Their frames were produced by the deterministic fallback, so for those cases this report grades the fallback and says nothing about the prompt. The usual cause is a rate limit: raise \`--pace\` (currently ${PACE_MS} ms between calls) or lower \`--concurrency\`. Reasons are printed under each affected frame as "Extraction error".`,
    );
    head.push("");
  }

  head.push("## Summary");
  head.push("");
  head.push("| set | cases | checks passed | pairs distinct |");
  head.push("| --- | --- | --- | --- |");
  for (const r of results) {
    const pairs = pairVerdicts(r.graded);
    head.push(
      `| ${r.name} | ${r.graded.length} | ${r.graded.filter((g) => g.pass).length}/${r.graded.length} | ${pairs.length ? `${pairs.filter((x) => x.distinct).length}/${pairs.length}` : "—"} |`,
    );
  }
  head.push("");

  const totalCounters = failureCounters(all);
  const totalCollapsed = results
    .flatMap((r) => pairVerdicts(r.graded))
    .filter((p) => !p.distinct).length;
  head.push("| failure mode | cases (all sets) |");
  head.push("| --- | --- |");
  head.push(`| collapsed adversarial pairs | ${totalCollapsed} |`);
  for (const [k, n] of Object.entries(totalCounters)) {
    head.push(`| ${k.replace(/_/g, " ")} | ${n} |`);
  }
  head.push("");

  const body = results.map((r) => setSection(r.name, r.graded, r.readMe)).join("\n\n");
  const reportPath = join(outDir, `${base}.md`);
  writeFileSync(reportPath, `${head.join("\n")}\n${body}\n`, "utf8");

  // Console summary. Deliberately worded so the number cannot be mistaken for
  // a verdict on understanding.
  console.log("");
  for (const r of results) {
    const pairs = pairVerdicts(r.graded);
    const collapsed = pairs.filter((x) => !x.distinct);
    console.log(
      `${r.name}: ${r.graded.filter((g) => g.pass).length}/${r.graded.length} checks passed` +
        (pairs.length ? ` · ${pairs.length - collapsed.length}/${pairs.length} pairs distinct` : ""),
    );
    for (const c of collapsed) {
      console.log(`  COLLAPSED PAIR: "${c.a.case.prompt}" == "${c.b.case.prompt}"`);
    }
  }
  if (!DETERMINISTIC && fellBack > 0) {
    console.log(
      `\n!! ${fellBack}/${all.length} cases fell back to the deterministic extractor and did not measure the prompt.`,
    );
    const why = new Map<string, number>();
    for (const g of all) {
      if (!g.frame.meta.fallback_used) continue;
      const k = (g.error ?? "unknown").slice(0, 120);
      why.set(k, (why.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`   ${n}x ${k}`);
    }
  }
  console.log(`\nReport:  ${reportPath}`);
  console.log(`Cases:   ${join(outDir, `${base}.cases.json`)}`);
  console.log(
    "\nThis is not a verdict. It means the implementation did not violate its automated expectations.",
  );
  console.log("Gate 1 closes after the HOLDOUT and CHAOS frames in that report have been read.");

  // A non-zero exit is the half of this that a script or a later step can act
  // on. Printing the words and exiting 0 leaves the invariant to whoever reads
  // the scrollback.
  if (REQUIRE_LLM && fellBack > 0) {
    console.error(
      `\nLLM VALIDATION INVALID — ${fellBack}/${all.length} cases came from the deterministic fallback.`,
    );
    process.exit(3);
  }
}

main().catch((err) => {
  if (err instanceof DailyBudgetGone) {
    // Stopping without a report is the point. The alternative is a full-length
    // document whose every frame came from the fallback, which looks like a
    // graded run and is not one.
    console.error("\n\nSTOPPED — the day's model budget is gone. No report was written.\n");
    console.error(`  ${err.message}\n`);
    console.error("The understanding prompt costs ~2.9k tokens per case. Free tiers give a");
    console.error("daily token/request budget, not just a per-minute one, so waiting does not");
    console.error("help once it is spent. Either grade a smaller sample when it resets:");
    console.error("\n  npm run verify:understanding -- --set train");
    console.error("  npm run verify:understanding -- --holdout 24 --chaos 16\n");
    console.error("or grade the deterministic fallback, which needs no budget and says so:");
    console.error("\n  npm run verify:understanding -- --deterministic\n");
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

function fmt(x: string | string[] | undefined): string {
  return x === undefined ? "—" : Array.isArray(x) ? x.join("|") : x;
}
