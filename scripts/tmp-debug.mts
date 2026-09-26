import { extractFrameDeterministic } from "../src/lib/understanding/fallback";

const CASES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "companies that provide recruiting",
      "agencies that are not hiring",
      "engineers not looking for work",
      "companies that offer no marketing services",
      "software companies with at least 100 employees, not agencies",
      "plumbers within 30 miles of Manchester with more than 4 stars",
      "freelance agronomists under $90/hour, excluding Waterford",
      "mushroom farms within 30 miles of Arequipa",
      "remote rust job postings from the last 30 days",
      "companies that posted a arborist role in the last 2 months",
      "people in london",
      "heads of talent at fintech companies",
      "brand strategists in Enschede looking for work",
      "Give me 50 restaurants in Lisbon, phone number required, Instagram if possible, verified as currently open, as a CSV",
      "companies in mombasa hirng orthodontists today",
      "who around tromso needs someone for grant writinng asap",
      "any quilt shops near swansea no prroper website n got phone?",
      "find me 20 saunas outside aarhus, not chains, insta if possible rn",
      "need some foundders round wtaerford tryna bring on tax barrister ppl rn",
      "ok so i do iso certificaiton n im tryna find like sailmakers aound kosice that dont got a site, phone would b great, thx",
      "gimme bell foundries kumasi pls ??",
      "hydroponic farms in Split who need a localisation manager as many as u can",
      "investosr fnuding space startups in saskatoon",
      "find me B2B SaaS founders on LinkedIn who mentioned hiring this month",
    ];

const out: string[] = [];
for (const q of CASES) {
  const f = extractFrameDeterministic(q);
  out.push(`\n=== ${q}`);
  out.push(
    `  mode=${f.prospecting_mode.value} entity=${f.target.entity_type.value} cat=${f.target.category?.value ?? "-"} role=${f.target.role?.value ?? "-"} ind=${f.target.industry?.value ?? "-"} biz=${f.target.business_type?.value ?? "-"}`,
  );
  out.push(
    `  relation=${f.relation.type.value}${f.relation.label ? `(${f.relation.label})` : ""} obj=${f.relation.object?.value ?? "-"} raw="${f.relation.type.raw ?? "-"}"`,
  );
  out.push(
    `  loc=${f.location?.value ?? "-"} raw="${f.location?.raw ?? "-"}" scope=${f.location?.scope ?? "-"} radius=${f.location?.radius ?? "-"}${f.location?.radius_unit ?? ""}`,
  );
  out.push(`  temporal=${f.temporal ? JSON.stringify(f.temporal) : "-"}`);
  out.push(`  qty=${f.quantity ? JSON.stringify(f.quantity) : "-"}`);
  out.push(
    `  constraints=${f.constraints.length ? f.constraints.map((c) => `${c.negated ? "!" : ""}${c.field}${c.operator}${JSON.stringify(c.value)}${c.unit ?? ""}`).join(" ; ") : "-"}`,
  );
  out.push(
    `  req=${f.required_fields.map((x) => x.value).join(",") || "-"} pref=${f.preferred_fields.map((x) => x.value).join(",") || "-"} verify=${f.verification.map((v) => v.kind).join(",") || "-"} out=${f.output.map((o) => o.kind).join(",") || "-"}`,
  );
  out.push(
    `  user=${f.user_context?.selling?.service?.value ?? f.user_context?.selling?.product?.value ?? "-"} src=${f.source_preferences.map((s) => s.value).join(",") || "-"} evidence=claim:${f.evidence.claim_evidence_required} intent:${f.evidence.intent_signal_required}`,
  );
  out.push(
    `  compound=${f.compound.is_compound} subgoals=${f.compound.subgoals.length} clar=${f.clarification.needed ? `${f.clarification.reason} [${f.clarification.fields.join(",")}]` : "no"}`,
  );
}
console.log(out.join("\n"));
