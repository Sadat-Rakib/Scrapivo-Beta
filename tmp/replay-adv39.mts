import { extractSearchSpec } from "../src/lib/search/search-spec-extract.ts";
import { runSpecSearchCore } from "../src/lib/spec-search.functions.ts";

async function main() {
  for (const q of [
    "restaurant owners in Toronto looking for photographers",
    "people in New York looking for video editors",
  ]) {
    const s = extractSearchSpec(q);
    console.log(
      "EXTRACT",
      q,
      "→",
      s.criteria.find((c) => c.field === "location")?.value,
      s.criteria.find((c) => c.field === "location_id")?.value,
    );
  }
  const a = await runSpecSearchCore(
    "restaurant owners in Toronto looking for photographers",
    {},
    10,
    { mode: "looking" },
  );
  console.log(
    "ADV3",
    a.outcome,
    a.spec.criteria.find((c) => c.field === "location")?.value,
    a.spec.criteria.find((c) => c.field === "location_id")?.value,
    a.qualified_count,
  );
  const b = await runSpecSearchCore(
    "people in New York looking for video editors",
    {},
    10,
    { mode: "looking" },
  );
  console.log(
    "ADV9",
    b.outcome,
    b.spec?.criteria?.find((c) => c.field === "location")?.value,
    b.spec?.criteria?.find((c) => c.field === "location_id")?.value,
    b.spec?.status,
    b.qualified_count,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
