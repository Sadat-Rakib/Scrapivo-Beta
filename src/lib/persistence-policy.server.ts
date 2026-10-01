/**
 * Local no-persist policy for MVP acceptance runs.
 *
 * Local harnesses and the local dev server share the service-role Supabase
 * credentials in `.env`, which point at a production-backed project. Setting
 * SCRAPIVO_LOCAL_NO_PERSIST=true turns automatic search side effects
 * (history, canonical write-back, qualified leads, source health/yield, ATS
 * queues, AI cache, domain memory) into no-ops. Reads keep working.
 *
 * Fail-safe: the flag is ignored in any production runtime (NODE_ENV=production,
 * or any Vercel environment), so it can never disable real persistence.
 */

let warnedIgnored = false;
const announced = new Set<string>();
const pending = new Set<string>();

function isProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || !!env.VERCEL?.trim() || !!env.VERCEL_ENV?.trim();
}

/** True only when the flag is exactly "true" and the runtime is not production. */
export function localNoPersistActive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SCRAPIVO_LOCAL_NO_PERSIST?.trim().toLowerCase() !== "true") return false;
  if (isProductionRuntime(env)) {
    if (!warnedIgnored) {
      warnedIgnored = true;
      console.warn("[persistence] SCRAPIVO_LOCAL_NO_PERSIST ignored in a production runtime");
    }
    return false;
  }
  return true;
}

/**
 * Call at a write site with the table/side-effect name. Returns true when the
 * write must be skipped. Logs one sanitized line per target per process and
 * records the target for the per-run summary.
 */
export function skipPersistence(target: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!localNoPersistActive(env)) return false;
  pending.add(target);
  if (!announced.has(target)) {
    announced.add(target);
    console.info(`[persistence] local no-persist active: skipped ${target}`);
  }
  return true;
}

/** Targets skipped since the last drain, in first-seen order. */
export function drainSkippedPersistence(): string[] {
  const out = [...pending];
  pending.clear();
  return out;
}

export function __resetPersistencePolicyForTests(): void {
  warnedIgnored = false;
  announced.clear();
  pending.clear();
}
