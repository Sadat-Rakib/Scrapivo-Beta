/**
 * Prompt-compression equivalence — did the cheaper prompt change any meaning?
 *
 * Compression is the one prompt edit that is supposed to change NOTHING about
 * the frames, so it is the one edit that can be checked mechanically: run a
 * fixed seed through the expensive prompt, record the frames, edit the prompt,
 * run the same seed again, and compare field by field.
 *
 *   npx tsx scripts/understanding-prompt-compare.mts --record reports/understanding/prompt-u1-v6.json
 *   # ... edit the prompt, bump UNDERSTANDING_PROMPT_VERSION ...
 *   npx tsx scripts/understanding-prompt-compare.mts --against reports/understanding/prompt-u1-v6.json
 *
 * The baseline lives in a FILE rather than in a second copy of the prompt
 * inside the source tree: two live prompts is two things to maintain and an
 * invitation to ship the wrong one, and the comparison only ever needs the
 * older one's answers, not its text.
 *
 * Not every difference is a regression — two readings of "looking for studio
 * work" can both be defensible — so the script separates the two:
 *
 *   BLOCKING   a direction flip, a lost constraint, a dropped subgoal, a lost
 *              required/preferred field, a question that was not being asked
 *              before. Each of these is a loss of the user's request, and §21
 *              of the brief refuses the compression outright for any of them.
 *   REVIEW     everything else that moved, printed for a person to read.
 *
 * Pinning is mandatory: a comparison across two prompts is only a comparison
 * if the model is held still.
 */

import "./_env.mts";

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { parseRef } from "../src/lib/ai/providers";
import {
  extractFrameLLM,
  UNDERSTANDING_PROMPT_VERSION,
} from "../src/lib/understanding/extract.server";
import { validateFrame } from "../src/lib/understanding/validate";
import type { UnderstandingFrame } from "../src/lib/understanding/frame";
import { OPERATORS } from "../src/lib/understanding/vocab";

/**
 * The seed. Fixed in the file, not generated: the two halves of the comparison
 * must be the same sentences, and one axis per case so a difference points at
 * something. Between them they exercise every block the prompt is about to
 * lose words from — which is what makes a silent deletion visible.
 */
const SEED: { id: string; input: string; axis: string }[] = [
  { id: "p1", input: "give me 40 taverns in Kavala", axis: "discovery + quantity" },
  { id: "p2", input: "sign painters in Valmiera looking for clients", axis: "direction A" },
  { id: "p3", input: "shops in Valmiera looking for sign painters", axis: "direction B" },
  { id: "p4", input: "foundries in Pardubice hiring pattern makers", axis: "hiring" },
  { id: "p5", input: "pattern makers in Pardubice looking for work", axis: "seeking_job" },
  { id: "p6", input: "alpaca farms around Puno with no website", axis: "absence" },
  {
    id: "p7",
    input: "companies in Rzeszow that posted a QA role in the last three weeks",
    axis: "temporal window",
  },
  { id: "p8", input: "seed investors funding peatland restoration startups", axis: "investment" },
  { id: "p9", input: "biochar startups seeking investors", axis: "funding" },
  {
    id: "p10",
    input: "freelance retouchers under $80/hour, excluding Gdansk, at least 5 years experience",
    axis: "constraints + negation",
  },
  { id: "p11", input: "luthiers in Cremona and also bow makers in Mirecourt", axis: "compound" },
  {
    id: "p12",
    input:
      "I sell kitchen extraction cleaning. find me 150+ takeaways across Fife that don't have a booking system, phone must be there, instagram would be nice, check they're still trading, csv plus outreach drafts",
    axis: "long request",
  },
  {
    id: "p13",
    input: "need cheesemongers round Ljubljana tryna take on new wholesale accounts rn",
    axis: "slang + spans",
  },
  { id: "p14", input: "find businesses", axis: "genuine clarification" },
];

// ── The projection that is compared ───────────────────────────────────────

/**
 * A frame reduced to the facts a person would call "what it understood".
 * Confidences, raw spans and provenance are deliberately excluded: they move
 * on every call and comparing them would bury the differences that matter.
 */
type Shape = {
  task: string;
  mode: string;
  entity: string;
  ambiguous: boolean;
  descriptors: string;
  /**
   * Three narrowing fields the projection did not read until shape v3, which
   * made it blind in the direction that matters: a word moved OUT of the seven
   * fields above and INTO one of these read as a loss, and a word moved the
   * other way read as an invention. Exactly that happened — "biochar startups"
   * put "startup" in company_stage and the comparison reported the word
   * dropped. `UNAVAILABLE` where a pre-v3 baseline simply never recorded them.
   */
  stage: string;
  tech: string;
  tags: string;
  relation: string;
  object: string;
  direction: string;
  location: string;
  temporal: string;
  quantity: string;
  constraints: string[];
  required: string[];
  preferred: string[];
  contacts: string[];
  /** `kind[:label]` plus the span it was taken from — see `askedFor`. */
  verification: string[];
  output: string[];
  subgoals: number;
  asks: string;
  selling: string;
};

/**
 * The shape changed shape once, and a baseline recorded under the old one
 * silently compares absent fields as equal. Stamped into the file and refused
 * on mismatch.
 */
const SHAPE_VERSION = 3;

/**
 * A field this record cannot answer for, because the shape it was written
 * under never captured it. Compared against anything it yields no line: an
 * absent measurement is not evidence of no change, and printing it as one
 * would be the same blindness in a louder font.
 */
const UNAVAILABLE = "\u0001unrecorded";

/**
 * A constraint identified by what it constrains, not by how it was spelled.
 *
 * Three normalizations, each of which produced a phantom "lost constraint":
 * a field name is `booking system` or `booking_system` depending on which side
 * of the alias table it came in on; the `value` of an `exists` check is
 * meaningless, since one prompt returned `false` and the other `null` for the
 * same "they do not have one"; and a unit is written `year` or `years` from one
 * call to the next. None of the three changes what is being constrained, which
 * is the only thing this comparison is entitled to judge.
 */
function constraintKey(c: {
  field: string;
  operator: string;
  value: unknown;
  unit: string | null;
  negated: boolean;
}): string {
  const field = c.field.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const value = c.operator === "exists" ? "" : JSON.stringify(c.value);
  const unit = c.unit ? c.unit.toLowerCase().replace(/s$/, "") : "";
  return `${c.negated ? "!" : ""}${field} ${c.operator}${value ? ` ${value}` : ""}${
    unit ? ` ${unit}` : ""
  }`;
}

function shapeOf(f: UnderstandingFrame): Shape {
  const t = f.temporal;
  const q = f.quantity;
  return {
    task: f.task_type.value,
    mode: f.prospecting_mode.value,
    entity: f.target.entity_type.value,
    ambiguous: f.target.entity_ambiguous,
    descriptors: [
      f.target.entity_subtype?.value,
      f.target.role?.value,
      f.target.job_title?.value,
      f.target.category?.value,
      f.target.industry?.value,
      f.target.business_type?.value,
      f.target.niche?.value,
    ]
      .filter(Boolean)
      .join("/"),
    stage: f.target.company_stage?.value ?? "",
    tech: f.target.technologies
      .map((x) => x.value)
      .sort()
      .join("/"),
    tags: f.target.descriptors
      .map((x) => x.value)
      .sort()
      .join("/"),
    relation: f.relation.type.value + (f.relation.label ? `(${f.relation.label})` : ""),
    object: f.relation.object?.value ?? "",
    direction: f.relation.direction.value,
    location: f.location
      ? `${f.location.value ?? f.location.raw ?? "?"}|${f.location.scope}${
          f.location.radius ? `|${f.location.radius}${f.location.radius_unit ?? ""}` : ""
        }`
      : "",
    temporal: t ? `${t.relation}|${t.window ?? ""}|${t.year ?? ""}` : "",
    quantity: q
      ? [
          q.requested != null ? `req ${q.requested}` : "",
          q.minimum != null ? `min ${q.minimum}` : "",
          q.maximum != null ? `max ${q.maximum}` : "",
          q.unlimited ? "unlimited" : "",
          q.approximate ? "approx" : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "",
    constraints: f.constraints.map(constraintKey).sort(),
    required: f.required_fields.map((v) => v.value).sort(),
    preferred: f.preferred_fields.map((v) => v.value).sort(),
    contacts: f.contact_requirements.map((v) => v.value).sort(),
    verification: f.verification
      .map((v) => `${v.kind}${v.label ? `:${v.label}` : ""}\u0001${v.raw ?? ""}`)
      .sort(),
    output: f.output.map((v) => `${v.kind}${v.label ? `:${v.label}` : ""}`).sort(),
    subgoals: f.compound.subgoals.length,
    asks: f.clarification.needed ? (f.clarification.reason ?? "yes") : "",
    selling: [f.user_context.selling?.service?.value, f.user_context.selling?.product?.value]
      .filter(Boolean)
      .join("/"),
  };
}

// ── What counts as blocking ───────────────────────────────────────────────

type Diff = { field: string; before: string; after: string; blocking: boolean; why?: string };

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") || "—" : String(v || "—"));

/** `kind[:label]` without the span that was appended for `askedFor`. */
const kindOf = (entry: string) => entry.split("\u0001")[0]!;

/**
 * Did the USER ask for this verification, or did the model add it?
 *
 * A dropped check is a loss of the request only when the request contained it.
 * The first comparison run flagged `business_exists` disappearing from "alpaca
 * farms around Puno with no website" — a sentence that asks for no checks at
 * all, so the expensive prompt had invented one and the cheap prompt was the
 * more faithful of the two. Invented information is its own defect; scoring its
 * removal as a regression would push the prompt back towards inventing.
 *
 * The span is the evidence: an entry whose `raw` is quoted from the input was
 * requested, one with no span or a span the input does not contain was not.
 */
function askedFor(entry: string, input: string): boolean {
  const raw = entry.split("\u0001")[1] ?? "";
  if (!raw.trim()) return false;
  const hay = input.toLowerCase().replace(/\s+/g, " ");
  return hay.includes(raw.toLowerCase().replace(/\s+/g, " ").trim());
}

/**
 * One rule per acceptance criterion in §21, and each is about LOSS rather than
 * about change: the compressed prompt is allowed to word an object differently,
 * and is not allowed to drop half of a compound request.
 */
function diff(before: Shape, after: Shape, input: string): Diff[] {
  const out: Diff[] = [];
  const add = (field: string, b: unknown, a: unknown, blocking: boolean, why?: string) => {
    if (b === UNAVAILABLE || a === UNAVAILABLE) return;
    if (show(b) !== show(a)) out.push({ field, before: show(b), after: show(a), blocking, why });
  };
  const lost = (b: string[], a: string[]) => b.filter((x) => !a.includes(x));

  add("direction", before.direction, after.direction, true, "a reversed request finds the wrong population");
  add("relation", before.relation, after.relation, before.relation !== after.relation && isReversal(before.relation, after.relation), "relation carries the direction");
  add("mode", before.mode, after.mode, false);
  add("entity", before.entity, after.entity, false);
  add("task", before.task, after.task, false);
  add("descriptors", before.descriptors, after.descriptors, false);
  add("stage", before.stage, after.stage, false);
  add("tech", before.tech, after.tech, false);
  add("tags", before.tags, after.tags, false);
  add("object", before.object, after.object, false);
  add("location", before.location, after.location, false);
  add("temporal", before.temporal, after.temporal, before.temporal !== "" && after.temporal === "", "a dropped time window widens the search silently");
  add("quantity", before.quantity, after.quantity, before.quantity !== "" && after.quantity === "", "a dropped count returns the wrong volume");
  add(
    "constraints",
    before.constraints,
    after.constraints,
    lost(before.constraints, after.constraints).length > 0,
    "a lost constraint returns rows the user excluded",
  );
  add("required", before.required, after.required, lost(before.required, after.required).length > 0, "a lost required field loses a deliverable");
  add("preferred", before.preferred, after.preferred, lost(before.preferred, after.preferred).length > 0, "a lost preferred field loses a deliverable");
  add("contacts", before.contacts, after.contacts, lost(before.contacts, after.contacts).length > 0, "a lost contact requirement loses a deliverable");
  add(
    "verification",
    before.verification.map(kindOf),
    after.verification.map(kindOf),
    lost(before.verification, after.verification).some((v) => askedFor(v, input)),
    "a lost check the user asked for is an unproven claim",
  );
  add("output", before.output, after.output, lost(before.output, after.output).length > 0, "a lost output kind is a deliverable nobody asked to drop");
  add("subgoals", before.subgoals, after.subgoals, after.subgoals < before.subgoals, "half a compound request went missing");
  add("asks", before.asks, after.asks, before.asks === "" && after.asks !== "", "a question the expensive prompt did not need");
  add("selling", before.selling, after.selling, before.selling !== "" && after.selling === "", "what the user sells is not recoverable later");
  add("ambiguous", before.ambiguous, after.ambiguous, false);
  return out;
}

/** A relation change that swaps who wants what, as opposed to a rewording. */
function isReversal(b: string, a: string): boolean {
  const sides: Record<string, "supply" | "demand"> = {
    offers_service: "supply",
    seeking_client: "supply",
    seeking_job: "supply",
    seeking_funding: "demand",
    needs_service: "demand",
    asking_for_help: "demand",
    hiring: "demand",
    investing_in: "supply",
  };
  return !!sides[b] && !!sides[a] && sides[b] !== sides[a];
}

// ── CLI ───────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
}

const PIN = parseRef(arg("model") ?? "nararouter:laguna-s-2.1");
const PACE_MS = Number.parseInt(arg("pace") ?? "6000", 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Record_ = {
  shape_version: number;
  prompt_version: string;
  model: string;
  recorded_at: string;
  cases: {
    id: string;
    input: string;
    axis: string;
    shape: Shape | null;
    error: string | null;
    latency_ms: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
  }[];
};

async function run(): Promise<Record_> {
  if (!PIN) throw new Error("--model must be gateway:model");
  const cases: Record_["cases"] = [];
  for (const c of SEED) {
    await sleep(PACE_MS);
    const out = await extractFrameLLM(c.input, {
      bypassCache: true,
      waitForSlotMs: 30_000,
      pin: { gateway: PIN.gateway, model: PIN.model },
    });
    // A fallback frame is the deterministic extractor's answer and says nothing
    // about either prompt, so it is recorded as an absence rather than scored.
    const answered = !out.frame.meta.fallback_used;
    cases.push({
      id: c.id,
      input: c.input,
      axis: c.axis,
      shape: answered ? shapeOf(validateFrame(out.frame).frame) : null,
      error: answered ? null : (out.error ?? "no model answer"),
      latency_ms: out.frame.meta.latency_ms,
      prompt_tokens: out.usage?.prompt ?? null,
      completion_tokens: out.usage?.completion ?? null,
    });
    const last = cases[cases.length - 1]!;
    console.log(
      `  ${c.id.padEnd(4)} ${answered ? "ok  " : "—   "} ${String(last.latency_ms).padStart(6)} ms  ${
        last.prompt_tokens ?? "?"
      } in / ${last.completion_tokens ?? "?"} out  ${c.input.slice(0, 54)}`,
    );
  }
  return {
    shape_version: SHAPE_VERSION,
    prompt_version: UNDERSTANDING_PROMPT_VERSION,
    model: `${PIN.gateway}:${PIN.model}`,
    recorded_at: new Date().toISOString(),
    cases,
  };
}

/**
 * Bring a shape-v1 baseline forward, as far as it can honestly be brought.
 *
 * Re-recording is the right answer and is not always available: the baseline
 * was captured under a prompt revision that has since been edited, and a
 * comparison against a prompt reconstructed from memory measures the
 * reconstruction. So the derivable half is derived — a v1 constraint string
 * carries its field, operator and value, which is everything `constraintKey`
 * needs — and the half that was never recorded is declared missing rather than
 * defaulted.
 *
 * The missing half is the verification span. `askedFor` cannot run without it,
 * so every v1 verification entry reads as unrequested and no drop can be
 * blocking. That is a hole in the check, and the run says so aloud instead of
 * reporting a clean comparison it did not perform.
 */
function upgrade(rec: Record_): void {
  const ops = new Set(OPERATORS as readonly string[]);
  for (const c of rec.cases) {
    if (!c.shape) continue;
    c.shape.constraints = c.shape.constraints
      .map((s) => {
        const negated = s.startsWith("!");
        const body = negated ? s.slice(1) : s;
        // `field op value unit` — the field may itself contain spaces, so the
        // operator is found by scanning for the first token in the vocabulary.
        const parts = body.split(" ");
        const at = parts.findIndex((p) => ops.has(p));
        if (at < 1) return s.toLowerCase();
        const field = parts.slice(0, at).join(" ");
        const operator = parts[at]!;
        const rest = parts.slice(at + 1);
        let value: unknown = null;
        try {
          value = rest.length ? JSON.parse(rest[0]!) : null;
        } catch {
          value = rest[0] ?? null;
        }
        const unit = rest.length > 1 ? rest.slice(1).join(" ") : null;
        return constraintKey({ field, operator, value, unit, negated });
      })
      .sort();
    c.shape.verification = c.shape.verification.map((v) => (v.includes("\u0001") ? v : `${v}\u0001`)).sort();
    // v2 and earlier never read these three, and there is nothing in the
    // record to reconstruct them from. They are marked unanswerable rather
    // than defaulted to "", which would read as "the model said nothing here"
    // and score every newly-populated stage as an invention.
    c.shape.stage ??= UNAVAILABLE;
    c.shape.tech ??= UNAVAILABLE;
    c.shape.tags ??= UNAVAILABLE;
  }
  rec.shape_version = SHAPE_VERSION;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

function report(rec: Record_): { p50: number; tokens: number } {
  const answered = rec.cases.filter((c) => c.shape);
  const tokens = answered.map((c) => c.prompt_tokens).filter((n): n is number => n != null);
  return {
    p50: median(answered.map((c) => c.latency_ms)),
    tokens: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0,
  };
}

async function main(): Promise<void> {
  const recordTo = arg("record");
  const againstFile = arg("against");
  if (!recordTo && !againstFile) {
    console.log("Pass --record <file> to capture a baseline, or --against <file> to compare.");
    return;
  }

  console.log(
    `Prompt ${UNDERSTANDING_PROMPT_VERSION} · ${PIN?.gateway}:${PIN?.model} · ${SEED.length} cases\n`,
  );
  const now = await run();
  const stats = report(now);
  console.log(`\np50 ${stats.p50} ms · mean prompt tokens ${stats.tokens}`);

  // Recording is worth doing even on a comparison run: fourteen model calls
  // have just been spent, and a later change to how two shapes are compared
  // should not have to spend them again to be re-checked.
  if (recordTo) {
    mkdirSync(dirname(recordTo), { recursive: true });
    writeFileSync(recordTo, JSON.stringify(now, null, 2));
    console.log(`\nRun written to ${recordTo}`);
    if (!againstFile) return;
  }

  const before = JSON.parse(readFileSync(againstFile!, "utf8")) as Record_;
  const was = before.shape_version ?? 1;
  if (was < SHAPE_VERSION) upgrade(before);
  if ((before.shape_version ?? 1) !== SHAPE_VERSION) {
    console.log(
      `\nREFUSED — baseline uses comparison shape v${before.shape_version ?? 1}, this run uses v${SHAPE_VERSION}, and no upgrade path exists between them. Re-record the baseline.`,
    );
    process.exit(1);
  }
  if (before.model !== now.model) {
    console.log(
      `\nREFUSED — baseline was recorded on ${before.model}, this run is ${now.model}. A prompt comparison across two models measures the models.`,
    );
    process.exit(1);
  }
  const beforeStats = report(before);

  console.log(`\n=== ${before.prompt_version} → ${now.prompt_version} ===\n`);
  let blocking = 0;
  let review = 0;
  let unanswered = 0;

  for (const c of now.cases) {
    const b = before.cases.find((x) => x.id === c.id);
    if (!b) continue;
    if (!b.shape || !c.shape) {
      unanswered++;
      console.log(`${c.id} ${c.axis} — UNCOMPARABLE (${(!b.shape ? before : now).prompt_version} did not answer)`);
      continue;
    }
    const ds = diff(b.shape, c.shape, c.input);
    if (ds.length === 0) {
      console.log(`${c.id.padEnd(4)} ${c.axis.padEnd(24)} identical`);
      continue;
    }
    console.log(`${c.id.padEnd(4)} ${c.axis.padEnd(24)} ${ds.length} change(s)   "${c.input.slice(0, 48)}"`);
    for (const d of ds) {
      if (d.blocking) blocking++;
      else review++;
      console.log(
        `       ${d.blocking ? "BLOCKING" : "review  "} ${d.field}: ${d.before}  →  ${d.after}${
          d.blocking && d.why ? `   (${d.why})` : ""
        }`,
      );
    }
  }

  const drop = beforeStats.tokens ? Math.round((1 - stats.tokens / beforeStats.tokens) * 100) : 0;
  console.log("\n=== SUMMARY ===\n");
  console.log(`prompt tokens   ${beforeStats.tokens} → ${stats.tokens}  (${drop >= 0 ? "-" : "+"}${Math.abs(drop)}%)`);
  console.log(`p50 latency     ${beforeStats.p50} ms → ${stats.p50} ms`);
  console.log(`blocking        ${blocking}`);
  console.log(`review          ${review}`);
  if (unanswered) console.log(`uncomparable    ${unanswered}`);
  console.log(
    `\n${
      blocking === 0
        ? "ACCEPTABLE on the mechanical axes — the review lines still need a human."
        : "REJECTED — a blocking difference is a loss of the user's request, whatever it saves."
    }`,
  );
  if (was < 2) {
    console.log(
      "\nNOTE — the baseline predates the verification-span check, so a dropped check could\n" +
        "not be tested for whether the user asked for it. Read every verification line by hand.",
    );
  }
  if (was < 3) {
    console.log(
      "\nNOTE — the baseline predates company_stage / technologies / descriptors[] being read,\n" +
        "so those three were not compared at all. A word the new prompt moved into one of them\n" +
        "reads above as dropped from `descriptors`. Check such a line against the frame itself.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
