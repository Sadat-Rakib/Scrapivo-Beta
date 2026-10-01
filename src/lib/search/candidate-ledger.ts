/**
 * Candidate survival ledger. Every candidate that reaches the delivery funnel
 * ends in exactly one fate with a reason, and every lead streamed to the user
 * while researching is reconciled against the final page. A streamed lead that
 * is neither delivered nor explained is `unaccounted` — a real loss.
 *
 * Pure bookkeeping: it never changes which rows are delivered.
 */

export type CandidateFate =
  /** On the delivered page. */
  | "returned"
  /** Qualified, beyond this page (load more). */
  | "qualified_more"
  /** Qualification rejected it (reject code as reason). */
  | "rejected"
  /** Qualified by the lead check, dropped by the final why-match/signal gate. */
  | "gated"
  /** A stated criterion (category, role, location…) is contradicted or still unproven after research. */
  | "filtered"
  /** Required fields still missing after enrichment. */
  | "incomplete"
  /** Held back because an earlier pass of the same job already delivered it. */
  | "excluded"
  /** Streamed while researching, never seen again by the funnel. */
  | "unaccounted";

export type LedgerRow = {
  key?: string | null;
  entity_id?: string | null;
  title?: string | null;
  company?: string | null;
  website_url?: string | null;
  profile_url?: string | null;
  missingFields?: string[];
};

export type StreamedReconciliation = { key: string; title: string; fate: CandidateFate; reason: string | null };

/** C6: did every candidate that entered the funnel end in exactly one fate? */
export type CandidateAccounting = {
  /** Distinct candidates that entered the funnel (via streamed() or retrieved()). */
  retrieved: number;
  /** Entries holding a fate. A streamed entry is born fated `unaccounted`; a
   *  retrieved-only entry is a stub awaiting a funnel booking. */
  fated: number;
  unaccounted: number;
  ok: boolean;
};

export type CandidateLedgerSummary = {
  counts: Record<CandidateFate, number>;
  /** Reject code → count for `rejected`. */
  rejectReasons: Record<string, number>;
  streamed: number;
  /** Streamed leads that are not on the delivered page, each with its fate. */
  streamedNotReturned: StreamedReconciliation[];
  accounting?: CandidateAccounting;
};

const FATES: CandidateFate[] = ["returned", "qualified_more", "rejected", "gated", "filtered", "incomplete", "excluded", "unaccounted"];
// Later stages win, except that nothing downgrades a delivered row.
const RANK: Record<CandidateFate, number> = { unaccounted: 0, incomplete: 1, filtered: 2, rejected: 3, gated: 4, excluded: 5, qualified_more: 6, returned: 7 };

const norm = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Cheap registrable domain (last two labels) — enough to bind www-stripped hosts. */
function registrableHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const labels = host.split(".").filter(Boolean);
    return labels.length >= 2 ? labels.slice(-2).join(".") : host || null;
  } catch {
    return null;
  }
}

/** Identity tokens: a DB/live merge can change the key but not the entity.
 *  A re-minted entity_id still binds through registrable host + name. */
function identities(row: LedgerRow): string[] {
  const tokens = [row.key, row.entity_id].filter((value): value is string => !!value).map((value) => `id:${value}`);
  const title = norm(row.title);
  if (title) tokens.push(`name:${title}|${norm(row.company)}`);
  const host = registrableHost(row.website_url) ?? registrableHost(row.profile_url);
  if (host && title) tokens.push(`host:${host}|name:${title}`);
  return tokens;
}

export function createCandidateLedger() {
  type Entry = { key: string; title: string; fate: CandidateFate; reason: string | null; streamed: boolean; fated: boolean; ids: string[] };
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();

  const find = (row: LedgerRow) => {
    for (const id of identities(row)) {
      const hit = byId.get(id);
      if (hit) return hit;
    }
    return undefined;
  };
  const upsert = (row: LedgerRow, fate: CandidateFate, reason: string | null, streamed = false) => {
    let entry = find(row);
    if (!entry) {
      entry = { key: row.key ?? row.entity_id ?? norm(row.title), title: row.title ?? "", fate, reason, streamed, fated: true, ids: [] };
      entries.push(entry);
    } else if (fate !== "unaccounted" && (RANK[fate] >= RANK[entry.fate] || entry.fate === "unaccounted") && entry.fate !== "returned") {
      entry.fate = fate;
      entry.reason = reason;
    }
    entry.streamed ||= streamed;
    // Any explicit fate booking (even a duplicate of the current one) marks
    // the entry as fated; only retrieved()-born stubs stay unfated.
    entry.fated = true;
    for (const id of identities(row)) {
      if (!byId.has(id)) byId.set(id, entry);
      if (!entry.ids.includes(id)) entry.ids.push(id);
    }
    return entry;
  };

  return {
    /** A lead shown to the user while researching. */
    streamed(row: LedgerRow) { upsert(row, "unaccounted", null, true); },
    /**
     * A candidate that entered the funnel without streaming (DB/index rows
     * filtered before any stage, merge outputs). Books the entry as a stub
     * awaiting a fate so summary().accounting can prove no candidate leaked.
     */
    retrieved(row: LedgerRow) {
      if (!find(row)) {
        const entry: Entry = { key: row.key ?? row.entity_id ?? norm(row.title), title: row.title ?? "", fate: "unaccounted", reason: null, streamed: false, fated: false, ids: [] };
        entries.push(entry);
        for (const id of identities(row)) {
          if (!byId.has(id)) byId.set(id, entry);
          if (!entry.ids.includes(id)) entry.ids.push(id);
        }
      }
    },
    /** Final lead-check decision for a complete candidate. */
    decided(row: LedgerRow, decision: { disposition: string; reject_code?: string | null }) {
      if (decision.disposition === "qualified") return;
      upsert(row, "rejected", decision.reject_code ?? "NOT_QUALIFIED");
    },
    /** Qualified by the lead check but not kept by the final gate. */
    gated(row: LedgerRow, reason = "WHY_MATCH_GATE") {
      const entry = find(row);
      if (entry && entry.fate === "rejected") return;
      upsert(row, "gated", reason);
    },
    incomplete(row: LedgerRow) { upsert(row, "incomplete", row.missingFields?.length ? `missing: ${row.missingFields.join(", ")}` : "missing required fields"); },
    /** Dropped by the spec judge: a stated criterion is contradicted or unproven. */
    filtered(row: LedgerRow, reason = "SPEC_MISMATCH") { upsert(row, "filtered", reason); },
    excluded(row: LedgerRow) { upsert(row, "excluded", "ALREADY_DELIVERED_IN_JOB"); },
    delivered(page: LedgerRow[], rest: LedgerRow[]) {
      for (const row of rest) upsert(row, "qualified_more", null);
      for (const row of page) upsert(row, "returned", null);
    },
    summary(): CandidateLedgerSummary {
      const counts = Object.fromEntries(FATES.map((fate) => [fate, 0])) as Record<CandidateFate, number>;
      const rejectReasons: Record<string, number> = {};
      for (const entry of entries) {
        counts[entry.fate] += 1;
        if (entry.fate === "rejected" && entry.reason) rejectReasons[entry.reason] = (rejectReasons[entry.reason] ?? 0) + 1;
      }
      const streamed = entries.filter((entry) => entry.streamed);
      const retrieved = entries.length;
      // Streamed entries are born fated (unaccounted until booked); only
      // retrieved()-born stubs awaiting a funnel booking stay unfated. A
      // stub is internal accounting, not a user-facing unaccounted loss.
      const fated = entries.filter((entry) => entry.fated).length;
      const unaccounted = entries.filter((entry) => entry.streamed && entry.fate === "unaccounted").length;
      return {
        counts,
        rejectReasons,
        streamed: streamed.length,
        streamedNotReturned: streamed.filter((entry) => entry.fate !== "returned")
          .map(({ key, title, fate, reason }) => ({ key, title, fate, reason })),
        accounting: { retrieved, fated, unaccounted, ok: retrieved === fated && unaccounted === 0 },
      };
    },
  };
}

export type CandidateLedger = ReturnType<typeof createCandidateLedger>;

/** Combine per-location branch ledgers; a streamed lead delivered by any branch is not missing. */
export function mergeCandidateLedgers(summaries: Array<CandidateLedgerSummary | undefined>, delivered: LedgerRow[]): CandidateLedgerSummary | undefined {
  const present = summaries.filter((summary): summary is CandidateLedgerSummary => !!summary);
  if (!present.length) return undefined;
  const counts = Object.fromEntries(FATES.map((fate) => [fate, present.reduce((sum, summary) => sum + (summary.counts[fate] ?? 0), 0)])) as Record<CandidateFate, number>;
  const rejectReasons: Record<string, number> = {};
  for (const summary of present) for (const [code, count] of Object.entries(summary.rejectReasons)) rejectReasons[code] = (rejectReasons[code] ?? 0) + count;
  const deliveredIds = new Set(delivered.flatMap(identities));
  const seen = new Set<string>();
  const streamedNotReturned = present.flatMap((summary) => summary.streamedNotReturned).filter((item) => {
    const ids = identities({ key: item.key, title: item.title });
    if (ids.some((id) => deliveredIds.has(id)) || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  const accountingParts = present.map((summary) => summary.accounting).filter((a): a is NonNullable<CandidateLedgerSummary["accounting"]> => !!a);
  const accounting = accountingParts.length
    ? {
        retrieved: accountingParts.reduce((sum, a) => sum + a.retrieved, 0),
        fated: accountingParts.reduce((sum, a) => sum + a.fated, 0),
        unaccounted: accountingParts.reduce((sum, a) => sum + a.unaccounted, 0),
        ok: false,
      }
    : undefined;
  if (accounting) accounting.ok = accounting.retrieved === accounting.fated && accounting.unaccounted === 0;
  return { counts, rejectReasons, streamed: present.reduce((sum, summary) => sum + summary.streamed, 0), streamedNotReturned, accounting };
}

/** Short, user-facing explanation for a streamed lead missing from the final list. */
export function streamedFateLabel(item: Pick<StreamedReconciliation, "fate" | "reason">): string {
  switch (item.fate) {
    case "qualified_more": return "on the next page";
    case "rejected": return item.reason === "MISSING_QUERY_REQUIRED" ? "missing a detail you asked for" : "did not pass the final checks";
    case "gated": return item.reason === "SIGNAL_NOT_VERIFIED" ? "no verified signal found" : "did not pass the final checks";
    case "filtered": return "did not match every part of your request";
    case "incomplete": return "still missing required details";
    case "excluded": return "already delivered earlier";
    case "unaccounted": return "could not be confirmed";
    default: return "not in the final list";
  }
}
