/**
 * Fallback certification — may this model stand in for the primary?
 *
 * The canary screen (`understanding-canary.mts`) asks whether a model can read
 * a sentence at all, one sentence at a time. This asks the harder question a
 * fallback has to answer: given TWO requests that differ only in who wants
 * what, does it still tell them apart?
 *
 * That is the failure a per-case screen cannot see. A model that answers
 * `needs_service → clients` to "web designers looking for clients" scores a
 * plausible-looking frame on its own — every field is populated, the JSON is
 * valid, the confidence is high — and is only visibly wrong beside the frame
 * for "businesses looking for web designers", which it gives the same answer
 * to. A collapsed pair means the model is not reading direction; it is matching
 * keywords, and downstream it will search for the wrong population entirely.
 *
 * So the rule here is stricter than the screen's: ONE collapsed pair
 * disqualifies. A missed per-prompt expectation is reported and counted but is
 * not on its own fatal — some of those are wording preferences (offers_service
 * vs seeking_client) where two answers are both defensible.
 *
 * Nothing here tunes code. A model that fails is excluded from the ladder in
 * `src/lib/ai/providers.ts`; the extractor is never edited to suit it.
 *
 *   npx tsx scripts/understanding-fallback-cert.mts --models nararouter:agnes-3-flash
 *   npx tsx scripts/understanding-fallback-cert.mts --models a:b,c:d --pace 8000
 */

import "./_env.mts";

import { parseRef, type ModelRef } from "../src/lib/ai/providers";
import {
  extractFrameLLM,
  UNDERSTANDING_PROMPT_VERSION,
} from "../src/lib/understanding/extract.server";
import { validateFrame } from "../src/lib/understanding/validate";
import type { UnderstandingFrame } from "../src/lib/understanding/frame";

// ── The battery ───────────────────────────────────────────────────────────

type Probe = {
  prompt: string;
  /** What a person reading the sentence would say. */
  wants: string;
  ok: (f: UnderstandingFrame) => boolean;
};

type Pair = {
  id: string;
  /** The one axis the two prompts disagree on. */
  axis: string;
  a: Probe;
  b: Probe;
  /** False when the model gave both sentences the same reading. */
  distinct: (a: UnderstandingFrame, b: UnderstandingFrame) => boolean;
};

const rel = (f: UnderstandingFrame) => f.relation.type.value;
const obj = (f: UnderstandingFrame) => f.relation.object?.value ?? "";
const ent = (f: UnderstandingFrame) => f.target.entity_type.value;
const corporate = (f: UnderstandingFrame) => ["business", "company", "organization"].includes(ent(f));

/**
 * Six pairs, one per way a fallback has been seen to reverse a request. Places
 * are deliberately obscure: a model that has memorised "plumbers in Toronto"
 * tells us nothing about the next user's sentence.
 */
const PAIRS: Pair[] = [
  {
    id: "clients",
    axis: "who is selling — the target or the user",
    a: {
      prompt: "web designers in Piraeus looking for clients",
      wants: "target=person · offers_service/seeking_client (NOT needs_service→clients)",
      ok: (f) => ent(f) === "person" && ["seeking_client", "offers_service"].includes(rel(f)),
    },
    b: {
      prompt: "businesses in Piraeus looking for web designers",
      wants: "target=business · needs_service → web design",
      ok: (f) => corporate(f) && rel(f) === "needs_service" && /web|design/i.test(obj(f)),
    },
    distinct: (a, b) => rel(a) !== rel(b) || ent(a) !== ent(b),
  },
  {
    id: "jobs",
    axis: "who is hiring — the target or the candidate",
    a: {
      prompt: "post houses in Ostrava hiring colourists",
      wants: "relation=hiring → colourist",
      ok: (f) => rel(f) === "hiring" && /colour|color/i.test(obj(f)),
    },
    b: {
      prompt: "colourists in Ostrava looking for studio work",
      wants: "target=person · relation=seeking_job",
      ok: (f) => ent(f) === "person" && rel(f) === "seeking_job",
    },
    distinct: (a, b) => rel(a) !== rel(b),
  },
  {
    id: "service",
    axis: "offering a service vs needing one",
    a: {
      prompt: "IT firms in Tarija that offer managed backups",
      wants: "relation=offers_service → managed backups",
      ok: (f) => rel(f) === "offers_service" && /backup/i.test(obj(f)),
    },
    b: {
      prompt: "clinics in Tarija that need managed backups",
      wants: "relation=needs_service → managed backups",
      ok: (f) => rel(f) === "needs_service" && /backup/i.test(obj(f)),
    },
    distinct: (a, b) => rel(a) !== rel(b),
  },
  {
    id: "capital",
    axis: "who has the money",
    a: {
      prompt: "investors funding kelp farming startups",
      wants: "target=investor · investing_in → kelp farming · investment_based",
      ok: (f) => ent(f) === "investor" && rel(f) === "investing_in" && /kelp/i.test(obj(f)),
    },
    b: {
      prompt: "kelp farming startups seeking investors",
      wants: "target=business/company · seeking_funding · funding_based",
      ok: (f) => corporate(f) && ["seeking_funding", "custom"].includes(rel(f)),
    },
    distinct: (a, b) => ent(a) !== ent(b),
  },
  {
    id: "absence",
    axis: "an absence is a relation, and never a place",
    a: {
      prompt: "granite fabricators around Sibiu with no website",
      wants: "lacks_asset → website · location stays Sibiu",
      ok: (f) =>
        rel(f) === "lacks_asset" &&
        /website|site/i.test(obj(f)) &&
        !/website/i.test(f.location?.raw ?? ""),
    },
    b: {
      prompt: "granite fabricators around Sibiu",
      wants: "relation=none · no clarification",
      ok: (f) => rel(f) === "none" && !f.clarification.needed,
    },
    distinct: (a, b) => rel(a) !== rel(b),
  },
  {
    id: "context",
    axis: "what the USER sells is not what the target needs",
    a: {
      prompt: "I sell drone surveying. Find quarries near Jaen.",
      wants: "user_context.selling ~ drone · relation=none (the quarries stated no need)",
      ok: (f) => {
        const sells = [
          f.user_context.selling?.service?.value,
          f.user_context.selling?.product?.value,
        ]
          .filter(Boolean)
          .join(" ");
        return /drone|survey/i.test(sells) && rel(f) === "none";
      },
    },
    b: {
      prompt: "quarries near Jaen that need drone surveying",
      wants: "needs_service → drone surveying",
      ok: (f) => rel(f) === "needs_service" && /drone|survey/i.test(obj(f)),
    },
    distinct: (a, b) => rel(a) !== rel(b),
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

/** Between calls. Free tiers meter per minute, and a run that trips a breaker
 *  measures the breaker rather than the model. */
const PACE_MS = Number.parseInt(arg("pace", "6000"), 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarize(f: UnderstandingFrame): string {
  const t = [ent(f), f.target.role?.value, f.target.category?.value].filter(Boolean).join("/");
  const loc = f.location?.value ?? f.location?.raw ?? "—";
  return `${t} · ${f.prospecting_mode.value} · ${rel(f)}→${obj(f) || "—"} · @${loc}${
    f.clarification.needed ? ` · ASK(${f.clarification.reason ?? "?"})` : ""
  }`;
}

type Answer = { frame: UnderstandingFrame | null; latencyMs: number; why: string };

async function ask(prompt: string, ref: ModelRef): Promise<Answer> {
  await sleep(PACE_MS);
  const out = await extractFrameLLM(prompt, {
    bypassCache: true,
    waitForSlotMs: 20_000,
    pin: { gateway: ref.gateway, model: ref.model },
  });
  // A fallback frame is the keyword extractor's answer. Scoring it would
  // certify the wrong engine — and certifying a model on a frame it never
  // produced is the exact failure `--require-llm` exists to prevent.
  if (out.frame.meta.fallback_used) {
    return {
      frame: null,
      latencyMs: out.frame.meta.latency_ms,
      why: (out.error ?? "no model answer").slice(0, 100),
    };
  }
  return { frame: validateFrame(out.frame).frame, latencyMs: out.frame.meta.latency_ms, why: "" };
}

async function main(): Promise<void> {
  if (MODELS.length === 0) {
    console.log("Pass --models gateway:model[,gateway:model]. Run `npm run ai:probe` first.\n");
    console.log("The current ladder's rungs below the primary are the candidates.");
    return;
  }

  console.log(
    `Fallback certification · prompt=${UNDERSTANDING_PROMPT_VERSION} · ${PAIRS.length} pairs (${
      PAIRS.length * 2
    } calls) × ${MODELS.length} models\n`,
  );

  const verdicts: {
    model: string;
    collapsed: string[];
    missed: string[];
    unanswered: number;
    p50: number;
  }[] = [];

  for (const ref of MODELS) {
    const id = `${ref.gateway}:${ref.model}`;
    console.log(`=== ${id}`);
    const collapsed: string[] = [];
    const missed: string[] = [];
    const times: number[] = [];
    let unanswered = 0;

    for (const p of PAIRS) {
      const [A, B] = [await ask(p.a.prompt, ref), await ask(p.b.prompt, ref)];
      for (const [probe, ans] of [
        [p.a, A],
        [p.b, B],
      ] as const) {
        if (!ans.frame) {
          unanswered++;
          console.log(`  ${p.id.padEnd(8)} —     "${probe.prompt}"  (${ans.why})`);
          continue;
        }
        times.push(ans.latencyMs);
        const ok = probe.ok(ans.frame);
        if (!ok) missed.push(`${p.id}: "${probe.prompt}" — want ${probe.wants}`);
        console.log(
          `  ${p.id.padEnd(8)} ${ok ? "ok  " : "MISS"} ${String(ans.latencyMs).padStart(6)} ms  ${summarize(
            ans.frame,
          )}`,
        );
      }
      if (A.frame && B.frame && !p.distinct(A.frame, B.frame)) {
        collapsed.push(`${p.id} (${p.axis})`);
        console.log(`  ${p.id.padEnd(8)} COLLAPSED — both sentences read the same way`);
      }
    }

    times.sort((x, y) => x - y);
    verdicts.push({
      model: id,
      collapsed,
      missed,
      unanswered,
      p50: times[Math.floor(times.length / 2)] ?? 0,
    });
    console.log("");
  }

  console.log("=== SUMMARY ===\n");
  console.log(`${"model".padEnd(38)} ${"pairs".padEnd(7)} ${"probes".padEnd(8)} ${"unans".padEnd(6)} p50`);
  for (const v of verdicts) {
    const probes = PAIRS.length * 2 - v.unanswered;
    console.log(
      `${v.model.padEnd(38)} ${`${PAIRS.length - v.collapsed.length}/${PAIRS.length}`.padEnd(7)} ${`${
        probes - v.missed.length
      }/${probes}`.padEnd(8)} ${String(v.unanswered).padEnd(6)} ${v.p50} ms`,
    );
  }

  console.log("");
  for (const v of verdicts) {
    // The word is a recommendation. A model reaching no rung of its gateway
    // answered nothing, and "nothing collapsed" is then vacuously true — which
    // is why an unanswered battery is reported as unmeasured, not as a pass.
    const measured = PAIRS.length * 2 - v.unanswered;
    const verdict =
      measured === 0
        ? "UNMEASURED — the model never answered"
        : v.collapsed.length > 0
          ? `REJECT — collapsed ${v.collapsed.length} pair(s)`
          : v.unanswered > 0
            ? "PARTIAL — no pair collapsed, but some calls went unanswered"
            : "ELIGIBLE — no pair collapsed";
    console.log(`${v.model}: ${verdict}`);
    for (const c of v.collapsed) console.log(`   collapsed: ${c}`);
    for (const m of v.missed) console.log(`   missed:    ${m}`);
  }

  console.log("\nA collapsed pair is disqualifying. A missed probe is a reading to check by");
  console.log("hand — some are defensible wording differences, and this script does not vote.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
