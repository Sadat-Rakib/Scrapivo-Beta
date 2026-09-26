/**
 * Production QualifiedLead store — same M10 contract as InMemoryQualifiedLeadStore.
 *
 * Backed by `public.qualified_leads` (migration 20260916000000_qualified_leads).
 * Merge / theorem / event_at rules live in upsertQualifiedLeadAgainstExisting —
 * this file only provides durable get/set.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchRunIds } from "@/lib/search/search-run";
import {
  hydrateQualifiedLead,
  hydratedLeadStillPassesTheorem,
  upsertQualifiedLeadAgainstExisting,
  type PersistOutcome,
  type QualifiedLeadRecord,
  type QualifiedLeadStore,
} from "@/lib/search/qualified-lead-persist";
import {
  leadKeyOf,
  projectQualifiedLead,
  qualifiedLeadKey,
  type QualifiedLead,
} from "@/lib/search/qualified-lead";

type QlRow = {
  lead_key: string;
  record: QualifiedLeadRecord;
};

function rowToRecord(row: QlRow | null | undefined): QualifiedLeadRecord | null {
  if (!row?.record) return null;
  return row.record as QualifiedLeadRecord;
}

export class SupabaseQualifiedLeadStore implements QualifiedLeadStore {
  constructor(private readonly db: SupabaseClient) {}

  async clear(): Promise<void> {
    // Test-only: wipe soak keys prefixed for isolation when needed.
    const { error } = await this.db
      .from("qualified_leads")
      .delete()
      .like("lead_key", "test:%");
    if (error) throw new Error(`[qualified_leads] clear: ${error.message}`);
  }

  async size(): Promise<number> {
    const { count, error } = await this.db
      .from("qualified_leads")
      .select("lead_key", { count: "exact", head: true });
    if (error) throw new Error(`[qualified_leads] size: ${error.message}`);
    return count ?? 0;
  }

  async getRecord(key: string): Promise<QualifiedLeadRecord | null> {
    const { data, error } = await this.db
      .from("qualified_leads")
      .select("lead_key, record")
      .eq("lead_key", key)
      .maybeSingle();
    if (error) throw new Error(`[qualified_leads] getRecord: ${error.message}`);
    return rowToRecord(data as QlRow | null);
  }

  private async writeRecord(
    key: string,
    record: QualifiedLeadRecord,
  ): Promise<void> {
    const payload = {
      lead_key: key,
      entity_id: record.entity_id,
      entity_type: record.entity_type,
      claim_type: record.claim_type,
      name: record.name,
      record,
      search_run_id: record.search_run_id,
      conversation_id: record.conversation_id,
      turn_id: record.turn_id,
      request_id: record.request_id,
      location_id: record.location_id,
      qualified_at: record.qualified_at,
      persisted_at: record.persisted_at,
      updated_at: record.updated_at,
    };
    const { error } = await this.db.from("qualified_leads").upsert(payload, {
      onConflict: "lead_key",
    });
    if (error) throw new Error(`[qualified_leads] upsert: ${error.message}`);
  }

  async persist(lead: QualifiedLead, nowMs?: number): Promise<PersistOutcome> {
    const key = leadKeyOf(lead);
    const existing = await this.getRecord(key);
    const out = upsertQualifiedLeadAgainstExisting(existing, lead, nowMs);
    if (!out.ok || !out.record) return out;
    await this.writeRecord(key, out.record);
    return { ok: true, key: out.key, lead: out.lead, created: out.created };
  }

  async persistFromRow(args: {
    row: SpecRow;
    spec: SearchSpec;
    run?: Partial<SearchRunIds> | null;
    activeRunId?: string | null;
    cancelled?: boolean;
    nowMs?: number;
  }): Promise<PersistOutcome> {
    const projected = projectQualifiedLead(args);
    if (!projected.ok) return projected;
    return this.persist(projected.lead, args.nowMs);
  }

  async get(
    entityId: string,
    claimType: string,
  ): Promise<QualifiedLead | null> {
    const rec = await this.getRecord(qualifiedLeadKey(entityId, claimType));
    return rec ? hydrateQualifiedLead(rec) : null;
  }

  async getAsQualified(
    entityId: string,
    claimType: string,
  ): Promise<QualifiedLead | null> {
    const lead = await this.get(entityId, claimType);
    if (!lead) return null;
    if (!hydratedLeadStillPassesTheorem(lead)) return null;
    return lead;
  }

  async keys(): Promise<string[]> {
    const { data, error } = await this.db
      .from("qualified_leads")
      .select("lead_key");
    if (error) throw new Error(`[qualified_leads] keys: ${error.message}`);
    return (data ?? []).map((r: { lead_key: string }) => r.lead_key);
  }

  async listQualified(): Promise<QualifiedLead[]> {
    const { data, error } = await this.db
      .from("qualified_leads")
      .select("record");
    if (error) throw new Error(`[qualified_leads] list: ${error.message}`);
    const out: QualifiedLead[] = [];
    for (const row of data ?? []) {
      const rec = (row as { record: QualifiedLeadRecord }).record;
      if (!rec) continue;
      const lead = hydrateQualifiedLead(rec);
      if (hydratedLeadStillPassesTheorem(lead)) out.push(lead);
    }
    return out;
  }
}

import { getAdmin } from "@/integrations/my-supabase/admin.server";

/** Open the production store when Supabase admin env is present. */
export function tryOpenSupabaseQualifiedLeadStore(): SupabaseQualifiedLeadStore | null {
  const url = process.env.MY_SUPABASE_URL?.trim();
  const key = process.env.MY_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return new SupabaseQualifiedLeadStore(getAdmin());
}

export async function openProductionQualifiedLeadStore(): Promise<{
  store: QualifiedLeadStore;
  via: "supabase" | "memory";
}> {
  const prod = tryOpenSupabaseQualifiedLeadStore();
  if (prod) return { store: prod, via: "supabase" };
  const { InMemoryQualifiedLeadStore } = await import(
    "@/lib/search/qualified-lead-persist"
  );
  return { store: new InMemoryQualifiedLeadStore(), via: "memory" };
}
