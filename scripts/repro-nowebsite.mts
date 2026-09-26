/** A1 reproduction: website-services selling flow, answered vs skipped site Q. */
import { runSpecSearchCore } from "@/lib/spec-search.functions";

async function run(label: string, answers: Record<string, string>) {
  const r = await runSpecSearchCore("dentists in Pune", {}, 20, answers);
  const withSite = r.rows.filter((x) => x.url).length;
  console.log(
    JSON.stringify({
      case: label,
      clarify: r.clarify.map((q) => q.id),
      rows: r.rows.length,
      withSite,
      withoutSite: r.rows.length - withSite,
      criteria: r.spec.criteria.map((c) => `${c.field}=${c.value}`),
    }),
  );
}

// Full answers: mode + offer + site=without
await run("answered-without", { mode: "selling", offer: "websites", opportunity: "no_website" });
// Skip path: mode + offer, site question never answered
await run("skipped-site", { mode: "selling", offer: "websites" });
// Free-text offer path as the user typed it
await run("freetext-mode", { mode: "I am trying to sell website services" });
