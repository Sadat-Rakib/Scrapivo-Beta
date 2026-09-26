/** What the deterministic reader makes of field asks the model dropped. Temporary. */
import { extractFrameDeterministic } from "../src/lib/understanding/fallback";

const V = (x: any) => x?.value ?? x;

for (const q of [
  "need satellite imaging startups ann arbor funded this yr + founders names if u can",
  "need musictech startups chattanooga funded this yr + founders names if u can",
  "find  me 40  cobblers ouside  turku not  chains insta  if possible",
  "Give me 25 chocolatiers in Timișoara, phone number required, Instagram if possible, verify they are currently open, and output a spreadsheet",
  "cafes in Porto",
  "any roasteries near kelowna no prpoer website n got phone? pls?",
  "orthotics clinics daugavpils pls",
  "companies in Pereira hiring audiologists",
]) {
  const f = extractFrameDeterministic(q);
  console.log(
    `\n${JSON.stringify(q)}\n  req=[${f.required_fields.map(V)}] pref=[${f.preferred_fields.map(V)}]`,
  );
}
