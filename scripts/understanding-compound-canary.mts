/** One live compound-frame canary. Never prints credentials or headers. */
import "./_env.mts";

import { extractFrameLLM } from "../src/lib/understanding/extract.server";
import { validateFrame } from "../src/lib/understanding/validate";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

const query = arg(
  "query",
  "find dive schools in Brno and also find quilt shops in Dunedin",
);
const provider = arg("provider", "nararouter");
const model = arg("model", "laguna-s-2.1");

const extracted = await extractFrameLLM(query, {
  bypassCache: true,
  waitForSlotMs: 45_000,
  pin: { gateway: provider, model },
});

if (extracted.frame.meta.fallback_used || extracted.frame.meta.extractor !== "llm") {
  console.error("COMPOUND CANARY INVALID: the pinned LLM did not produce the frame");
  process.exitCode = 1;
} else {
  const { frame, violations, repairs } = validateFrame(extracted.frame);
  console.log(
    JSON.stringify(
      {
        provider: frame.meta.provider,
        model: frame.meta.model,
        prompt_version: frame.meta.prompt_version,
        latency_ms: frame.meta.latency_ms,
        fallback_used: frame.meta.fallback_used,
        cached: frame.meta.cached,
        repair_attempts: frame.meta.notes.includes("recovered on reprompt") ? 1 : 0,
        usage: extracted.usage,
        violations,
        repairs,
        frame,
      },
      null,
      2,
    ),
  );
}
