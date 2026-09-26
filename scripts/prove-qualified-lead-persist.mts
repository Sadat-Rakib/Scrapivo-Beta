/**
 * Apply qualified_leads migration via Supabase JS if possible, then prove
 * production persist round-trip.
 *
 * Run: npx tsx --env-file=.env scripts/prove-qualified-lead-persist.mts
 *
 * Requires MY_SUPABASE_URL + MY_SUPABASE_SERVICE_ROLE_KEY.
 * DDL: uses the service-role PostgREST only for DML; for CREATE TABLE, tries
 * the Supabase SQL API when SUPABASE_ACCESS_TOKEN is set, otherwise prints
 * the migration path to apply manually once.
 */
import "./_env.mts";
import { readFileSync } from "node:fs";
import { getAdmin } from "../src/integrations/my-supabase/admin.server.ts";
import { extractSearchSpec } from "../src/lib/search/search-spec-extract.ts";
import { createSearchRun } from "../src/lib/search/search-run.ts";
import {
  hydrateQualifiedLead,
  hydratedLeadStillPassesTheorem,
  persistQualifiedLead,
  semanticEqual,
} from "../src/lib/search/qualified-lead-persist.ts";
import { leadKeyOf } from "../src/lib/search/qualified-lead.ts";
import { SupabaseQualifiedLeadStore } from "../src/lib/search/qualified-lead-store.server.ts";
import type { SpecRow } from "../src/lib/spec-search.functions.ts";
import type { Evidence } from "../src/lib/search/evidence.ts";

const NOW = Date.now();
const PREFIX = `prove:ql:${NOW}`;

async function tableExists(db: ReturnType<typeof getAdmin>): Promise<boolean> {
  const { error } = await db.from("qualified_leads").select("lead_key").limit(1);
  if (!error) return true;
  const msg = error.message ?? "";
  if (/does not exist|Could not find|schema cache|PGRST/i.test(msg)) return false;
  // Other errors (RLS, etc.) still mean the relation is there.
  console.warn("[prove] unexpected probe error (treating as present):", msg);
  return true;
}

async function tryApplyMigration(): Promise<"applied" | "manual" | "already"> {
  const db = getAdmin();
  if (await tableExists(db)) return "already";

  const sql = readFileSync(
    "supabase/migrations/20260916000000_qualified_leads.sql",
    "utf8",
  );
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectRef = (process.env.MY_SUPABASE_URL ?? "")
    .replace(/^https:\/\//, "")
    .split(".")[0];

  if (token && projectRef) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    if (res.ok) {
      console.info("[prove] migration applied via Management API");
      return "applied";
    }
    console.warn(
      "[prove] Management API apply failed:",
      res.status,
      await res.text(),
    );
  }

  console.error(
    [
      "",
      "qualified_leads table is missing.",
      "Apply once, then re-run this script:",
      "  supabase/migrations/20260916000000_qualified_leads.sql",
      "",
      "Or set SUPABASE_ACCESS_TOKEN (personal access token) so this script can apply it.",
      "",
    ].join("\n"),
  );
  return "manual";
}

function hiringRow(entity_id: string): SpecRow {
  const evidence: Evidence[] = [
    {
      source_url: "https://acme.example/jobs/react",
      source_type: "job_posting",
      excerpt: "Hiring senior React developers in Austin",
      observed_at: new Date(NOW).toISOString(),
      evidence_type: "hiring",
      supports: "intent",
      confidence: 0.9,
      subject: entity_id,
      event_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      claim_parameters: { technology: "React", role: "developer" },
    },
  ];
  return {
    key: entity_id,
    entity_id,
    kind: "company",
    title: "Acme Prove Co",
    url: "https://acme.example",
    location: "Austin",
    country: "US",
    disposition: "qualified",
    entity_resolved: true,
    evidence,
    email: "jobs@acme.example",
  } as SpecRow;
}

async function main() {
  if (!process.env.MY_SUPABASE_URL || !process.env.MY_SUPABASE_SERVICE_ROLE_KEY) {
    console.error("MY_SUPABASE_URL / MY_SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  const apply = await tryApplyMigration();
  if (apply === "manual") process.exit(2);

  const db = getAdmin();
  // Refresh schema cache hint — noop select
  await db.from("qualified_leads").select("lead_key").limit(1);

  const store = new SupabaseQualifiedLeadStore(db);
  const entity_id = `${PREFIX}:company:acme`;
  const spec = extractSearchSpec(
    "companies hiring senior React developers in Austin",
  );
  const run = createSearchRun({
    search_run_id: `run_${PREFIX}`,
    conversation_id: `conv_${PREFIX}`,
  });

  const first = await persistQualifiedLead(store, {
    row: hiringRow(entity_id),
    spec,
    run,
    nowMs: NOW,
  });
  if (!first.ok) {
    console.error("persist failed", first);
    process.exit(1);
  }
  console.info("created", first.created, "key", first.key);

  const again = await persistQualifiedLead(store, {
    row: hiringRow(entity_id),
    spec,
    run: createSearchRun({ search_run_id: `run2_${PREFIX}` }),
    nowMs: NOW + 1000,
  });
  if (!again.ok || again.created) {
    console.error("idempotency failed", again);
    process.exit(1);
  }
  console.info("idempotent ok, run preserved", again.lead.search_run_id);

  // Round-trip the post-merge record (idempotent write), not the first insert —
  // request_id / updated_at move on merge by design.
  const rec = await store.getRecord(leadKeyOf(again.lead));
  if (!rec) {
    console.error("getRecord miss");
    process.exit(1);
  }
  const hydrated = hydrateQualifiedLead(rec);
  const equal = semanticEqual(again.lead, {
    ...hydrated,
    persisted_at: again.lead.persisted_at,
    updated_at: again.lead.updated_at,
  });
  const theorem = hydratedLeadStillPassesTheorem(hydrated);
  console.info("semanticEqual", equal, "theorem", theorem);
  if (!equal || !theorem) {
    console.error("round-trip mismatch", {
      equal,
      theorem,
      first_run: first.lead.search_run_id,
      again_run: again.lead.search_run_id,
      hydrated_run: hydrated.search_run_id,
      again_request: again.lead.request_id,
      hydrated_request: hydrated.request_id,
      evidence_lens: [again.lead.evidence.length, hydrated.evidence.length],
    });
    process.exit(1);
  }

  // Multi-claim: same entity, different claim_type → second row
  const fundEntity = entity_id;
  const fundSpec = extractSearchSpec("companies that raised funding in Austin");
  const fundEvidence: Evidence[] = [
    {
      source_url: "https://news.example/acme-series-a",
      source_type: "news",
      excerpt: "Acme raises Series A",
      observed_at: new Date(NOW).toISOString(),
      evidence_type: "funding",
      supports: "intent",
      confidence: 0.9,
      subject: fundEntity,
      event_at: new Date(NOW - 5 * 86_400_000).toISOString(),
    },
  ];
  const fundRow = {
    ...hiringRow(fundEntity),
    evidence: fundEvidence,
    disposition: "qualified" as const,
  };
  const fund = await persistQualifiedLead(store, {
    row: fundRow,
    spec: fundSpec,
    run,
    nowMs: NOW + 2000,
  });
  if (!fund.ok || !fund.created) {
    console.error("multi-claim persist failed", fund);
    process.exit(1);
  }
  const keys = await store.keys();
  const ours = keys.filter((k) => k.includes(PREFIX));
  if (ours.length < 2) {
    console.error("expected ≥2 claims for entity, got", ours);
    process.exit(1);
  }
  console.info("multi-claim ok", ours.length, "rows");

  // event_at freeze: re-persist with a different event_at for same URL+type
  const frozen = hydrated.evidence[0]?.event_at;
  const mutated = hiringRow(entity_id);
  if (mutated.evidence?.[0]) {
    mutated.evidence[0] = {
      ...mutated.evidence[0],
      event_at: new Date(NOW - 90 * 86_400_000).toISOString(),
      observed_at: new Date(NOW + 5000).toISOString(),
    };
  }
  const freeze = await persistQualifiedLead(store, {
    row: mutated,
    spec,
    run,
    nowMs: NOW + 5000,
  });
  if (!freeze.ok) {
    console.error("event_at re-persist failed", freeze);
    process.exit(1);
  }
  const kept = freeze.lead.evidence.find(
    (e) => e.evidence_url === "https://acme.example/jobs/react",
  )?.event_at;
  if (!frozen || kept !== frozen) {
    console.error("event_at not frozen", { frozen, kept });
    process.exit(1);
  }
  console.info("event_at frozen", frozen);

  // cleanup
  for (const k of ours) {
    await db.from("qualified_leads").delete().eq("lead_key", k);
  }
  console.info("PROVE_OK via=supabase");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
