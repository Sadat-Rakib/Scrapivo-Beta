import { extractFrameDeterministic, takeObject } from "../src/lib/understanding/fallback";

const t = "| that offer no marketing services";
console.log("obj@13", JSON.stringify(takeObject(t, 13)));
console.log("obj@16", JSON.stringify(takeObject(t, 16)));
console.log(t.slice(13), "|", t.slice(16));

const q = process.argv[2] ?? "companies that offer no marketing services";
const f = extractFrameDeterministic(q);
console.log(JSON.stringify({ relation: f.relation, constraints: f.constraints, notes: f.meta.notes }, null, 1));
