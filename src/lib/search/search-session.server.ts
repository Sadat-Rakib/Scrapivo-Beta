/**
 * Server-side search session store + spec merge (Phase 5).
 *
 * One structured SearchSpec per chat, keyed by chat id. New messages merge
 * into the stored spec (new stated fields overwrite; unstated fields persist),
 * so "SaaS founders in New York" → "Actually Toronto" updates location only.
 * Intent switch (different entity) resets criteria with transcript preserved
 * by the caller. In-memory with TTL for Phase 1 correctness; a durable
 * table replaces this at scale (documented limitation, not silent).
 */
import {
  buildSpec,
  type SearchSpec,
} from "./search-spec";

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, { spec: SearchSpec; at: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
}

/** Merge a fresh extraction into the previous spec (both same chat). */
export function mergeSpecs(prev: SearchSpec | null, next: SearchSpec): SearchSpec {
  if (!prev) return next;
  // Entity switch (e.g. businesses → founders) resets criteria — the user
  // changed intent; transcript preservation is the caller's job.
  if (next.entity !== "unknown" && next.entity !== prev.entity) {
    return next;
  }
  const entity = next.entity === "unknown" ? prev.entity : next.entity;
  const merged = new Map<string, (typeof next.criteria)[number]>();
  for (const c of prev.criteria) merged.set(c.field, c);
  for (const c of next.criteria) {
    // New stated values win; never let an inference overwrite a stated fact.
    const old = merged.get(c.field);
    if (!old || c.stated || !old.stated) merged.set(c.field, c);
  }
  return buildSpec({
    entity,
    criteria: [...merged.values()],
    signal_required: next.signal_required || prev.signal_required,
    signal_types: [...new Set([...prev.signal_types, ...next.signal_types])],
    signal_recency: next.signal_recency ?? prev.signal_recency,
    raw_query: next.raw_query,
  });
}

export function getSessionSpec(chatId: string): SearchSpec | null {
  sweep();
  return store.get(chatId)?.spec ?? null;
}

export function putSessionSpec(chatId: string, spec: SearchSpec): SearchSpec {
  sweep();
  store.set(chatId, { spec, at: Date.now() });
  return spec;
}

/** Extract → merge with stored spec → persist. Returns the active spec. */
export function advanceSession(
  chatId: string,
  fresh: SearchSpec,
): { spec: SearchSpec; switched: boolean } {
  const prev = getSessionSpec(chatId);
  const switched =
    !!prev && fresh.entity !== "unknown" && fresh.entity !== prev.entity;
  const spec = mergeSpecs(prev, fresh);
  putSessionSpec(chatId, spec);
  return { spec, switched };
}
