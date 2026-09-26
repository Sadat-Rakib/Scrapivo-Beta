/** What the head-noun table says about spans a model might mislabel. Temporary. */
import { classifyHead } from "../src/lib/understanding/lexicon.js";

const SPANS = process.argv.length > 2 ? process.argv.slice(2) : [
  "wind turbine technicians",
  "quantity surveyors",
  "orthodontists",
  "dentists",
  "plumbers",
  "electricians",
  "copywriters",
  "freelance copywriters",
  "copywriting agencies",
  "marketing agencies",
  "law firms",
  "saunas",
  "waste haulage",
  "board game cafés",
  "cafes",
  "startups",
  "investors",
  "people",
  "companies",
  "web designers",
  "roofing contractors",
  "coffee roasters",
  "veterinary clinics",
];

for (const s of SPANS) {
  const g = classifyHead(s, { guess: false });
  const t = classifyHead(s);
  console.log(
    `${s.padEnd(24)} noguess=${g.kind.padEnd(8)} amb=${g.ambiguous ? "Y" : "n"} c=${g.confidence}   guess=${t.kind.padEnd(8)} amb=${t.ambiguous ? "Y" : "n"} c=${t.confidence}`,
  );
}
