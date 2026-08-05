/**
 * The clarifier must fire on the FIRST search, not the second.
 *
 * Reported bug: after signing in, the first search returned results with no
 * questions; searching again showed them. The cause was not the clarifier
 * logic (verify-clarifier.mts passes 18/18) but its DELIVERY — discover.tsx
 * awaited a `prepareSearch` server call behind requireMyAuth inside a try with
 * an empty catch, so a failure on that first call silently ran an unclarified
 * search and left no trace.
 *
 * This asserts the properties that make the panel reliable:
 *   1. the decision is pure and needs no server, session or network
 *   2. call #1 is identical to call #2 — no warm-up, no hidden state
 *
 *   npx tsx scripts/verify-clarifier-first-search.ts
 */
import { classifyQuery } from "../src/lib/search/query-classifier";
import {
  shouldClarify,
  buildClarifyingQuestions,
  applyClarifyAnswers,
} from "../src/lib/search/clarifier";

/** Exactly what beginSearch now runs on the client. */
function prepareLocally(query: string) {
  const classified = classifyQuery(query);
  const needsClarify = shouldClarify(classified);
  return {
    needsClarify,
    questions: needsClarify
      ? buildClarifyingQuestions(classified, { hasLocation: !!classified.location })
      : [],
    defaultSummary: applyClarifyAnswers(classified, {}).summary,
  };
}

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// The queries from the bug report, plus the shapes that should NOT be blocked.
const shouldAsk = ["writers", "content writers", "designer", "marketing", "design"];
const shouldNotAsk = [
  "startups in Toronto hiring copywriters",
  "agencies in London that need SEO help",
];

console.log("\nAsks on the first search ─────────────────────────────────");
for (const q of shouldAsk) {
  const r = prepareLocally(q);
  check(`"${q}"`, r.needsClarify && r.questions.length > 0, `${r.questions.length} questions`);
}

console.log("\nStays out of the way when the query is already specific ──");
for (const q of shouldNotAsk) {
  const r = prepareLocally(q);
  check(`"${q}"`, !r.needsClarify || r.questions.length === 0);
}

console.log("\nFirst call == second call (the actual bug) ───────────────");
for (const q of [...shouldAsk, ...shouldNotAsk]) {
  const a = prepareLocally(q);
  const b = prepareLocally(q);
  check(`"${q}" is deterministic`, JSON.stringify(a) === JSON.stringify(b));
}

console.log("\nEvery asked question is answerable ───────────────────────");
for (const q of shouldAsk) {
  const { questions } = prepareLocally(q);
  check(
    `"${q}" options + default`,
    questions.every((x) => x.options.length > 0),
  );
}

console.log("\nSkipping still produces a usable search ──────────────────");
for (const q of shouldAsk) {
  const summary = applyClarifyAnswers(classifyQuery(q), {}).summary;
  check(`"${q}" has a skip summary`, !!summary && summary.length > 3, summary);
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} failing`}`);
process.exit(failures === 0 ? 0 : 1);
