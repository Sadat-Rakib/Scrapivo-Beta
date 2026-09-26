/** A2 live validation: stale_site prevalence + discrimination on real data. */
import { runSpecSearchCore } from "@/lib/spec-search.functions";

const r = await runSpecSearchCore(
  "plumbers in Austin",
  {},
  50,
  { mode: "selling", offer: "logo and branding", site: "with" },
);
const opp = r.spec.criteria.find((c) => c.field === "opportunity");
console.log(
  JSON.stringify({
    clarify: r.clarify.map((q) => q.id),
    rows: r.rows.length,
    opportunity: opp?.value ?? null,
    withSite: r.rows.filter((x) => x.url).length,
    withEmailOrPhone: r.rows.filter((x) => x.email || x.phone).length,
    sample: r.rows.slice(0, 3).map((x) => x.title),
  }),
);
