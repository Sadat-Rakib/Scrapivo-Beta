/** Phase 1 debug: why do 26 retrieved Bahrain rows all fail validation? */
import { searchBusinessesDB } from "@/lib/canonical/businesses.server";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";
import { rowSatisfiesSpec } from "@/lib/spec-search.functions";

const spec = extractSearchSpec("hotels in Bahrain");
console.log("spec-location:", JSON.stringify(spec.criteria.filter((c) => c.field === "location")));
const r = await searchBusinessesDB({ category: "hotels", location: "Bahrain", limit: 30 });
console.log("retrieved:", r.rows.length, "engines:", r.meta.engine);
for (const row of r.rows.slice(0, 5)) {
  console.log(
    JSON.stringify({
      name: row.name?.slice(0, 40),
      category: row.category,
      country: row.country,
      locality: row.locality,
      ok: rowSatisfiesSpec(
        { ...spec, entity: "business" },
        {
          kind: "business",
          title: row.name ?? "?",
          detail: "",
          category: row.category,
          location: row.locality,
          country: row.country,
        },
      ),
    }),
  );
}
