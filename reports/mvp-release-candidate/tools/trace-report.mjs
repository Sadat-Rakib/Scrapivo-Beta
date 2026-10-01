// Render BROWSER_TRACE.md tables from BROWSER_TRACE_*.json files.
// usage: node reports/mvp-release-candidate/tools/trace-report.mjs <out.md> <trace.json...>
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...files] = process.argv.slice(2);
const cell = (value) => String(value ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 110);
const lines = [];
for (const file of files) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  lines.push(`### ${j.which} / ${j.mode} — ${cell(j.query)}`, "");
  lines.push(`Duration ${Math.round(j.durationMs / 1000)}s · pages ${j.pages.length} · remembered ${j.remember.filter((r) => r.outcome === "accepted").length} · streamed ${j.streamedRows.length} · final rows ${j.result?.rowsReturned ?? "n/a"} · outcome ${j.result?.outcome ?? "n/a"}`, "");
  lines.push("Searches: " + (j.searches.map((s) => `${s.via}:${s.status}(${s.results})`).join(", ") || "none"), "");
  if (j.pages.length) {
    lines.push("| # | Origin | URL | Page type | Target | Observed | Candidate? | Why not |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    j.pages.forEach((p, i) => lines.push(`| ${i + 1} | ${p.origin} | ${cell(p.url)} | ${cell(p.pageType ?? p.outcome)} | ${j.result?.entity ?? (j.which === "founders" ? "person" : "business")} | ${p.outcome}, ${p.textChars} chars${p.structured ? `, jsonld org=${cell(p.structured.organization)}` : ""} | ${p.candidateProduced}${p.produced.length ? ` (${cell(p.produced.join(", "))})` : ""} | ${cell(p.why)} |`));
    lines.push("");
  }
}
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`wrote ${out}`);
