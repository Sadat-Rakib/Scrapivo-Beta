import "../../scripts/_env.mts";
import { writeFile } from "node:fs/promises";
import { extractFrameLLM } from "../../src/lib/understanding/extract.server";
import { validateFrame } from "../../src/lib/understanding/validate";
import { syncClarification } from "../../src/lib/understanding/clarify-state";
import { frameToSearchSpec } from "../../src/lib/understanding/to-search-spec";
import { decideSpecClarification } from "../../src/lib/search/spec-clarification";

const queries = [
  "Find me D2C skincare brands in Dhaka, Bangladesh that are doing marketing and active online. Give me websites, phone numbers, emails and socials, and check when they last posted.",
  "yo d2c skincare guys arnd Dhaka who r active online, nums n socials pls",
  "Find businesses in Camrose, Alberta with no website and active Facebook pages",
  "Find plumbers in Austin",
  "I sell SEO. Find restaurants in Porto that could use SEO help",
  "Research only: restaurants in Lusaka with websites",
  "Remote React jobs paying this much",
  "Companies around this size in Pune with public contacts",
  "D2C brands in Chattogram or Dhaka, not agencies, selling skincare",
  "Startups in Cluj-Napoca or Tbilisi, exclude staffing agencies",
  "Find companies that are NOT already funded",
  "Find businesses that need website services, with email and phone",
  "Find local businesses in Alberta without websites",
  "Find founders of SaaS companies in Southeast Asia who recently raised",
  "Find pre-seed AI investors in Singapore actively writing checks",
  "Find people hiring marketing managers in Calgary",
  "Find companies for partnership opportunities in Nairobi",
];

const rows: unknown[] = [];
for (const query of queries) {
  const outcome = await extractFrameLLM(query, { bypassCache: true, waitForSlotMs: 250 });
  const validated = validateFrame(outcome.frame);
  const frame = syncClarification(validated.frame);
  const spec = frameToSearchSpec(frame);
  const question = decideSpecClarification(spec);
  rows.push({
    query,
    provider: frame.meta.provider,
    model: frame.meta.model,
    fallback: frame.meta.fallback_used,
    error: outcome.error,
    rawSemanticResult: outcome.rawResponse,
    validationRepairs: validated.repairs,
    frame,
    spec,
    decision: question ? { type: "clarify", question } : { type: "act" },
  });
  await writeFile("reports/mvp-implementation/LIVE_PROVIDER_RESULTS.json", JSON.stringify(rows, null, 2));
}
console.log(JSON.stringify({ total: rows.length, provider: rows.filter((item) => !(item as {fallback:boolean}).fallback).length,
  fallback: rows.filter((item) => (item as {fallback:boolean}).fallback).length }));
