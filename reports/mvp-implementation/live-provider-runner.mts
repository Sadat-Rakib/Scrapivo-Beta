/** Bounded local live-provider verification; never credits deterministic fallback. */
import "../../scripts/_env.mts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { understandingLadder, isConfigured } from "../../src/lib/ai/providers";
import { extractFrameLLM, UNDERSTANDING_PROMPT_VERSION } from "../../src/lib/understanding/extract.server";
import { validateFrame } from "../../src/lib/understanding/validate";
import { frameToSearchSpec } from "../../src/lib/understanding/to-search-spec";
import { decideSpecClarification } from "../../src/lib/search/spec-clarification";

const cases = [
  { id: "dhaka_d2c_long", prompt: "I sell marketing services. Find D2C skincare brands in Dhaka or elsewhere in Bangladesh that are actively growing, need help with marketing, and have posted on social media recently. Give me their website, email, phone, social profiles, and when they last posted. I want prospects to pitch, not agencies." },
  { id: "messy_typo", prompt: "hey uh need resturants aroudn Porto maybe ones needin better websites, im selling web design pls find me some" },
  { id: "uncommon_location", prompt: "Find independent dental clinics in Bandar Seri Begawan for market research." },
  { id: "goal_absent", prompt: "Find plumbers in Austin." },
  { id: "goal_explicit", prompt: "I sell SEO. Find restaurants in Porto that could use SEO help." },
  { id: "salary_placeholder_job", prompt: "Find remote React jobs paying this much." },
  { id: "size_placeholder", prompt: "Find B2B software companies around this size in Alberta for partnership research." },
  { id: "negated_agency", prompt: "Find D2C skincare companies in Dhaka, not agencies, to pitch marketing services." },
  { id: "negated_funding", prompt: "Find climate startups in Oslo that are NOT already funded for an angel investor." },
  { id: "or_locations_asia", prompt: "Find logistics companies in Chattogram or Dhaka for partnership sourcing." },
  { id: "or_locations_europe", prompt: "Find software founders in Cluj-Napoca or Tbilisi for investor outreach." },
  { id: "contacts_requested", prompt: "Research local accountants in Camrose and return each firm's website, public email, phone number, and LinkedIn page." },
  { id: "social_freshness", prompt: "Find active fitness brands in Southeast Asia and check when they last posted on Instagram." },
  { id: "investors", prompt: "Find investors actively backing pre-seed climate software companies in Europe, with public contact details." },
  { id: "people_founders", prompt: "Find founders of bootstrapped healthcare software companies in Toronto who are hiring designers." },
  { id: "website_service_vs_absence", prompt: "Find local businesses in Alberta that need website services so I can offer design help; they may already have a website." },
  { id: "numeric_salary_job", prompt: "Find remote senior React jobs paying at least $120,000 a year, and return the employer site and application link." },
] as const;

const outputPath = join(process.cwd(), "reports", "mvp-implementation", "LIVE_PROVIDER_RESULTS.json");
const configured = [
  ...understandingLadder(),
  { gateway: "groq", model: "openai/gpt-oss-20b" },
].filter((ref) => isConfigured(ref.gateway));
if (!configured.length) throw new Error("No configured understanding provider");
const pinArg = process.argv.indexOf("--pin");
const requestedPin = pinArg >= 0 ? process.argv[pinArg + 1] : null;
const selected = requestedPin
  ? configured.find((ref) => `${ref.gateway}:${ref.model}` === requestedPin)
  : configured[0];
if (!selected) throw new Error("Requested understanding provider is not configured");
const paceArg = process.argv.indexOf("--pace");
const limitArg = process.argv.indexOf("--limit");
const paceMs = paceArg >= 0 ? Number(process.argv[paceArg + 1]) : 30_000;
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : cases.length;
if (!Number.isFinite(paceMs) || paceMs < 0 || !Number.isFinite(limit) || limit < 1) {
  throw new Error("Invalid pace or limit");
}

type RecordedCase = {
  id: string;
  prompt: string;
  status: "live" | "fallback_rejected" | "error";
  provider: string | null;
  model: string | null;
  rawResponse: string | null;
  rawFrame: unknown | null;
  extractionError: string | null;
  validationRepairs: unknown[];
  validationViolations: unknown[];
  finalFrame: unknown | null;
  searchSpec: unknown | null;
  decision: { kind: "clarify" | "act"; question?: unknown } | null;
  usage: unknown | null;
  latencyMs: number | null;
};

type Report = {
  purpose: string;
  promptVersion: string;
  selectedProvider: string;
  selectedModel: string;
  startedAt: string;
  updatedAt: string;
  previousProviderProbe?: { provider: string; model: string; status: string };
  cases: RecordedCase[];
};

let report: Report;
try {
  report = JSON.parse(readFileSync(outputPath, "utf8")) as Report;
  if (report.selectedProvider !== selected.gateway || report.selectedModel !== selected.model) {
    if (report.cases.some((row) => row.status === "live")) {
      throw new Error("Existing live report uses a different pinned model");
    }
    const previousProviderProbe = {
      provider: report.selectedProvider,
      model: report.selectedModel,
      status: report.cases[0]?.status ?? "unavailable",
    };
    report = {
      purpose: "Real provider path; deterministic fallback is rejected, never counted as LLM output.",
      promptVersion: UNDERSTANDING_PROMPT_VERSION,
      selectedProvider: selected.gateway,
      selectedModel: selected.model,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      previousProviderProbe,
      cases: [],
    };
  }
} catch (error) {
  if (error instanceof Error && error.message.includes("different pinned model")) throw error;
  report = {
    purpose: "Real provider path; deterministic fallback is rejected, never counted as LLM output.",
    promptVersion: UNDERSTANDING_PROMPT_VERSION,
    selectedProvider: selected.gateway,
    selectedModel: selected.model,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cases: [],
  };
}

function save(): void {
  report.updatedAt = new Date().toISOString();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

console.log(`Pinned ${selected.gateway}:${selected.model}; ${cases.length} cases; ${paceMs}ms minimum spacing`);
let previousStart = 0;
for (const testCase of cases.slice(0, limit)) {
  if (report.cases.some((row) => row.id === testCase.id && row.status === "live")) continue;
  const wait = Math.max(0, paceMs - (Date.now() - previousStart));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  previousStart = Date.now();
  try {
    const extracted = await extractFrameLLM(testCase.prompt, {
      bypassCache: true,
      waitForSlotMs: 20_000,
      pin: { gateway: selected.gateway, model: selected.model },
    });
    const live = !extracted.frame.meta.fallback_used && extracted.frame.meta.extractor === "llm";
    const checked = live ? validateFrame(extracted.frame) : null;
    const spec = checked ? frameToSearchSpec(checked.frame) : null;
    const question = spec ? decideSpecClarification(spec) : null;
    const row: RecordedCase = {
      id: testCase.id,
      prompt: testCase.prompt,
      status: live ? "live" : "fallback_rejected",
      provider: live ? extracted.frame.meta.provider ?? selected.gateway : null,
      model: live ? extracted.frame.meta.model ?? selected.model : null,
      rawResponse: extracted.rawResponse,
      rawFrame: live ? extracted.frame : null,
      extractionError: extracted.error,
      validationRepairs: checked?.repairs ?? [],
      validationViolations: checked?.violations ?? [],
      finalFrame: checked?.frame ?? null,
      searchSpec: spec,
      decision: spec ? question ? { kind: "clarify", question } : { kind: "act" } : null,
      usage: extracted.usage,
      latencyMs: extracted.frame.meta.latency_ms,
    };
    report.cases = report.cases.filter((existing) => existing.id !== testCase.id);
    report.cases.push(row);
    save();
    console.log(`${testCase.id}: ${row.status}${live ? ` ${row.provider}:${row.model} ${row.decision?.kind}` : ""}`);
  } catch (error) {
    report.cases = report.cases.filter((existing) => existing.id !== testCase.id);
    report.cases.push({
      id: testCase.id, prompt: testCase.prompt, status: "error", provider: null, model: null,
      rawResponse: null, rawFrame: null,
      extractionError: error instanceof Error ? error.name : "unknown error",
      validationRepairs: [], validationViolations: [], finalFrame: null,
      searchSpec: null, decision: null, usage: null, latencyMs: null,
    });
    save();
    console.log(`${testCase.id}: error`);
  }
}
console.log(`Saved ${report.cases.length}/${cases.length} cases to ${outputPath}`);
