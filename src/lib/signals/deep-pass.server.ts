/**
 * WS7A — minimal deep-signal pass (qualification split).
 *
 * Kills the circular drop on signal_required specs: today a base-eligible
 * candidate with no signal evidence is rejected by the final gate BEFORE any
 * per-candidate signal research runs, so it never gains the signal it was
 * rejected for. The split:
 *
 *   BASE ELIGIBILITY  — identity/fit constraints of the spec, EXCLUDING the
 *                       signal constraint (splitBaseEligibility)
 *   SIGNAL RESEARCH   — only when spec.signal_required, budgeted per
 *                       candidate (runDeepSignalPass)
 *   FINAL QUALIFICATION — the FULL existing gate, no weakening
 *                       (finalQualify)
 *
 * Signal-optional specs keep today's behavior: the pass is a no-op and
 * signals stay post-qualification enrichment.
 *
 * Anti-fabrication: a signal counts only as Evidence with source_url +
 * observed_at + extractive excerpt, subject-bound to the candidate, and a
 * demand-signal type — mirroring the existing social/web evidence path
 * (src/lib/search/social-signal.ts, src/lib/search/evidence.ts). LLMs and
 * hunters may observe, never invent; evidence failing verification is
 * discarded, never downgraded into proof.
 *
 * ---------------------------------------------------------------------------
 * WIRING CONTRACT (parent applies it — do not wire inside this module)
 * ---------------------------------------------------------------------------
 * Anchor: `runSpecSearchCore` in src/lib/spec-search.functions.ts, the FINAL
 * qualification block immediately before the belt-and-suspenders delivery
 * filter — currently lines ~2221-2225:
 *
 *     const { applyWhyMatchGate } = await import("@/lib/search/live-gapfill");
 *     completeRows = applyWhyMatchGate(completeRows, spec, !!spec.signal_required).kept;
 *     // Belt-and-suspenders: only theorem-qualified rows may be delivered.
 *     completeRows = completeRows.filter((r) => r.disposition === "qualified");
 *
 * Insert AFTER the user-cancellation check (the `deps.signal?.aborted &&
 * !deadlineNow()` early return, ~line 2205-2220) and IN PLACE OF the two gate
 * lines above, guarded by `if (spec.signal_required)`:
 *
 *     const { splitBaseEligibility, runDeepSignalPass, finalQualify } =
 *       await import("@/lib/signals/deep-pass.server");
 *     const { baseEligible, baseRejected } = splitBaseEligibility(completeRows, spec);
 *     const deep = await runDeepSignalPass(baseEligible, spec, {
 *       signal: deps.signal,
 *       onProgress: (e) => emitProgress(e.action, e.source, e.detail, e.count),
 *     });
 *     completeRows = finalQualify({
 *       signalReady: deep.signalReady,
 *       alreadySignalRows: [
 *         ...baseRejected,
 *         ...deep.alreadyVerified,
 *         ...deep.stillUnsignaled,
 *         ...deep.notResearched,
 *       ],
 *       spec,
 *     }).qualified;
 *
 * (Signal-optional specs keep the existing applyWhyMatchGate call unchanged.)
 * The hard-deadline rule is preserved: deadlineNow() must skip the deep pass
 * and run the plain gate — on the deadline the gate still runs synchronously.
 */
import type { SearchSpec } from "@/lib/search/search-spec";
import { rowSatisfiesSpec, type SpecRow } from "@/lib/spec-search.functions";
import { applyWhyMatchGate } from "@/lib/search/live-gapfill";
import { makeEvidence, type Evidence } from "@/lib/search/evidence";
import { qualifyLead } from "@/lib/search/qualify";

// ---------------------------------------------------------------------------
// Base eligibility (identity/fit, spec MINUS the signal constraint)
// ---------------------------------------------------------------------------

/**
 * Signal dimension of a SearchSpec, enforced ONLY by the qualification path
 * (qualifyLead → canonical-contract theorem / person/job/social gates):
 *   spec.signal_required, spec.signal_types, spec.signal_recency, plus the
 *   need/claim criterion fields requested_service, requested_role,
 *   requested_product, funding_status, content_topic.
 * Identity/fit criterion fields are: role, industry, location, category,
 * business_model, investor_sector, investor_stage, investor_check, seniority,
 * employment (per entity; see rowSatisfiesSpec).
 */
const SIGNAL_CRITERION_FIELDS: ReadonlySet<string> = new Set([
  "requested_service",
  "requested_role",
  "requested_product",
  "funding_status",
  "content_topic",
]);

export function isSignalCriterionField(field: string): boolean {
  return SIGNAL_CRITERION_FIELDS.has(field);
}

/**
 * Pure split of rows into base-eligible vs base-rejected for the spec.
 *
 * Reuses rowSatisfiesSpec (src/lib/spec-search.functions.ts) AS-IS: it checks
 * identity/fit per entity (person role/industry/location; business/company
 * category/business_model/location; investor sector/stage/check/location; job
 * role/location/seniority/employment) and consults NONE of the signal
 * dimension (see isSignalCriterionField above) — so it IS "spec minus the
 * signal constraint" and needs no field exclusion. If rowSatisfiesSpec ever
 * starts consulting a signal-related field, this function must be revisited.
 * The signal requirement itself stays in the FINAL gate (finalQualify).
 */
export function splitBaseEligibility(
  rows: SpecRow[],
  spec: SearchSpec,
): { baseEligible: SpecRow[]; baseRejected: SpecRow[] } {
  const baseEligible: SpecRow[] = [];
  const baseRejected: SpecRow[] = [];
  for (const row of rows) {
    (rowSatisfiesSpec(spec, row) ? baseEligible : baseRejected).push(row);
  }
  return { baseEligible, baseRejected };
}

// ---------------------------------------------------------------------------
// Verification — never fabricate
// ---------------------------------------------------------------------------

/**
 * Evidence types that count as a demand signal. Deliberately narrower than
 * EvidenceType: no_website is a structural opportunity (owned by absence
 * verification), identity/contact are not demand. The theorem gate keeps its
 * own stricter rules; this is the floor for the deep pass to ATTACH anything.
 */
export const SIGNAL_EVIDENCE_TYPES: ReadonlySet<Evidence["evidence_type"]> =
  new Set<Evidence["evidence_type"]>([
    "hiring",
    "service_request",
    "funding",
    "social_ask",
  ]);

/** Stable entity id a row can prove (provisional ids bind nothing). */
export function deepPassEntityIdOf(row: SpecRow): string | null {
  const id = row.entity_id?.trim() || row.key?.trim() || "";
  if (!id || id.startsWith("provisional:")) return null;
  return id;
}

function isHttpUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Structural verification of ONE incoming evidence item against the row —
 * the exact floor the existing evidence path guarantees (source_url +
 * observed_at + extractive excerpt + subject binding). Anything failing this
 * is NOT a verified signal: it is never attached to the row.
 */
export function isVerifiedSignalEvidence(row: SpecRow, ev: Evidence): boolean {
  if (!SIGNAL_EVIDENCE_TYPES.has(ev.evidence_type)) return false;
  if (!isHttpUrl(ev.source_url)) return false;
  if (!ev.observed_at || Number.isNaN(Date.parse(ev.observed_at))) return false;
  const excerpt = ev.excerpt?.trim();
  if (!excerpt) return false;
  const subjectId = deepPassEntityIdOf(row);
  if (!subjectId) return false;
  if ((ev.subject ?? "").trim() !== subjectId) return false;
  if (typeof ev.confidence !== "number" || ev.confidence < 0 || ev.confidence > 1)
    return false;
  return true;
}

/** Whether the row already carries verified signal evidence. */
export function rowHasVerifiedSignal(row: SpecRow): boolean {
  return (row.evidence ?? []).some((ev) => isVerifiedSignalEvidence(row, ev));
}

function evidenceKey(ev: Evidence): string {
  return `${ev.source_url}\u0000${(ev.excerpt ?? "").trim()}\u0000${ev.evidence_type}`;
}

/**
 * Filter incoming evidence to verified, non-duplicate signal items for the
 * row. Hunter output is untrusted input, not proof.
 */
export function verifiedSignalEvidence(
  row: SpecRow,
  incoming: Evidence[] | null | undefined,
): Evidence[] {
  if (!incoming?.length) return [];
  const seen = new Set((row.evidence ?? []).map(evidenceKey));
  const out: Evidence[] = [];
  for (const ev of incoming) {
    if (!isVerifiedSignalEvidence(row, ev)) continue;
    const k = evidenceKey(ev);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ev);
  }
  return out;
}

function attachVerifiedEvidence(row: SpecRow, verified: Evidence[]): SpecRow {
  if (!verified.length) return row;
  return { ...row, evidence: [...(row.evidence ?? []), ...verified] };
}

// ---------------------------------------------------------------------------
// Deep pass — budgeted per-candidate signal hunt
// ---------------------------------------------------------------------------

/** Progress event, compatible with the browserProgress shape. */
export interface DeepPassProgress {
  action: string;
  source?: string;
  detail?: string;
  count?: number | string;
}

export interface DeepPassContext {
  /** User/deadline abort signal for the owning search run. */
  signal?: AbortSignal | null;
  /** 0-based probe index for this candidate. */
  probeIndex: number;
  /** Probes remaining for this candidate (including this one). */
  probesLeft: number;
}

/**
 * One probe against one candidate. Returns candidate evidence (untrusted —
 * verified before use) or null/undefined when the probe found nothing.
 */
export type SignalHunter = (
  row: SpecRow,
  spec: SearchSpec,
  ctx: DeepPassContext,
) => Promise<Evidence[] | null | undefined | void>;

export interface DeepSignalPassOptions {
  /** Whole-pass wall-clock budget in ms (default 45s). */
  budgetMs?: number;
  /** Max probes per candidate (default 2). */
  probesPerCandidate?: number;
  /** In-flight candidates (default 3 — WS2 pool default). */
  concurrency?: number;
  /** Per-probe timeout in ms (default 12s). */
  probeTimeoutMs?: number;
  /** Injected hunter (tests/adapters). undefined → production hunter; null → dry split. */
  hunter?: SignalHunter | null;
  /** User/deadline abort for the owning search run. */
  signal?: AbortSignal | null;
  /** browserProgress-compatible sink. */
  onProgress?: (e: DeepPassProgress) => void;
}

export interface DeepSignalPassResult {
  /** Rows that GAINED a verified signal from this pass. */
  signalReady: SpecRow[];
  /** Rows that arrived with a verified signal (untouched). */
  alreadyVerified: SpecRow[];
  /** Researched; hunter found nothing verifiable (honest: they still fail the final gate). */
  stillUnsignaled: SpecRow[];
  /** Never probed — budget/deadline/abort ran out first. */
  notResearched: SpecRow[];
  /** Hunter invocations actually made. */
  probes: number;
  /** signalReady.length (convenience). */
  verifiedRows: number;
  /** Pass budget exhausted before every candidate was probed. */
  deadlineHit: boolean;
  /** User/deadline abort observed. */
  aborted: boolean;
}

export async function runDeepSignalPass(
  baseEligibleRows: SpecRow[],
  spec: SearchSpec,
  opts: DeepSignalPassOptions = {},
): Promise<DeepSignalPassResult> {
  const result: DeepSignalPassResult = {
    signalReady: [],
    alreadyVerified: [],
    stillUnsignaled: [],
    notResearched: [],
    probes: 0,
    verifiedRows: 0,
    deadlineHit: false,
    aborted: false,
  };

  // Signal-optional specs: the pass is never invoked (enrichment path
  // unchanged); everything is "already verified" from this pass's viewpoint.
  if (!spec.signal_required) {
    result.alreadyVerified = baseEligibleRows.slice();
    return result;
  }

  const budgetMs = Math.max(0, opts.budgetMs ?? 45_000);
  const probesPerCandidate = Math.max(1, Math.floor(opts.probesPerCandidate ?? 2));
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 3));
  const probeTimeoutMs = Math.max(250, opts.probeTimeoutMs ?? 12_000);
  const signal = opts.signal ?? null;
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const pastDeadline = () => Date.now() >= deadline;

  // Partition: already-verified rows skip research entirely.
  const toResearch = baseEligibleRows.filter((r) => !rowHasVerifiedSignal(r));
  result.alreadyVerified = baseEligibleRows.filter((r) => rowHasVerifiedSignal(r));
  if (!toResearch.length) return result;

  opts.onProgress?.({
    action: "Signal research started",
    source: "deep-signal",
    detail: `${toResearch.length} base-eligible candidates lack a verified signal`,
    count: toResearch.length,
  });

  // Dry split (hunter explicitly disabled): honest, no research.
  if (opts.hunter === null) {
    result.stillUnsignaled = toResearch;
    return result;
  }
  const hunter: SignalHunter =
    opts.hunter ?? createDefaultSignalHunter();

  const queue = toResearch.slice();
  let inFlight = 0;
  let stopStarting = false;

  const settleRow = (row: SpecRow, verified: Evidence[]) => {
    if (verified.length) {
      result.signalReady.push(attachVerifiedEvidence(row, verified));
      result.verifiedRows += 1;
    } else {
      result.stillUnsignaled.push(row);
    }
  };

  /** One probe with timeout + abort discipline. Resolves null on failure. */
  const runProbe = async (
    row: SpecRow,
    probeIndex: number,
  ): Promise<Evidence[] | null> => {
    const ctx: DeepPassContext = {
      signal,
      probeIndex,
      probesLeft: probesPerCandidate - probeIndex,
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const probe = Promise.resolve()
        .then(() => hunter(row, spec, ctx))
        .then((raw) => (Array.isArray(raw) ? (raw as Evidence[]) : null));
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), probeTimeoutMs);
      });
      return await Promise.race([probe, timeout]);
    } catch {
      // Probe failure is not an honest zero against the CANDIDATE unless
      // verified evidence exists elsewhere; per-probe errors just yield null.
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const huntOne = async (row: SpecRow): Promise<void> => {
    let settled = false;
    // Idempotent: a row lands in exactly ONE bucket, even when the deadline
    // or abort fires mid-probe (it is finalized as researched-so-far — an
    // honest "researched, no verified signal" unless evidence was verified).
    const finish = (verified: Evidence[]) => {
      if (settled) return;
      settled = true;
      settleRow(row, verified);
    };
    // No bindable stable id → verified evidence can never attach; probing
    // would only burn budget. Honest stillUnsignaled.
    if (!deepPassEntityIdOf(row)) return finish([]);
    for (let probeIndex = 0; probeIndex < probesPerCandidate; probeIndex++) {
      if (signal?.aborted || pastDeadline()) return finish([]);
      const raw = await runProbe(row, probeIndex);
      result.probes += 1;
      const verified = verifiedSignalEvidence(row, raw);
      if (verified.length) {
        finish(verified);
        opts.onProgress?.({
          action: "Signal verified",
          source: "deep-signal",
          detail: row.title,
        });
        return;
      }
      if (signal?.aborted || pastDeadline()) return finish([]);
    }
    finish([]);
  };

  // Small internal pool (mirrors the WS2 candidate pool: bounded in-flight,
  // no new deps; per-domain serialization is unnecessary — probes fan out
  // across independent sources).
  await new Promise<void>((resolve) => {
    const maybeFinish = () => {
      if (inFlight === 0 && (queue.length === 0 || stopStarting)) resolve();
    };
    const drainRemaining = () => {
      result.notResearched.push(...queue);
      queue.length = 0;
    };
    const pump = () => {
      while (!stopStarting && inFlight < concurrency && queue.length > 0) {
        if (signal?.aborted) {
          result.aborted = true;
          stopStarting = true;
          break;
        }
        if (pastDeadline()) {
          result.deadlineHit = true;
          stopStarting = true;
          break;
        }
        const row = queue.shift()!;
        inFlight += 1;
        huntOne(row)
          .catch(() => {
            /* huntOne never throws; belt for injected hunter rejections */
            settleRow(row, []);
          })
          .finally(() => {
            inFlight -= 1;
            pump();
            maybeFinish();
          });
      }
      if (stopStarting && queue.length > 0) drainRemaining();
      maybeFinish();
    };
    pump();
  });

  opts.onProgress?.({
    action: "Signal research finished",
    source: "deep-signal",
    detail: `${result.verifiedRows} of ${toResearch.length} candidates gained a verified signal`,
    count: result.verifiedRows,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Final qualification — the FULL existing gate, no weakening
// ---------------------------------------------------------------------------

export interface FinalQualifyArgs {
  /** Rows that gained a verified signal in the deep pass. */
  signalReady: SpecRow[];
  /**
   * Every other candidate the parent holds for this page: already signal-
   * carrying rows, researched-but-unsignaled rows, not-researched rows and
   * base-rejected rows. The gate applies identically to the union.
   */
  alreadySignalRows: SpecRow[];
  spec: SearchSpec;
}

export interface FinalQualifyOutput {
  qualified: SpecRow[];
  rejected: Array<{ row: SpecRow; code: string | null; reason: string | null }>;
}

function deepPassIdentityKey(row: SpecRow): string {
  return row.entity_id?.trim() || row.key?.trim() || `${row.kind}:${row.title}`;
}

/**
 * Pure: applies the FULL production qualification gate — applyWhyMatchGate
 * (theorem path) with requireSignal=!!spec.signal_required, then the same
 * belt-and-suspenders disposition==="qualified" filter runSpecSearchCore uses
 * — to the union of signalReady + alreadySignalRows. Nothing is weakened:
 * a row the deep pass could not help still fails exactly as it would today.
 */
export function finalQualify(args: FinalQualifyArgs): FinalQualifyOutput {
  const seen = new Set<string>();
  const union: SpecRow[] = [];
  for (const row of [...args.signalReady, ...args.alreadySignalRows]) {
    const k = deepPassIdentityKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    union.push(row);
  }

  const { kept } = applyWhyMatchGate(union, args.spec, !!args.spec.signal_required);
  // Belt-and-suspenders: only theorem-qualified rows may be delivered.
  const qualified = kept.filter((r) => r.disposition === "qualified");
  const qualifiedKeys = new Set(qualified.map(deepPassIdentityKey));
  // Diagnostics only: re-run the same per-row gate on the rejected subset to
  // carry honest reject codes out (same pattern as runSpecSearchCore's
  // [qualification-rejected] summary — it never alters the decision).
  const rejected = union
    .filter((r) => !qualifiedKeys.has(deepPassIdentityKey(r)))
    .map((row) => {
      const q = qualifyLead(row, args.spec, row.evidence);
      return {
        row,
        code: q.reject_code ?? null,
        reason: q.label ?? null,
      };
    });
  return { qualified, rejected };
}

// ---------------------------------------------------------------------------
// Production hunter — thin composition over the existing discovery paths
// ---------------------------------------------------------------------------

export interface WebHitLike {
  title: string;
  snippet: string;
  url: string;
}
export interface SocialHitLike {
  title: string;
  url: string;
  excerpt: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
}
export interface DefaultHunterDeps {
  /** Defaults to the free-first SearXNG ladder (src/lib/search/provider-ladder). */
  webSearch?: (args: {
    queries: string[];
    maxQueries: number;
    signal?: AbortSignal | null;
  }) => Promise<WebHitLike[]>;
  /** Defaults to the spec-level Reddit social provider (src/lib/search/social-signal). */
  socialSearch?: (spec: SearchSpec, limit: number) => Promise<SocialHitLike[]>;
}

/**
 * Distinctive identity token of a candidate: a host (website/first-party url)
 * when known, else the longest distinctive word of the title. Short/generic
 * words never bind a hit to a candidate.
 */
export function candidateIdentityToken(row: SpecRow): string | null {
  const hostUrl = row.website_url ?? (row.kind === "business" || row.kind === "company" ? row.url ?? null : null);
  if (hostUrl) {
    try {
      const host = new URL(hostUrl).hostname.toLowerCase().replace(/^www\./, "");
      if (host) return host;
    } catch {
      /* fall through to title token */
    }
  }
  const words = (row.title ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length);
  return words[0] ?? null;
}

function hitNamesCandidate(text: string, row: SpecRow): boolean {
  const token = candidateIdentityToken(row);
  if (!token) return false;
  return text.toLowerCase().includes(token);
}

function needTermsFromSpec(spec: SearchSpec): string | null {
  const field = (f: string) =>
    spec.criteria.find((c) => c.field === f)?.value?.trim() || null;
  return (
    field("requested_service") ??
    field("requested_product") ??
    field("requested_role") ??
    field("funding_status")
  );
}

/**
 * Production hunter over the EXISTING paths only:
 *  - Probe 0: web dork via the free-first ladder (discoverWebFreeFirst), hits
 *    mapped through live-gapfill's evidenceFromWebHit (searxng_snippet →
 *    hiring/service_request/funding only when the text says so), re-bound to
 *    the candidate ONLY when the hit text names it.
 *  - Probe 1: the spec-level social provider (runSocialSignalGapfill
 *    machinery — redditSocialProvider), fetched once per pass and matched to
 *    candidates by the same naming rule; the pipeline-built evidence is
 *    re-bound to the candidate only on a text-name match.
 * No fabrication: evidence text, source_url, timestamps and type all come
 * from the existing extraction paths; this hunter only decides WHICH
 * candidate a naming hit may be attached to. The final gate still runs.
 */
export function createDefaultSignalHunter(deps: DefaultHunterDeps = {}): SignalHunter {
  let socialHitsPromise: Promise<SocialHitLike[]> | null = null;
  const socialHitsOnce = (spec: SearchSpec): Promise<SocialHitLike[]> => {
    if (!socialHitsPromise) {
      const fallback = async (): Promise<SocialHitLike[]> => {
        const { redditSocialProvider } = await import("@/lib/search/social-signal");
        return redditSocialProvider.search(spec, 8) as Promise<SocialHitLike[]>;
      };
      socialHitsPromise = (deps.socialSearch
        ? Promise.resolve(deps.socialSearch(spec, 8))
        : fallback()
      ).catch(() => [] as SocialHitLike[]);
    }
    return socialHitsPromise;
  };

  return async (row, spec, ctx) => {
    const subjectId = deepPassEntityIdOf(row);
    if (!subjectId) return null;
    const need = needTermsFromSpec(spec);

    if (ctx.probeIndex === 0) {
      const webSearch =
        deps.webSearch ??
        (async (args) => {
          const { discoverWebFreeFirst } = await import("@/lib/search/provider-ladder");
          const r = await discoverWebFreeFirst({
            queries: args.queries,
            maxQueries: args.maxQueries,
            signal: args.signal ?? null,
            sourceKey: "deep-signal-pass",
            operation: "deep-signal-pass",
          });
          return r.results.map((h) => ({
            title: h.title,
            snippet: h.content,
            url: h.url,
          }));
        });
      const query = [row.title, need, "(need OR looking for OR hiring)"]
        .filter(Boolean)
        .join(" ");
      const hits = await webSearch({ queries: [query], maxQueries: 4, signal: ctx.signal ?? null });
      const out: Evidence[] = [];
      for (const hit of hits) {
        if (!hitNamesCandidate(`${hit.title} ${hit.snippet}`, row)) continue;
        const { evidenceFromWebHit } = await import("@/lib/search/live-gapfill");
        for (const ev of evidenceFromWebHit({
          title: hit.title,
          snippet: hit.snippet,
          url: hit.url,
          spec,
        })) {
          out.push(makeEvidence({ ...ev, subject: subjectId }));
        }
      }
      return out.length ? out : null;
    }

    // Probe 1: spec-level social demand, matched by name.
    const hits = await socialHitsOnce(spec);
    const { socialHitsToSpecRows } = await import("@/lib/search/social-signal");
    const socialRows = socialHitsToSpecRows(hits, spec);
    const out: Evidence[] = [];
    for (const srow of socialRows) {
      for (const ev of srow.evidence ?? []) {
        if (!hitNamesCandidate(`${ev.excerpt ?? ""} ${srow.title}`, row)) continue;
        out.push(makeEvidence({ ...ev, subject: subjectId }));
      }
    }
    return out.length ? out : null;
  };
}
