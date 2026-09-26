import fs from "fs";

const lines = fs
  .readFileSync("tmp/phase1-verification-traces.jsonl", "utf8")
  .trim()
  .split(/\n/)
  .map((l) => JSON.parse(l) as Record<string, unknown>);

for (const r of lines) {
  if (r.kind !== "runtime") continue;
  const samples = (r.sample_rows as Array<Record<string, unknown>>) ?? [];
  console.log("\n====", r.id, r.query, "====");
  console.log(
    JSON.stringify(
      {
        ms: r.ms,
        parsed: r.parsed,
        after_answers: r.after_answers,
        engines: r.engines,
        live_discovery: r.live_discovery,
        final_rows: r.final_rows,
        live_rows_in_page: r.live_rows_in_page,
        directory_rows_without_evidence: r.directory_rows_without_evidence,
        why_classes: r.why_classes,
        adversarial_notes: r.adversarial_notes,
        free_first: r.free_first,
        persist: r.persist,
        social_meta: r.social_meta,
        sample_count: samples.length,
      },
      null,
      2,
    ),
  );
  for (const s of samples.slice(0, 5)) {
    console.log(
      " SAMPLE",
      JSON.stringify({
        title: s.title,
        why: s.why_match,
        why_class: s.why_class,
        disp: s.disposition,
        vs: s.verification_status,
        rel: s.relevance_score,
        int: s.intent_score,
        et: s.evidence_types,
        ex: s.evidence_excerpts,
        url: s.url,
        key: s.key,
      }),
    );
  }
}
