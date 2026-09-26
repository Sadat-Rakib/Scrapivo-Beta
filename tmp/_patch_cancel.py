from pathlib import Path

p = Path("scripts/live-adversarial-soak.mts")
text = p.read_text(encoding="utf-8")
start = text.index("async function runCancelRace")
end = text.index("async function probeEnv")
new = r'''async function runCancelRace(envDiag: Record<string, unknown>) {
  const session = new ActiveSearchSession("soak-cancel");
  const slowQ = "recently funded startups in Berlin";
  const midQ = "companies needing marketing help in Austin";
  const fastQ = "React jobs in Toronto paying over $150k";

  const aStart = session.begin();
  const a = aStart.run;
  const pA = runSpecSearchCore(
    slowQ,
    { signal: aStart.signal },
    15,
    { mode: "looking" },
    { search_run_id: a.search_run_id, conversation_id: a.conversation_id },
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e.message : String(e),
    }),
  );

  await new Promise((r) => setTimeout(r, 80));
  const bStart = session.begin();
  const b = bStart.run;
  const pB = runSpecSearchCore(
    midQ,
    { signal: bStart.signal },
    15,
    { mode: "looking" },
    { search_run_id: b.search_run_id, conversation_id: b.conversation_id },
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e.message : String(e),
    }),
  );

  await new Promise((r) => setTimeout(r, 80));
  const cStart = session.begin();
  const c = cStart.run;
  const pC = runSpecSearchCore(
    fastQ,
    { signal: cStart.signal },
    15,
    {},
    { search_run_id: c.search_run_id, conversation_id: c.conversation_id },
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e.message : String(e),
    }),
  );

  const [ra, rb, rc] = await Promise.all([pA, pB, pC]);

  const acceptA = session.accept({ search_run_id: a.search_run_id });
  const acceptB = session.accept({ search_run_id: b.search_run_id });
  const acceptC = session.accept({ search_run_id: c.search_run_id });

  session.settle({ search_run_id: c.search_run_id });

  let uiQualified = -1;
  let uiRun: string | null = null;
  const apply = (response: {
    search_run_id?: string | null;
    qualified_count?: number;
  }) =>
    session.applyIfActive(response, (run) => {
      uiQualified = response.qualified_count ?? 0;
      uiRun = run.search_run_id;
      return true;
    });

  const applyA = ra.ok
    ? apply({
        search_run_id: ra.r.search_run_id,
        qualified_count: ra.r.qualified_count,
      })
    : { applied: false as const, decision: acceptA };
  const applyB = rb.ok
    ? apply({
        search_run_id: rb.r.search_run_id,
        qualified_count: rb.r.qualified_count,
      })
    : { applied: false as const, decision: acceptB };
  const applyC = rc.ok
    ? apply({
        search_run_id: rc.r.search_run_id,
        qualified_count: rc.r.qualified_count,
      })
    : { applied: false as const, decision: acceptC };

  return {
    id: "CANCEL",
    set: "cancel",
    label: "A slow → B → C race",
    env: envDiag,
    runs: {
      A: a.search_run_id,
      B: b.search_run_id,
      C: c.search_run_id,
      active_final: session.activeRunId,
    },
    accept: { A: acceptA, B: acceptB, C: acceptC },
    apply: {
      A: applyA.applied,
      B: applyB.applied,
      C: applyC.applied,
      ui_qualified_after: uiQualified,
      ui_run: uiRun,
    },
    results: {
      A: ra.ok
        ? {
            outcome: ra.r.outcome,
            qualified: ra.r.qualified_count,
            run: ra.r.search_run_id,
            superseded: session.wasSuperseded(a.search_run_id),
          }
        : {
            error: ra.err,
            superseded: session.wasSuperseded(a.search_run_id),
          },
      B: rb.ok
        ? {
            outcome: rb.r.outcome,
            qualified: rb.r.qualified_count,
            run: rb.r.search_run_id,
            superseded: session.wasSuperseded(b.search_run_id),
          }
        : {
            error: rb.err,
            superseded: session.wasSuperseded(b.search_run_id),
          },
      C: rc.ok
        ? {
            outcome: rc.r.outcome,
            qualified: rc.r.qualified_count,
            run: rc.r.search_run_id,
            superseded: session.wasSuperseded(c.search_run_id),
          }
        : {
            error: rc.err,
            superseded: session.wasSuperseded(c.search_run_id),
          },
    },
    proof: {
      A_must_not_accept: acceptA.ok === false,
      B_must_not_accept: acceptB.ok === false,
      C_may_accept: acceptC.ok === true,
      A_must_not_apply: applyA.applied === false,
      B_must_not_apply: applyB.applied === false,
      C_may_apply: applyC.applied === true,
      ui_held_to_C: uiRun === c.search_run_id || uiRun === null,
      note: "Late A/B responses must not mutate UI via accept/applyIfActive",
    },
  };
}

'''
p.write_text(text[:start] + new + text[end:], encoding="utf-8")
print("patched", start, end)
