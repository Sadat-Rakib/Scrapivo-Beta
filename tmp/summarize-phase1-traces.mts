import fs from "fs";

const lines = fs
  .readFileSync("tmp/phase1-verification-traces.jsonl", "utf8")
  .trim()
  .split(/\n/)
  .map((l) => JSON.parse(l) as Record<string, unknown>);

for (const r of lines) {
  const kind = String(r.kind ?? "");
  if (kind === "meta") {
    console.log("META", JSON.stringify(r));
    continue;
  }
  if (kind === "extract") {
    console.log(
      "EXTRACT",
      r.id,
      `entity=${r.entity}`,
      `sig=${r.signal_required}`,
      `ind=${r.industry}`,
      `opp=${r.opportunity}`,
      `role=${r.requested_role}`,
      `svc=${r.requested_service}`,
      `fund=${r.funding_status}`,
      `prod=${r.requested_product}`,
      `types=${JSON.stringify(r.signal_types)}`,
    );
    continue;
  }
  if (kind === "runtime" || kind === "ag" || kind === "free_first" || kind === "social" || kind === "persist") {
    const samplesRaw = (r.samples ?? r.rows ?? r.qualified ?? []) as Array<Record<string, unknown>>;
    const samples = samplesRaw.slice(0, 3).map((s) => {
      const ev = (s.evidence as Array<{ evidence_type?: string }> | undefined) ?? [];
      return {
        title: s.title,
        why: String(s.why_match ?? "").slice(0, 100),
        et: ev.map((e) => e.evidence_type),
        disp: s.disposition,
        vs: s.verification_status,
        rel: s.relevance_score,
        int: s.intent_score,
        url: String(s.url ?? "").slice(0, 80),
      };
    });
    console.log(
      kind.toUpperCase(),
      r.id ?? r.query,
      `returned=${r.returned ?? samplesRaw.length}`,
      `rejected=${r.rejected ?? "?"}`,
      `ok=${r.ok ?? r.success ?? "?"}`,
      `persist=${JSON.stringify(r.persist ?? r.persist_live ?? r.persistResult ?? null)}`,
      `notes=${JSON.stringify(r.notes ?? r.error ?? r.social ?? null).slice(0, 180)}`,
    );
    if (r.providers || r.provider_logs || r.free_first) {
      console.log(
        "  providers",
        JSON.stringify(r.providers ?? r.provider_logs ?? r.free_first).slice(0, 400),
      );
    }
    if (samples.length) console.log("  samples", JSON.stringify(samples));
    continue;
  }
  console.log(kind, r.id ?? r.query ?? "", JSON.stringify(r).slice(0, 600));
}
