/** Do the trade nouns in BUSINESS_TYPES read as people? Temporary. */
import { classifyHead } from "../src/lib/understanding/lexicon.js";
import { extractFrameDeterministic } from "../src/lib/understanding/fallback.js";
import { validateFrame } from "../src/lib/understanding/validate.js";

for (const s of [
  "piano tuners",
  "piano tuner",
  "taxidermists",
  "optometrists",
  "farriers",
  "cobblers",
  "chocolatiers",
  "sailmakers",
  "upholsterers",
  "board game cafés",
  "mushroom farms",
]) {
  const g = classifyHead(s, { guess: false });
  console.log(`${s.padEnd(18)} ${g.kind.padEnd(9)} amb=${g.ambiguous ? "Y" : "n"} c=${g.confidence}`);
}

console.log("---");
for (const q of [
  "Give me 40 piano tuners in Leuven, phone number required",
  "taxidermists in Braga",
  "optometrists in Leuven",
  "farriers near Enschede",
]) {
  const { frame } = validateFrame(extractFrameDeterministic(q));
  const t = frame.target as any;
  console.log(
    `${q.slice(0, 44).padEnd(46)} ${t.entity_type.value.padEnd(9)} role=${JSON.stringify(t.role?.value ?? null)} cat=${JSON.stringify(t.category?.value ?? null)} bt=${JSON.stringify(t.business_type?.value ?? null)}`,
  );
}
