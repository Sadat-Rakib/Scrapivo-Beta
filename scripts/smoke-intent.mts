import {
  classifyQuery,
  inferGoalFromQuery,
  isProductPitchQuery,
} from "../src/lib/search/query-classifier.ts";

const samples = [
  "companies and people looking for lead generation services",
  "I'm a designer looking for people who want designers",
  "I'm trying to sell my lead generation service",
  "I'm a designer looking for a design role",
  "need a logo designer",
];

for (const q of samples) {
  const c = classifyQuery(q);
  console.log(
    JSON.stringify({
      q,
      product: isProductPitchQuery(q),
      goal: inferGoalFromQuery(q),
      skill: c.coreSkill,
      signal: c.signalMode,
      type: c.type,
    }),
  );
}
