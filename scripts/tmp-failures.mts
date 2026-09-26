/**
 * Temporary triage aid: re-grade the deterministic fallback over the saved case
 * file and print one line per failing check, so failures can be grouped by
 * cause rather than read one frame at a time. Not a test; delete when Gate 1
 * closes.
 */
import { readFileSync } from "node:fs";

import { extractFrameDeterministic } from "../src/lib/understanding/fallback";
import { validateFrame } from "../src/lib/understanding/validate";

type Saved = { set: string; id: string; prompt: string; expect: unknown };

const path = process.argv[2];
const only = process.argv[3]?.toUpperCase();
const file = JSON.parse(readFileSync(path, "utf8")) as {
  holdout: Saved[];
  chaos: Saved[];
};
const { TRAIN } = await import("../src/lib/understanding/corpus");
const cases: Saved[] = [
  ...TRAIN.map((c) => ({ set: "train", id: c.id, prompt: c.prompt, expect: c.expect })),
  ...file.holdout,
  ...file.chaos,
];

// Reuse the grader's own grading by importing it would pull in its CLI, so the
// triage instead prints the fields the failing axes name.
for (const c of cases) {
  const f = extractFrameDeterministic(c.prompt);
  const v = validateFrame(f);
  const e = c.expect as Record<string, unknown>;

  const got = {
    entity: f.target.entity_type.value,
    relation: f.relation.type.value,
    object: f.relation.object?.value ?? null,
    location: f.location?.value ?? null,
    locRaw: f.location?.raw ?? null,
    quantity: f.quantity
      ? [
          f.quantity.requested != null ? `=${f.quantity.requested}` : "",
          f.quantity.minimum != null ? `>=${f.quantity.minimum}` : "",
          f.quantity.maximum != null ? `<=${f.quantity.maximum}` : "",
          f.quantity.unlimited ? "∞" : "",
        ]
          .filter(Boolean)
          .join(" ")
      : null,
    constraints: f.constraints.map(
      (x) => `${x.negated ? "!" : ""}${x.field}.${x.operator}=${String(x.value)}`,
    ),
    clarify: f.clarification.needed ? f.clarification.reason : null,
    sells: f.user_context?.selling?.service?.value ?? f.user_context?.selling?.product?.value ?? null,
  };

  const alts = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : [];

  const bad: string[] = [];
  if (e.entity_type && !alts(e.entity_type).includes(got.entity))
    bad.push(`ENTITY want ${alts(e.entity_type).join("|")} got ${got.entity}`);
  if (e.relation && !alts(e.relation).includes(got.relation))
    bad.push(`RELATION want ${alts(e.relation).join("|")} got ${got.relation}`);
  if (e.object && !String(got.object ?? "").toLowerCase().includes(String(e.object).toLowerCase()))
    bad.push(`OBJECT want ${e.object} got ${got.object}`);
  if (e.location && !String(got.location ?? "").toLowerCase().includes(String(e.location).toLowerCase()))
    bad.push(`LOCATION want ${e.location} got ${got.location} (raw "${got.locRaw}")`);
  if (e.no_location && got.location) bad.push(`LOCATION want none got ${got.location}`);

  if (!bad.length) continue;
  if (only && c.set.toUpperCase() !== only) continue;
  if (only === "NONE") continue;

  console.log(`\n[${c.set}/${c.id}] ${c.prompt}`);
  for (const b of bad) console.log(`   ${b}`);
  console.log(
    `   q=${got.quantity ?? "—"} cons=[${got.constraints.join(", ")}] clar=${got.clarify ?? "—"} sells=${got.sells ?? "—"} viol=${v.violations.map((x) => x.code).join(",") || "—"}`,
  );
}
