/**
 * End-to-end static + logic smoke for CRM pipeline + STT fixes.
 *   npx tsx scripts/e2e-crm-stt.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { classifyQuery } from "../src/lib/search/query-classifier.ts";
import {
  buildClarifyingQuestions,
  applyClarifyAnswers,
  isProductClarifyPath,
} from "../src/lib/search/clarifier.ts";
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
} from "../src/lib/leads.functions.ts";
import { isRelevantToQuery, isSalesFamilyCraft } from "../src/lib/validation.ts";

const root = process.cwd();
let pass = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
};

console.log("\n── Files present ────────────────────────────────────────");
const files = [
  "src/components/voice-input-button.tsx",
  "src/components/discover/unified-composer.tsx",
  "src/routes/_authenticated/pipeline.tsx",
  "src/components/app-shell.tsx",
  "src/lib/leads.functions.ts",
  "src/components/lead-detail-panel.tsx",
  "supabase/migrations/20260806010000_crm_pipeline.sql",
  "vercel.json",
];
for (const f of files) {
  check(`exists ${f}`, existsSync(join(root, f)));
}

console.log("\n── STT source contracts ─────────────────────────────────");
{
  const voice = readFileSync(join(root, "src/components/voice-input-button.tsx"), "utf8");
  const composer = readFileSync(join(root, "src/components/discover/unified-composer.tsx"), "utf8");
  const vercel = readFileSync(join(root, "vercel.json"), "utf8");
  check("Web Speech continuous=true", /continuous\s*=\s*true/.test(voice));
  check("Web Speech interimResults=true", /interimResults\s*=\s*true/.test(voice));
  check("restart-on-end while listening", /wantListenRef/.test(voice) && /again\.start\(/.test(voice));
  check("surfaces not-allowed errors", /not-allowed/.test(voice) && /toast\.error/.test(voice));
  check("Whisper singleton cache", /whisperSingleton/.test(voice) && /getWhisper/.test(voice));
  check("does not permanently lock unsupported on permission deny", !/setState\("unsupported"\)/.test(voice) || /NotAllowedError/.test(voice));
  check("composer appends voice text", /value\.trim\(\)\s*\?\s*`\$\{value\.trim\(\)\} \$\{t\}`/.test(composer));
  check("vercel COOP header", /Cross-Origin-Opener-Policy/.test(vercel));
  check("vercel COEP header", /Cross-Origin-Embedder-Policy/.test(vercel));
}

console.log("\n── CRM pipeline contracts ───────────────────────────────");
{
  const shell = readFileSync(join(root, "src/components/app-shell.tsx"), "utf8");
  const pipeline = readFileSync(join(root, "src/routes/_authenticated/pipeline.tsx"), "utf8");
  const leads = readFileSync(join(root, "src/lib/leads.functions.ts"), "utf8");
  const detail = readFileSync(join(root, "src/components/lead-detail-panel.tsx"), "utf8");
  const mig = readFileSync(join(root, "supabase/migrations/20260806010000_crm_pipeline.sql"), "utf8");
  const tree = readFileSync(join(root, "src/routeTree.gen.ts"), "utf8");

  check("nav has Pipeline", /to:\s*"\/pipeline"/.test(shell) && /label:\s*"Pipeline"/.test(shell));
  check("routeTree includes /pipeline", /'\/pipeline'/.test(tree));
  check("pipeline board renders all stages", PIPELINE_STAGES.every((s) => pipeline.includes(s)));
  check("setPipelineStage exported", /export const setPipelineStage/.test(leads));
  check("saveLeadContact exported", /export const saveLeadContact/.test(leads));
  check("listLeadActivity exported", /export const listLeadActivity/.test(leads));
  check("detail panel stage picker", /Pipeline stage/.test(detail) && /stageMut/.test(detail));
  check("detail panel activity strip", /Activity/.test(detail) && /lead-activity/.test(detail));
  check("detail persists contact on resolve", /saveContactFn/.test(detail));
  check("migration adds contact columns", /contact_email/.test(mig) && /contact_name/.test(mig));
  check("migration creates lead_activity", /CREATE TABLE IF NOT EXISTS public\.lead_activity/.test(mig));
  check("all 6 stage labels defined", PIPELINE_STAGES.every((s) => !!PIPELINE_STAGE_LABELS[s]));
}

console.log("\n── Clarifier product vs skill still healthy ─────────────");
{
  const pitch = classifyQuery("I'm selling a SaaS invoicing tool for freelancers");
  check("product pitch is product path", isProductClarifyPath(pitch), pitch.type);
  const pQs = buildClarifyingQuestions(pitch);
  check("product asks signal_focus", pQs.some((q) => q.id === "signal_focus"));
  check("product skips YoE", !pQs.some((q) => q.id === "experience"));
  const pSum = applyClarifyAnswers(pitch, {});
  check("product summary has no YoE", !/years experience/.test(pSum.summary), pSum.summary);

  const skill = classifyQuery("sales");
  check("sales is skill path", !isProductClarifyPath(skill), skill.type);
  const sQs = buildClarifyingQuestions(skill);
  check("skill asks experience", sQs.some((q) => q.id === "experience"));
}

console.log("\n── Lead-gen relevance still healthy ─────────────────────");
{
  const cq = classifyQuery("lead generation services");
  cq.goal = "clients";
  check("lead gen not product", cq.type !== "product", cq.type);
  check("lead gen is sales family", isSalesFamilyCraft(cq.coreSkill, cq.relatedSkills));
  check(
    "rejects Lead Guitarist",
    !isRelevantToQuery(
      { title: "Lead Guitarist Wanted", snippet: "", source: "facebook", platform: "Facebook" } as any,
      cq.coreSkill,
      cq.relatedSkills,
      cq,
    ),
  );
  check(
    "keeps Hiring Lead Generation",
    isRelevantToQuery(
      {
        title: "Hiring Freelance Lead Generation Specialists",
        snippet: "looking to hire",
        source: "freelancer",
        platform: "Freelancer",
      } as any,
      cq.coreSkill,
      cq.relatedSkills,
      cq,
    ),
  );
}

console.log(`\n${pass}/${pass + fails.length} correct`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  " + f);
}
process.exit(fails.length ? 1 : 0);
