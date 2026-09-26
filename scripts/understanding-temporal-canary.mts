/** Tiny live canary for calendar periods versus rolling temporal windows. */
import "./_env.mts";

import { extractFrameLLM, UNDERSTANDING_PROMPT_VERSION } from "../src/lib/understanding/extract.server";
import { validateFrame } from "../src/lib/understanding/validate";

const provider = "nararouter";
const model = "laguna-s-2.1";
const cases = [
  {
    id: "tm01",
    prompt: "paleobotanist job listings in Pecs posted this month",
    relation: "this_month",
    window: null,
  },
  {
    id: "tm02",
    prompt: "cooperatives in Matera funded this quarter",
    relation: "this_quarter",
    window: null,
  },
  {
    id: "tm03",
    prompt: "foundries in Linz hiring metallurgists within the last 45 days",
    relation: "within_last",
    window: "45d",
  },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

for (const testCase of cases) {
  if (results.length) await sleep(6000);
  const extracted = await extractFrameLLM(testCase.prompt, {
    bypassCache: true,
    waitForSlotMs: 45_000,
    pin: { gateway: provider, model },
  });
  const modelTemporal = extracted.frame.temporal
    ? structuredClone(extracted.frame.temporal)
    : null;
  const { frame, violations, repairs } = validateFrame(extracted.frame);
  const llmAnswered = frame.meta.extractor === "llm" && !frame.meta.fallback_used;
  results.push({
    id: testCase.id,
    prompt: testCase.prompt,
    expected: { relation: testCase.relation, window: testCase.window },
    pass:
      llmAnswered &&
      frame.temporal?.relation === testCase.relation &&
      frame.temporal?.window === testCase.window &&
      !violations.some((v) => v.severity === "error"),
    model_temporal_before_validation: modelTemporal,
    fallback_used: frame.meta.fallback_used,
    cached: frame.meta.cached,
    repair_attempts: frame.meta.notes.includes("recovered on reprompt") ? 1 : 0,
    usage: extracted.usage,
    violations,
    repairs,
    frame,
  });
}

const invalid = results.some((result) => !result.pass || result.fallback_used || result.cached);
console.log(
  JSON.stringify(
    {
      canary: "fresh-temporal-granularity",
      provider,
      model,
      prompt_version: UNDERSTANDING_PROMPT_VERSION,
      require_llm: true,
      no_cache: true,
      invalid,
      results,
    },
    null,
    2,
  ),
);
if (invalid) process.exitCode = 1;
