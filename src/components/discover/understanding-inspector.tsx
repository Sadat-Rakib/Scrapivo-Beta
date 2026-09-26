/**
 * Understanding Inspector — the Gate 1 developer surface.
 *
 * It renders what Scrapivo thinks the user meant and does nothing else: no
 * search, no leads, no enrichment. That restriction is the feature. The whole
 * point of Gate 1 is to be able to look at a frame and say "that is wrong"
 * before any retrieval result is available to be blamed instead.
 *
 * Reached at /discover?inspect=1.
 */

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  understandQuery,
  answerClarification,
  type UnderstandResult,
} from "@/lib/understanding/understanding.functions";
import type { UnderstandingFrame } from "@/lib/understanding/frame";
import type { BlockingField } from "@/lib/understanding/clarify-state";
import { Button } from "@/components/ui/button";

type Turn = {
  field: BlockingField;
  question: string;
  answer: string;
};

export function UnderstandingInspector({ initialQuery = "" }: { initialQuery?: string }) {
  const understand = useServerFn(understandQuery);
  const answer = useServerFn(answerClarification);

  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<UnderstandResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Clarification bookkeeping mirrors the server's ClarificationState: answers
  // accumulate and are replayed, never re-derived from the query.
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");

  async function run() {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswered({});
    setAsked([]);
    setTurns([]);
    setDraft("");
    try {
      // Cache bypassed on purpose: the inspector must measure the prompt as it
      // is now, not the answer it gave before the last prompt edit.
      const r = await understand({ data: { query: query.trim(), bypassCache: true } });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitAnswer() {
    const q = result?.question;
    if (!q || !result || loading) return;
    const given = draft.trim();
    if (!given) return;
    setLoading(true);
    setError(null);
    try {
      const r = await answer({
        data: {
          frame: result.frame,
          answered,
          asked,
          turns: turns.length,
          field: q.field,
          answer: given,
        },
      });
      setAnswered((prev) => ({ ...prev, [q.field]: given }));
      setAsked((prev) => (prev.includes(q.field) ? prev : [...prev, q.field]));
      setTurns((prev) => [...prev, { field: q.field, question: q.question, answer: given }]);
      setDraft("");
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Understanding Inspector</h1>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Gate 1 · dev only
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Parses the sentence and stops. No database, no search providers, no maps, no browser, no
          enrichment.
        </p>
      </header>

      <div className="space-y-2">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
          }}
          rows={3}
          placeholder="need some robotics founders around trondheim tryna hire embedded engineers rn"
          className="w-full resize-y rounded-md border bg-background p-3 font-mono text-sm"
        />
        <div className="flex items-center gap-2">
          <Button onClick={() => void run()} disabled={loading || !query.trim()}>
            {loading ? "Understanding…" : "Understand"}
          </Button>
          <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      ) : null}

      {result ? (
        <>
          <ExtractorBar frame={result.frame} extractionError={result.extractionError} />

          {result.question ? (
            <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Clarification · {result.question.field}
                </div>
                <div className="mt-1 text-sm font-medium">{result.question.question}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.question.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDraft(opt)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      draft === opt ? "border-amber-600 bg-amber-200 dark:bg-amber-800" : "bg-background"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitAnswer();
                  }}
                  placeholder="or type an answer"
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                />
                <Button size="sm" onClick={() => void submitAnswer()} disabled={loading || !draft.trim()}>
                  Answer
                </Button>
              </div>
            </section>
          ) : (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
              No clarification needed.
            </div>
          )}

          {turns.length ? (
            <section>
              <SectionTitle>Clarification history</SectionTitle>
              <ol className="space-y-1 text-sm">
                {turns.map((t, i) => (
                  <li key={`${t.field}-${i}`} className="flex gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>
                      <span className="font-mono text-xs text-muted-foreground">{t.field}</span>{" "}
                      {t.question} → <span className="font-medium">{t.answer}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-muted-foreground">
                An answered field can never re-enter the unresolved set — if the same question
                returns here, clarification monotonicity is broken.
              </p>
            </section>
          ) : null}

          <FrameView frame={result.frame} />

          {result.violations.length ? (
            <section>
              <SectionTitle>Violations</SectionTitle>
              <ul className="space-y-1 text-sm">
                {result.violations.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <Sev sev={v.severity} />
                    <span>
                      <span className="font-mono text-xs">{v.path}</span> · {v.message}
                      <span className="ml-1 font-mono text-xs text-muted-foreground">{v.code}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.repairs.length ? (
            <section>
              <SectionTitle>Normalizations applied</SectionTitle>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {result.repairs.map((r, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">{r.path}</span> · {r.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <button
              type="button"
              onClick={() => setShowJson((s) => !s)}
              className="text-sm font-medium underline"
            >
              {showJson ? "Hide" : "Show"} raw frame JSON
            </button>
            {showJson ? (
              <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {JSON.stringify(result.frame, null, 2)}
              </pre>
            ) : null}
            {showJson && result.rawResponse ? (
              <>
                <div className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Model response
                </div>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                  {result.rawResponse}
                </pre>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

/** Extractor / provider / prompt / latency / fallback — the practical strip. */
function ExtractorBar({
  frame,
  extractionError,
}: {
  frame: UnderstandingFrame;
  extractionError: string | null;
}) {
  const m = frame.meta;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-6">
        <Kv k="Extractor" v={m.extractor === "llm" ? "LLM" : "Deterministic"} />
        <Kv k="Provider" v={m.provider ?? (m.cached ? "cache" : "—")} />
        <Kv k="Prompt" v={m.prompt_version ?? "—"} />
        <Kv k="Time" v={`${m.latency_ms} ms`} />
        <Kv k="Fallback" v={m.fallback_used ? "Yes" : "No"} />
        <Kv k="Cache" v={m.cached ? "Hit" : "Bypassed"} />
      </div>
      {m.model ? (
        <div className="text-xs text-muted-foreground">
          Model: <span className="font-mono">{m.model}</span>
          {m.cached ? " · served from cache" : ""}
        </div>
      ) : null}
      {extractionError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          LLM extraction failed, deterministic fallback answered: {extractionError}
        </div>
      ) : null}
      {m.notes.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {m.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The human-readable frame — this is the thing that gets eyeballed. */
function FrameView({ frame }: { frame: UnderstandingFrame }) {
  const t = frame.target;
  const r = frame.relation;
  const uc = frame.user_context;
  const cl = frame.clarification;

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>Request</SectionTitle>
        <Rows>
          <Row label="Raw query" text={frame.input.raw} />
          <Row label="Task type" traced={frame.task_type} />
          {/* The mode is what makes this a lead engine rather than a search
              box: fit vs opportunity vs intent are four different searches
              over one target. */}
          <Row label="Prospecting mode" traced={frame.prospecting_mode} />
        </Rows>
      </section>

      <section>
        <SectionTitle>Target</SectionTitle>
        <Rows>
          <Row label="Entity type" traced={t.entity_type} />
          {t.entity_ambiguous ? (
            <Row
              label="Entity reading"
              text="also defensible as the other of person / practice — kept this reading rather than asking"
            />
          ) : null}
          {t.entity_subtype ? <Row label="Subtype" open={t.entity_subtype} /> : null}
          {t.role ? <Row label="Role" open={t.role} /> : null}
          {t.job_title ? <Row label="Job title" open={t.job_title} /> : null}
          {t.industry ? <Row label="Industry" open={t.industry} /> : null}
          {t.category ? <Row label="Category" open={t.category} /> : null}
          {t.business_type ? <Row label="Business type" open={t.business_type} /> : null}
          {t.niche ? <Row label="Niche" open={t.niche} /> : null}
          {t.company_stage ? <Row label="Stage" open={t.company_stage} /> : null}
          {t.technologies.length ? <Row label="Technologies" list={t.technologies} /> : null}
          {t.descriptors.length ? <Row label="Descriptors" list={t.descriptors} /> : null}
        </Rows>
      </section>

      <section>
        <SectionTitle>Relationship</SectionTitle>
        <Rows>
          <Row label="Relation" traced={r.type} />
          {r.label ? <Row label="Relation label" text={r.label} /> : null}
          {r.object ? <Row label="Object" open={r.object} /> : null}
          <Row label="Direction" traced={r.direction} />
          <Row
            label="On behalf of a company"
            text={frame.organization_context.on_behalf_of_company}
          />
          {frame.organization_context.company ? (
            <Row label="Company" open={frame.organization_context.company} />
          ) : null}
        </Rows>
      </section>

      {uc.selling?.service || uc.selling?.product || uc.objective || uc.notes.length ? (
        <section>
          <SectionTitle>What the searcher told us about themselves</SectionTitle>
          <Rows>
            {uc.selling?.service ? <Row label="Sells (service)" open={uc.selling.service} /> : null}
            {uc.selling?.product ? <Row label="Sells (product)" open={uc.selling.product} /> : null}
            {uc.objective ? <Row label="Objective" open={uc.objective} /> : null}
            {uc.notes.length ? <Row label="Notes" list={uc.notes} /> : null}
          </Rows>
          {/* Stated separately because it is not prospect qualification: "I
              sell web design" is not evidence that a prospect needs one. */}
          <p className="mt-1 text-xs text-muted-foreground">
            Context only — never read as a prospect's need. A need has to come from the user's own
            words about the prospect.
          </p>
        </section>
      ) : null}

      {frame.location || frame.temporal ? (
        <section>
          <SectionTitle>Where and when</SectionTitle>
          <Rows>
            {frame.location ? (
              <>
                <Row
                  label="Location"
                  text={frame.location.value}
                  raw={frame.location.raw}
                  confidence={frame.location.confidence}
                />
                <Row
                  label="Scope"
                  text={
                    frame.location.scope === "within_radius"
                      ? `within ${frame.location.radius ?? "?"} ${frame.location.radius_unit ?? ""}`.trim()
                      : frame.location.scope
                  }
                />
                {frame.location.canonical ? (
                  <Row label="Canonical" text={frame.location.canonical} />
                ) : (
                  <Row label="Canonical" text="not resolved (fine for obscure places)" muted />
                )}
              </>
            ) : null}
            {frame.temporal ? (
              <Row
                label="Temporal"
                text={[
                  frame.temporal.relation,
                  frame.temporal.window,
                  frame.temporal.year,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                raw={frame.temporal.raw}
                confidence={frame.temporal.confidence}
              />
            ) : null}
          </Rows>
        </section>
      ) : null}

      <section>
        <SectionTitle>Evidence</SectionTitle>
        <Rows>
          <Row label="Claim evidence required" text={yn(frame.evidence.claim_evidence_required)} />
          <Row label="Intent signal required" text={yn(frame.evidence.intent_signal_required)} />
          {frame.evidence.reasons.length ? (
            <Row label="Because" text={frame.evidence.reasons.join("; ")} muted />
          ) : null}
        </Rows>
      </section>

      {frame.constraints.length ? (
        <section>
          <SectionTitle>Constraints</SectionTitle>
          <ul className="space-y-1 text-sm">
            {frame.constraints.map((c, i) => (
              <li key={i} className="font-mono text-xs">
                {c.negated ? <span className="text-destructive">NOT </span> : null}
                {c.field} {c.operator}{" "}
                {Array.isArray(c.value) ? c.value.join(" | ") : String(c.value ?? "")}
                {c.unit ? ` ${c.unit}` : ""}
                {c.raw ? (
                  <span className="ml-2 font-sans text-muted-foreground">“{c.raw}”</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {frame.compound.is_compound ? (
        <section>
          <SectionTitle>Compound request</SectionTitle>
          <p className="mb-2 text-sm">
            This reads as {frame.compound.subgoals.length} separate searches. Nothing has been
            discarded.
          </p>
          <ol className="space-y-2 text-sm">
            {frame.compound.subgoals.map((s, i) => (
              <li key={i} className="rounded border bg-muted/30 p-2">
                {s.raw ? (
                  <div className="text-xs text-muted-foreground">“{s.raw}”</div>
                ) : null}
                <div className="mt-1 font-mono text-xs">
                  {s.target.entity_type.value}
                  {s.target.role?.value ? ` (${s.target.role.value})` : ""} —{" "}
                  {s.relation.type.value}
                  {s.relation.object?.value ? ` → ${s.relation.object.value}` : ""}
                  {s.location ? ` @ ${s.location.value}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {frame.quantity ||
      frame.required_fields.length ||
      frame.preferred_fields.length ||
      frame.verification.length ||
      frame.output.length ||
      frame.source_preferences.length ||
      frame.enrichment_requirements.length ? (
        <section>
          <SectionTitle>Deliverables</SectionTitle>
          <Rows>
            {frame.quantity ? (
              <Row
                label="Quantity"
                text={
                  [
                    frame.quantity.unlimited ? "as many as possible" : null,
                    frame.quantity.requested
                      ? `${frame.quantity.requested} requested${frame.quantity.approximate ? " (approx)" : ""}`
                      : null,
                    frame.quantity.minimum ? `min ${frame.quantity.minimum}` : null,
                    frame.quantity.maximum ? `max ${frame.quantity.maximum}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                }
                raw={frame.quantity.raw}
              />
            ) : null}
            {frame.required_fields.length ? (
              <Row label="Required fields" list={frame.required_fields} />
            ) : null}
            {frame.preferred_fields.length ? (
              <Row label="Preferred fields" list={frame.preferred_fields} />
            ) : null}
            {frame.contact_requirements.length ? (
              <Row label="Contact" list={frame.contact_requirements} />
            ) : null}
            {frame.verification.length ? (
              <Row
                label="Verification"
                text={frame.verification.map((v) => v.label ?? v.kind).join(", ")}
              />
            ) : null}
            {frame.output.length ? (
              <Row label="Output" text={frame.output.map((o) => o.label ?? o.kind).join(", ")} />
            ) : null}
            {frame.source_preferences.length ? (
              <Row label="Sources" list={frame.source_preferences} />
            ) : null}
            {frame.enrichment_requirements.length ? (
              <Row label="Enrichment" list={frame.enrichment_requirements} />
            ) : null}
          </Rows>
        </section>
      ) : null}

      <section>
        <SectionTitle>Clarification</SectionTitle>
        <Rows>
          <Row label="Needed" text={yn(cl.needed)} />
          {/* The reason is what separates a genuine blocker from the layer
              failing to read plain English. */}
          {cl.reason ? <Row label="Reason" text={cl.reason} /> : null}
          {cl.fields.length ? <Row label="Missing fields" text={cl.fields.join(", ")} /> : null}
          {cl.question ? <Row label="Question" text={cl.question} /> : null}
        </Rows>
      </section>
    </div>
  );
}

// ── Presentational bits ───────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y rounded-md border">{children}</dl>;
}

function Row({
  label,
  traced,
  open,
  list,
  text,
  raw,
  confidence,
  muted,
}: {
  label: string;
  traced?: { value: string; raw: string | null; confidence: number };
  open?: { value: string; raw: string | null; normalized: string | null; confidence: number };
  list?: { value: string; raw: string | null; normalized: string | null; confidence: number }[];
  text?: string;
  raw?: string | null;
  confidence?: number;
  muted?: boolean;
}) {
  const value = traced?.value ?? open?.value ?? text ?? (list ? list.map((l) => l.value).join(", ") : "—");
  const shownRaw = traced?.raw ?? open?.raw ?? raw ?? null;
  const conf = traced?.confidence ?? open?.confidence ?? confidence ?? null;
  const normalized = open?.normalized ?? null;
  const unknown = value === "unknown";

  return (
    <div className="grid grid-cols-3 gap-3 px-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 space-y-0.5">
        <div
          className={
            unknown
              ? "font-medium text-amber-700 dark:text-amber-400"
              : muted
                ? "text-muted-foreground"
                : "font-medium"
          }
        >
          {value}
          {conf !== null ? (
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              {conf.toFixed(2)}
            </span>
          ) : null}
        </div>
        {/* Raw → normalized is shown because a mapping nobody can see is a
            mapping nobody can correct. */}
        {shownRaw && shownRaw !== value ? (
          <div className="text-xs text-muted-foreground">
            from “{shownRaw}”{normalized && normalized !== value ? ` → ${normalized}` : ""}
          </div>
        ) : null}
        {list && list.some((l) => l.raw && l.raw !== l.value) ? (
          <div className="text-xs text-muted-foreground">
            {list
              .filter((l) => l.raw && l.raw !== l.value)
              .map((l) => `“${l.raw}” → ${l.value}`)
              .join(", ")}
          </div>
        ) : null}
      </dd>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function Sev({ sev }: { sev: string }) {
  const cls =
    sev === "blocking"
      ? "bg-destructive/15 text-destructive"
      : sev === "warning"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{sev}</span>;
}

function yn(b: boolean): string {
  return b ? "Yes" : "No";
}
