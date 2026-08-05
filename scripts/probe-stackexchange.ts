import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchStackExchange } from "../src/lib/search/stackexchange-sources.server";

for (const q of [
  "I'm selling a product that helps freelancers find clients and manage invoices",
  "I'm a teacher looking for students who need tutoring",
]) {
  const c = classifyQuery(q);
  const x = expandFromClassified(c);
  console.log("---", q.slice(0, 50));
  console.log("skill", x.skill, "related", x.relatedSkills.slice(0, 6), "type", x.queryType);
  const r = await searchStackExchange(x);
  console.log("SE", r.length, r.slice(0, 3).map((l) => `${l.platform}: ${l.title}`));
}
