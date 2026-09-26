/**
 * Provider canary — does this model understand the sentence at all?
 *
 * Six deliberately varied requests, run against each candidate model on the
 * REAL understanding prompt, printed side by side. It exists because
 * `ai:probe` answers a smaller question: probe asks whether a model can hold a
 * three-field schema, which is a fact about JSON, and a model can pass that and
 * still reverse every direction it is shown.
 *
 * This is a screen, not a certification. Its job is to keep a model that
 * reverses "looking for clients" out of the ladder BEFORE the ten-case smoke
 * spends a day's budget on it. Semantic acceptance is manual, on the smoke.
 *
 * Nothing here tunes code. A model that fails is excluded; the extractor is not
 * edited to suit it.
 *
 *   npx tsx scripts/understanding-canary.mts --models groq:openai/gpt-oss-20b,nararouter:agnes-3-flash
 */

import "./_env.mts";

import { parseRef, type ModelRef } from "../src/lib/ai/providers";
import { extractFrameLLM, UNDERSTANDING_PROMPT_VERSION } from "../src/lib/understanding/extract.server";
import { validateFrame } from "../src/lib/understanding/validate";
import type { UnderstandingFrame } from "../src/lib/understanding/frame";

/**
 * One per semantic family the deterministic engine had to be taught, chosen so
 * that a wrong answer is wrong in a legible way rather than merely different.
 *
 * `want` is what a human reading the sentence would say. It is compared
 * loosely and only to make the table readable — the verdict a person gives
 * after reading the row is the one that counts.
 */
type Canary = {
  id: string;
  prompt: string;
  /** The single fact this case exists to test. */
  want: (f: UnderstandingFrame) => boolean;
  wants: string;
};

const CANARIES: Canary[] = [
  {
    id: "plain",
    prompt: "kebab shops in Trabzon",
    wants: "relation=none · no clarification",
    want: (f) => f.relation.type.value === "none" && !f.clarification.needed,
  },
  {
    id: "offers",
    prompt: "freelance motion designers in Rosario looking for clients",
    wants: "target=person · relation=seeking_client (NOT needs_service)",
    want: (f) =>
      f.target.entity_type.value === "person" &&
      ["seeking_client", "offers_service"].includes(f.relation.type.value),
  },
  {
    id: "needs",
    prompt: "manufacturers around Bielsko-Biala that need warehouse automation",
    wants: "target=company · relation=needs_service · object=warehouse automation",
    want: (f) =>
      f.relation.type.value === "needs_service" &&
      /automation/i.test(f.relation.object?.value ?? ""),
  },
  {
    id: "hiring",
    prompt: "clinics in Kaunas hiring dental hygienists",
    wants: "target=organization/company · relation=hiring · object=dental hygienist",
    want: (f) =>
      f.relation.type.value === "hiring" && /hygien/i.test(f.relation.object?.value ?? ""),
  },
  {
    id: "lacks",
    prompt: "granite countertop installers in Sibiu with no website",
    wants: "relation=lacks_asset · object=website · location stops at Sibiu",
    want: (f) =>
      f.relation.type.value === "lacks_asset" &&
      /website|site/i.test(f.relation.object?.value ?? "") &&
      !/website/i.test(f.location?.raw ?? ""),
  },
  {
    id: "messy",
    prompt:
      "yo need like 40ish smol saas cos in tallinn that raised pre-seed last yr, gotta have founder email, no agencies plz, csv",
    wants: "quantity 40 · temporal last year · negation agencies · required email · csv",
    want: (f) =>
      (f.quantity?.requested ?? 0) >= 30 &&
      f.temporal !== null &&
      f.constraints.some((c) => c.negated) &&
      f.required_fields.length > 0,
  },
];

// ── CLI ───────────────────────────────────────────────────────────────────

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : dflt;
}

const MODELS = arg("models", "")
  .split(",")
  .map((s) => parseRef(s.trim()))
  .filter((r): r is ModelRef => r !== null);

/** Between calls. The free tiers meter per MINUTE, and a canary that trips a
 *  breaker measures the breaker. */
const PACE_MS = Number.parseInt(arg("pace", "6000"), 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  model: string;
  canary: string;
  ok: boolean | null; // null = never reached the model
  latencyMs: number;
  detail: string;
  note: string;
};

function summarize(f: UnderstandingFrame): string {
  const t = [f.target.entity_type.value, f.target.role?.value, f.target.category?.value]
    .filter(Boolean)
    .join("/");
  const rel = f.relation.type.value;
  const obj = f.relation.object?.value ?? "—";
  const loc = f.location?.value ?? f.location?.raw ?? "—";
  const q = f.quantity?.requested ?? f.quantity?.minimum ?? null;
  return `${t} · ${rel}→${obj} · @${loc}${q ? ` · n=${q}` : ""}${
    f.clarification.needed ? ` · ASK(${f.clarification.reason ?? "?"})` : ""
  }`;
}

async function main(): Promise<void> {
  if (MODELS.length === 0) {
    console.log("Pass --models gateway:model[,gateway:model]. Run `npm run ai:probe` first.");
    return;
  }

  console.log(
    `Understanding canary · prompt=${UNDERSTANDING_PROMPT_VERSION} · ${CANARIES.length} cases × ${MODELS.length} models\n`,
  );

  const rows: Row[] = [];
  for (const ref of MODELS) {
    const id = `${ref.gateway}:${ref.model}`;
    console.log(`--- ${id}`);
    for (const c of CANARIES) {
      await sleep(PACE_MS);
      const out = await extractFrameLLM(c.prompt, {
        bypassCache: true,
        waitForSlotMs: 20_000,
        pin: { gateway: ref.gateway, model: ref.model },
      });
      // A fallback frame is the keyword extractor's answer, not this model's.
      // Scoring it would credit or blame the wrong engine.
      if (out.frame.meta.fallback_used) {
        rows.push({
          model: id,
          canary: c.id,
          ok: null,
          latencyMs: out.frame.meta.latency_ms,
          detail: "—",
          note: (out.error ?? "no model answer").slice(0, 90),
        });
        console.log(`  ${c.id.padEnd(7)} —      (no model answer) ${(out.error ?? "").slice(0, 70)}`);
        continue;
      }
      const { frame } = validateFrame(out.frame);
      const ok = c.want(frame);
      rows.push({
        model: id,
        canary: c.id,
        ok,
        latencyMs: frame.meta.latency_ms,
        detail: summarize(frame),
        note: "",
      });
      console.log(
        `  ${c.id.padEnd(7)} ${ok ? "ok  " : "MISS"}  ${String(frame.meta.latency_ms).padStart(6)} ms  ${summarize(frame)}`,
      );
      if (!ok) console.log(`          want: ${c.wants}`);
    }
    console.log("");
  }

  console.log("=== SUMMARY ===\n");
  console.log(`${"model".padEnd(40)} ${"screen".padEnd(8)} ${"unanswered".padEnd(11)} p50`);
  for (const ref of MODELS) {
    const id = `${ref.gateway}:${ref.model}`;
    const mine = rows.filter((r) => r.model === id);
    const answered = mine.filter((r) => r.ok !== null);
    const times = answered.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)] ?? 0;
    console.log(
      `${id.padEnd(40)} ${`${answered.filter((r) => r.ok).length}/${answered.length}`.padEnd(8)} ${String(
        mine.length - answered.length,
      ).padEnd(11)} ${p50} ms`,
    );
  }
  console.log(
    "\nThe screen is a filter, not a verdict. A model that passes here is eligible",
  );
  console.log("for the ten-case smoke, which is read by hand.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
