/**
 * Provider and MODEL certification for the understanding path.
 *
 *   npm run ai:probe                    # every configured gateway, default model set
 *   npm run ai:probe -- --gateway kiosapi
 *   npm run ai:probe -- --models kiosapi:llama-3.3-70b,groq:openai/gpt-oss-20b
 *   npm run ai:probe -- --list          # catalogue only, no completions
 *
 * ── What this answers, and what it deliberately does not ──────────────────
 * A gateway answering 200 says nothing about whether the model behind it can
 * hold a schema, so this probe grades MODELS: it asks each one for one tiny
 * JSON object and reports whether what came back parses and carries the right
 * fields. That is the bar for entering the understanding ladder — the full
 * semantic bar (direction, open vocabulary, no invented fields) is the canary
 * run's job, on the real prompt.
 *
 * It uses a ~60-token request on purpose. Spending the 4.1k understanding
 * prompt to discover that a key is wrong would burn a day's free allowance
 * finding out something a sentence establishes.
 *
 * ── Secrets ───────────────────────────────────────────────────────────────
 * Nothing here reads a key except to put it in an Authorization header. The
 * report carries `configured: yes/no`, a host, a status and a latency. No
 * value, no length, no prefix, no fingerprint.
 */
import "./_env.mts";

import {
  GATEWAYS,
  type Gateway,
  type ModelRef,
  authHeaders,
  baseUrlFor,
  classifyFailure,
  describeGateway,
  isConfigured,
  parseRef,
  refId,
  understandingLadder,
} from "../src/lib/ai/providers";

// ── The probe ─────────────────────────────────────────────────────────────

/**
 * Small enough to be free, specific enough to fail a model that cannot follow
 * an instruction. The three fields ask for three different things: a copied
 * string, a chosen enum member, and a boolean — a model that returns prose,
 * invents a fourth key, or answers `"city": "city"` fails one of them.
 */
const PROBE_SYSTEM =
  'You extract structured data. Reply with ONLY a JSON object, no prose, no code fence. Shape: {"city": string, "kind": "cafe"|"dentist"|"other", "plural": boolean}';
const PROBE_USER = 'Extract from: "dentists in Reykjavik"';

type ProbeOutcome = {
  ref: ModelRef;
  status: number | null;
  /** Wall-clock for the one call. Not a benchmark — one sample, cold. */
  latencyMs: number;
  /** Did a 2xx arrive with non-empty content? */
  completion: boolean;
  /** Did that content parse as JSON? */
  json: boolean;
  /** Did the JSON carry the three asked-for fields, correctly typed? */
  schema: boolean;
  usage: { prompt: number | null; completion: number | null } | null;
  /** Whether the gateway accepted `response_format` at all. */
  jsonModeAccepted: boolean | null;
  note: string;
};

/** The three-field check. A model that passes this can be asked for a frame. */
function schemaHolds(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.city !== "string" || !o.city.trim()) return false;
  if (o.kind !== "cafe" && o.kind !== "dentist" && o.kind !== "other") return false;
  if (typeof o.plural !== "boolean") return false;
  // "city": "city" is a model echoing the schema rather than reading the input.
  return o.city.toLowerCase() !== "city";
}

function firstJson(s: string): unknown {
  const cleaned = s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    try {
      return JSON.parse(m[0]);
    } catch {
      return undefined;
    }
  }
}

async function probeModel(ref: ModelRef, useJsonMode: boolean): Promise<ProbeOutcome> {
  const gw = GATEWAYS[ref.gateway];
  const base: ProbeOutcome = {
    ref,
    status: null,
    latencyMs: 0,
    completion: false,
    json: false,
    schema: false,
    usage: null,
    jsonModeAccepted: null,
    note: "",
  };
  const body: Record<string, unknown> = {
    model: ref.model,
    messages: [
      { role: "system", content: PROBE_SYSTEM },
      { role: "user", content: PROBE_USER },
    ],
    temperature: 0,
    max_tokens: 200,
  };
  if (useJsonMode && gw.capabilities.jsonMode) body.response_format = { type: "json_object" };
  if (ref.reasoningEffort && gw.capabilities.reasoningEffort) {
    body.reasoning_effort = ref.reasoningEffort;
  }

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrlFor(gw)}/chat/completions`, {
      method: "POST",
      headers: authHeaders(gw),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    return { ...base, latencyMs: Date.now() - t0, note: `transport: ${(e as Error).message}` };
  }
  const latencyMs = Date.now() - t0;
  const text = await res.text();

  if (!res.ok) {
    const kind = classifyFailure(res.status, text);
    // A gateway that rejects `response_format` reports it as our bad request.
    // Retrying without it is how we learn the capability rather than assume it,
    // and a model that can hold the schema unprompted is still usable.
    if (useJsonMode && kind === "bad_request" && /response_format|json/i.test(text)) {
      const retry = await probeModel(ref, false);
      return { ...retry, jsonModeAccepted: false, note: retry.note || "json mode unsupported" };
    }
    return {
      ...base,
      status: res.status,
      latencyMs,
      jsonModeAccepted: useJsonMode ? null : false,
      note: `${kind}: ${oneLine(text)}`,
    };
  }

  let parsed: { choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, number> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...base, status: res.status, latencyMs, note: `non-JSON envelope: ${oneLine(text)}` };
  }
  const content = parsed.choices?.[0]?.message?.content ?? "";
  const usage = parsed.usage
    ? {
        prompt: parsed.usage.prompt_tokens ?? null,
        completion: parsed.usage.completion_tokens ?? null,
      }
    : null;
  if (!content.trim()) {
    return {
      ...base,
      status: res.status,
      latencyMs,
      usage,
      jsonModeAccepted: useJsonMode ? true : false,
      note: "200 with empty content",
    };
  }
  const value = firstJson(content);
  return {
    status: res.status,
    ref,
    latencyMs,
    completion: true,
    json: value !== undefined,
    schema: schemaHolds(value),
    usage,
    jsonModeAccepted: useJsonMode && GATEWAYS[ref.gateway].capabilities.jsonMode ? true : false,
    note: value === undefined ? `unparseable: ${oneLine(content)}` : "",
  };
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 120);
}

// ── Catalogue ─────────────────────────────────────────────────────────────

/**
 * Some gateways serve a public `/models`; others need the key; others have no
 * such route. A failure here is information, not an error — the probe still
 * works from explicitly named model ids.
 */
async function catalogue(gw: Gateway): Promise<string[] | string> {
  try {
    const res = await fetch(`${baseUrlFor(gw)}/models`, {
      headers: authHeaders(gw),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return `${res.status} ${classifyFailure(res.status, await res.text())}`;
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (j.data ?? []).map((m) => m.id).filter((s): s is string => !!s);
    return ids.length ? ids : "empty catalogue";
  } catch (e) {
    return `unreachable: ${(e as Error).message}`;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/**
 * Candidates when none are named — read off each gateway's own `/v1/models`,
 * restricted to the free tier, because a paid id certifying beautifully is not
 * an option anyone here can afford to route production through.
 *
 * TokenForge has no entry: its `/v1/models` is a 404 and its completion routes
 * demand a `tfk`-scheme bearer that this account's credential is not. See the
 * Gate 1 LLM validation report.
 */
const DEFAULT_CANDIDATES: Record<string, ModelRef[]> = {
  // The four the account's PLAN actually serves. The `*-free` ids in the
  // public catalogue are not among them — they answer
  // `403 Your plan does not include the requested model`, which is an account
  // fact and not a model fact, so probing them teaches nothing twice.
  nararouter: [
    { gateway: "nararouter", model: "agnes-3-flash" },
    { gateway: "nararouter", model: "agnes-2.5-flash" },
    { gateway: "nararouter", model: "laguna-s-2.1" },
    { gateway: "nararouter", model: "stepfun-3.7-flash" },
  ],
  apinex: [
    { gateway: "apinex", model: "free/gemini-3.8-flash" },
    { gateway: "apinex", model: "free/glm-5.3-flash" },
  ],
  kiosapi: [
    { gateway: "kiosapi", model: "google/gemini-2.5-flash" },
    { gateway: "kiosapi", model: "zai/glm-4.7-flash" },
  ],
};

async function main(): Promise<void> {
  const only = flag("gateway");
  const named = flag("models");

  const gatewayIds = Object.keys(GATEWAYS).filter(
    (id) => (!only || id === only) && isConfigured(id),
  );
  const unconfigured = Object.keys(GATEWAYS).filter((id) => (!only || id === only) && !isConfigured(id));

  console.log("=== GATEWAY CONFIGURATION ===\n");
  for (const id of [...gatewayIds, ...unconfigured]) {
    const d = describeGateway(id)!;
    console.log(
      `${d.label.padEnd(14)} ${d.configured ? "configured" : "no key   "}  ${d.protocol.padEnd(18)} ${d.host}`,
    );
  }
  if (gatewayIds.length === 0) {
    console.log("\nNothing configured. Nothing to probe.");
    return;
  }

  console.log("\n=== MODEL CATALOGUE ===\n");
  const catalogues = new Map<string, string[] | string>();
  for (const id of gatewayIds) {
    const c = await catalogue(GATEWAYS[id]);
    catalogues.set(id, c);
    if (typeof c === "string") {
      console.log(`${GATEWAYS[id].label}: ${c}`);
    } else {
      console.log(`${GATEWAYS[id].label}: ${c.length} models`);
      if (has("list")) for (const m of c) console.log(`    ${m}`);
    }
  }
  if (has("list")) return;

  // What to probe: explicitly named pairs win; otherwise each gateway's first
  // default candidate, corrected against its catalogue when we have one.
  let refs: ModelRef[];
  if (named) {
    refs = named
      .split(",")
      .map((s) => parseRef(s.trim()))
      .filter((r): r is ModelRef => r !== null);
  } else {
    refs = [];
    for (const id of gatewayIds) {
      const cands = DEFAULT_CANDIDATES[id] ?? understandingLadder().filter((r) => r.gateway === id);
      const cat = catalogues.get(id);
      for (const ref of cands) {
        // An id this gateway does not serve is a guaranteed 404 that trips a
        // breaker and teaches nothing, so prefer a real id from the catalogue.
        if (Array.isArray(cat) && !cat.includes(ref.model)) {
          const near = cat.find((m) => m.includes(ref.model.split("/").pop()!.split(":")[0]));
          refs.push(near ? { ...ref, model: near } : ref);
        } else {
          refs.push(ref);
        }
      }
    }
  }

  if (refs.length === 0) {
    console.log("\nNo model refs to probe. Pass --models gateway:model[,gateway:model].");
    return;
  }

  console.log("\n=== MODEL PROBE ===\n");
  const results: ProbeOutcome[] = [];
  for (const ref of refs) {
    const r = await probeModel(ref, true);
    results.push(r);
    const verdict = r.schema ? "CERTIFIABLE" : r.json ? "JSON-WEAK" : r.completion ? "NO-JSON" : "FAIL";
    console.log(`${refId(ref)}`);
    console.log(`  status      ${r.status ?? "—"}`);
    console.log(`  completion  ${r.completion ? "PASS" : "FAIL"}`);
    console.log(`  json        ${r.json ? "PASS" : "FAIL"}`);
    console.log(`  schema      ${r.schema ? "PASS" : "FAIL"}`);
    console.log(`  json mode   ${r.jsonModeAccepted === null ? "unknown" : r.jsonModeAccepted ? "accepted" : "not used"}`);
    console.log(`  latency     ${r.latencyMs} ms`);
    console.log(
      `  usage       ${r.usage ? `${r.usage.prompt ?? "?"} in / ${r.usage.completion ?? "?"} out` : "not reported"}`,
    );
    console.log(`  probe       ${verdict}`);
    if (r.note) console.log(`  note        ${r.note}`);
    console.log("");
  }

  console.log("=== SUMMARY ===\n");
  for (const r of results) {
    const state = r.schema
      ? "CERTIFIABLE — eligible for canary on the real prompt"
      : r.completion
        ? "EXCLUDED — answered but could not hold a 3-field schema"
        : `EXCLUDED — ${r.note || "no completion"}`;
    console.log(`${refId(r.ref).padEnd(42)} ${state}`);
  }
  console.log(
    "\nCERTIFIABLE is not CERTIFIED. Semantic certification (direction, open\nvocabulary, no invented fields) happens on the real understanding prompt.",
  );
}

await main();
