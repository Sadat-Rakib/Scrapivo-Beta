import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchStackExchange } from "../src/lib/search/stackexchange-sources.server";
import { scoreAndReason } from "../src/lib/search/sources.server";

const c = classifyQuery(
  "I'm selling a product that helps freelancers find clients and manage invoices",
);
c.goal = "clients";
const x = expandFromClassified(c);
const rows = await searchStackExchange(x);
console.log("fetched", rows.length);
let ok = 0;
for (const l of rows.slice(0, 10)) {
  const { score, reasons } = scoreAndReason(l as any, x);
  console.log(score, l.title?.slice(0, 60), reasons.slice(0, 2).join("; "));
  if (score >= 45) ok++;
}
console.log("warm+", ok);
