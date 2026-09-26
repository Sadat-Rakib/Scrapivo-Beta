/** One-off audit: matrix ISO coverage across the understanding maps. */
import fs from "node:fs";
import { COUNTRY_ISO } from "@/lib/search/search-spec-extract";
import { GEO_ALIAS } from "@/lib/search/location-resolver";

const keys = Object.keys(COUNTRY_ISO);
console.log("COUNTRY_ISO keys:", keys.length);
console.log(
  "short keys:",
  keys.filter((k) => k.length <= 3),
);
const mat = JSON.parse(fs.readFileSync("data/coverage-matrix.json", "utf-8"));
const isos = new Set<string>();
for (const e of Object.values(mat.entities) as Array<{
  hotIndexByIso?: Record<string, number>;
  byGeo?: Record<string, unknown>;
}>) {
  for (const k of Object.keys(e.hotIndexByIso ?? {})) isos.add(k);
  for (const k of Object.keys(e.byGeo ?? {}))
    if (/^[A-Z]{2}$/.test(k)) isos.add(k);
}
const vals = new Set(Object.values(COUNTRY_ISO).flat().map((v) => v.toUpperCase()));
const missingVals = [...isos].filter((i) => !vals.has(i)).sort();
console.log("matrix ISOs:", isos.size, "missing from COUNTRY_ISO values:", missingVals);
const noName = [...isos].filter((iso) => {
  const names = keys.filter((k) => COUNTRY_ISO[k].map((v) => v.toUpperCase()).includes(iso));
  const aliasHit = Object.entries(GEO_ALIAS).some(
    ([, v]) => v.toUpperCase() === iso,
  );
  return names.length === 0 && !aliasHit;
});
console.log("ISOs with no name key anywhere:", (noName as string[]).sort());
