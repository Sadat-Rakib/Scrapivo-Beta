/**
 * Watch thesis compilation (Workstream 5). Design FROZEN.
 *
 * A watch's thesis is its frozen compiled SearchSpec — compiled ONCE and
 * reused every run until the project context version changes. This module
 * uses the DETERMINISTIC compiler on purpose: cron safety means no LLM in
 * the scheduled path. It is the same frameToSearchSpec compiler the
 * interactive path uses (understanding/to-search-spec.ts) — only the frame
 * source differs (deterministic fallback frame instead of the LLM frame).
 * Consequence: a watch thesis may be slightly coarser than the interactive
 * reading of the same query, but it is stable, replayable, and offline-safe.
 *
 * Project context is merged exactly like the interactive path: resolved
 * project + global layers fill ONLY the gaps the query left open
 * (applySpecOverrides never overrides stated=true criteria).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchSpec } from "@/lib/search/search-spec";
import { frameToSearchSpec } from "@/lib/understanding/to-search-spec";
import { extractFrameDeterministic } from "@/lib/understanding/fallback";
import { validateFrame } from "@/lib/understanding/validate";
import { resolveContext, applySpecOverrides, type ContextLayer } from "@/lib/projects/context-resolver";
import { loadGlobalDefaults } from "@/lib/projects/global-defaults";

export interface CompiledThesis {
  spec: SearchSpec;
  /** project_context.context_version at compile time (null without a project). */
  contextVersion: number | null;
}

/** Pure, offline, cron-safe: query → SearchSpec via the deterministic frame. */
export function compileThesisDeterministic(query: string): SearchSpec {
  const frame = validateFrame(extractFrameDeterministic(query)).frame;
  return frameToSearchSpec(frame);
}

/** Map a project_context row into a resolver layer (missing keys stay absent). */
function projectContextToLayer(row: Record<string, unknown>): ContextLayer {
  const firstGeo = (listOf(row.preferred_geographies)[0] ?? null) as string | null;
  return {
    geography: firstGeo,
    exclusions: listOf(row.exclusions),
    signals: listOf(row.preferred_signals),
    offer: isObject(row.offer_profile) ? (row.offer_profile as Record<string, unknown>) : null,
    messaging: isObject(row.messaging_preferences)
      ? (row.messaging_preferences as Record<string, unknown>)
      : null,
    custom: isObject(row.custom_context) ? (row.custom_context as Record<string, unknown>) : null,
  };
}

function listOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Compile a watch thesis with project + global context. Ownership is verified
 * here (projects row must belong to userId) — a foreign projectId silently
 * degrades to "no project context" instead of leaking another user's context.
 * Context loads are best-effort: a missing context layer never blocks the
 * thesis; the explicit query is always searchable on its own.
 */
export async function compileThesis(
  client: SupabaseClient,
  userId: string,
  query: string,
  projectId: string | null,
): Promise<CompiledThesis> {
  const spec = compileThesisDeterministic(query);
  if (!projectId) return { spec, contextVersion: null };

  let projectLayer: ContextLayer | null = null;
  let contextVersion: number | null = null;
  try {
    const { data: proj } = await client
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (proj) {
      const { data: ctxRow } = await client
        .from("project_context")
        .select(
          "context_version, offer_profile, preferred_geographies, exclusions, preferred_signals, messaging_preferences, custom_context",
        )
        .eq("project_id", projectId)
        .maybeSingle();
      if (ctxRow) {
        contextVersion =
          typeof ctxRow.context_version === "number" ? ctxRow.context_version : null;
        projectLayer = projectContextToLayer(ctxRow as Record<string, unknown>);
      }
    }
  } catch {
    // best-effort — compile from the query alone
  }

  let globalLayer: ContextLayer | null = null;
  try {
    globalLayer = await loadGlobalDefaults(client, userId);
  } catch {
    // best-effort — no global layer available
  }

  const resolved = resolveContext({ explicit: null, project: projectLayer, global: globalLayer });
  // SpecLike/index-signature friction: assert through the resolver's structural
  // type, then back to SearchSpec (applySpecOverrides only appends criteria).
  const merged = applySpecOverrides({ ...spec } as Parameters<typeof applySpecOverrides>[0], resolved.resolved);
  return { spec: merged as unknown as SearchSpec, contextVersion };
}
