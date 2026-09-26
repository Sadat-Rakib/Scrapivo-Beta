/** Small live canary for the job-seeker / employer / posting boundary. */
import "./_env.mts";

import { extractFrameLLM, UNDERSTANDING_PROMPT_VERSION } from "../src/lib/understanding/extract.server";
import { validateFrame } from "../src/lib/understanding/validate";
import type { UnderstandingFrame } from "../src/lib/understanding/frame";
import { equivalentDuration, isOrganization } from "./understanding-canary-equivalence";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

const provider = arg("provider", "nararouter");
const model = arg("model", "laguna-s-2.1");
const paceMs = Number.parseInt(arg("pace", "6000"), 10);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Canary = {
  id: string;
  prompt: string;
  check: (frame: UnderstandingFrame) => boolean;
  expected: string;
};

const cases: Canary[] = [
  {
    id: "j001",
    prompt: "glassblowers in Liege looking for jobs",
    expected: "person / lead_discovery / seeking_job / job_based",
    check: (f) =>
      f.target.entity_type.value === "person" &&
      f.task_type.value === "lead_discovery" &&
      f.relation.type.value === "seeking_job" &&
      f.prospecting_mode.value === "job_based",
  },
  {
    id: "j002",
    prompt: "companies in Liege hiring glassblowers",
    expected: "company / lead_discovery / hiring / hiring_based",
    check: (f) =>
      isOrganization(f.target.entity_type.value) &&
      f.task_type.value === "lead_discovery" &&
      f.relation.type.value === "hiring" &&
      f.prospecting_mode.value === "hiring_based",
  },
  {
    id: "j003",
    prompt: "glassblower job postings in Liege from the last two weeks",
    expected: "job / job_discovery / none / job_based / within_last 14d",
    check: (f) =>
      f.target.entity_type.value === "job" &&
      f.task_type.value === "job_discovery" &&
      f.relation.type.value === "none" &&
      f.prospecting_mode.value === "job_based" &&
      f.temporal?.relation === "within_last" &&
      equivalentDuration(f.temporal.window, "14d"),
  },
  {
    id: "j004",
    prompt: "manufacturers around Bielsko-Biala that need warehouse automation",
    expected: "company / needs_service / warehouse automation",
    check: (f) =>
      isOrganization(f.target.entity_type.value) &&
      f.relation.type.value === "needs_service" &&
      /warehouse automation/i.test(f.relation.object?.value ?? ""),
  },
];

const results = [];
for (const testCase of cases) {
  if (results.length > 0) await sleep(paceMs);
  const extracted = await extractFrameLLM(testCase.prompt, {
    bypassCache: true,
    waitForSlotMs: 45_000,
    pin: { gateway: provider, model },
  });
  const { frame, violations, repairs } = validateFrame(extracted.frame);
  const llmAnswered = frame.meta.extractor === "llm" && !frame.meta.fallback_used;
  results.push({
    id: testCase.id,
    prompt: testCase.prompt,
    expected: testCase.expected,
    pass: llmAnswered && testCase.check(frame) && !violations.some((v) => v.severity === "error"),
    provider: frame.meta.provider,
    model: frame.meta.model,
    prompt_version: frame.meta.prompt_version,
    latency_ms: frame.meta.latency_ms,
    fallback_used: frame.meta.fallback_used,
    cached: frame.meta.cached,
    repair_attempts: frame.meta.notes.includes("recovered on reprompt") ? 1 : 0,
    usage: extracted.usage,
    error: extracted.error,
    violations,
    repairs,
    frame,
  });
}

const invalid = results.some((r) => !r.pass || r.fallback_used || r.cached);
console.log(
  JSON.stringify(
    {
      canary: "fresh-job-semantics",
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
