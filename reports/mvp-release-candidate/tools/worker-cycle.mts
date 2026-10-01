// Worker launch stress: create → close(retain) → close, N times, against the
// running local worker (`npm run worker:local`), like a UI run followed by
// "Close browser" and the next search. Prints only ok/failed codes.
//   $env:CYCLE_ROUNDS='12'; $env:CYCLE_VISIBLE='1'; npx tsx reports/mvp-release-candidate/tools/worker-cycle.mts
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
if (existsSync(".env")) loadEnvFile(".env");
const { callBrowserWorker } = await import("../../../src/lib/research-agent/browser-worker-client.server");
type Session = { id: string; status: string };
const ownerId = "local-mvp-cycle-probe";
const results: Array<Record<string, unknown>> = [];
const rounds = Number(process.env.CYCLE_ROUNDS ?? 4);
for (let round = 1; round <= rounds; round++) {
  const visible = process.env.CYCLE_VISIBLE === "1" ? true : round % 2 === 0;
  const started = Date.now();
  try {
    const session = await callBrowserWorker<Session>("POST", "/browser/sessions", { ownerId, runKey: `cycle-${Date.now()}-${round}`, visible }, { timeoutMs: 60_000 });
    const createdMs = Date.now() - started;
    await callBrowserWorker("POST", `/browser/sessions/${session.id}/close`, { ownerId, retain: true }, { timeoutMs: 15_000 });
    await callBrowserWorker("POST", `/browser/sessions/${session.id}/close`, { ownerId, retain: false }, { timeoutMs: 15_000 });
    results.push({ round, visible, ok: true, createdMs });
  } catch (error) {
    results.push({ round, visible, ok: false, code: (error as { code?: string }).code ?? "?", ms: Date.now() - started });
  }
}
console.log(JSON.stringify(results));
