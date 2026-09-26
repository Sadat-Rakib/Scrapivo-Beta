/**
 * DB-first people source — reads data/people_complete.jsonl (YC site harvest
 * today; user CSV imports land here too via scripts/pipeline/run_csv_import.py).
 *
 * Strict quality gate: handle-like names ("Ayushii06") and signal-less rows
 * never leave this module — a sparse directory must not degrade results.
 * Every served row is provenance-marked via why_match.
 */
import { existsSync, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { PersonRow } from "@/lib/search/lead-segments";
import type { Lead } from "@/lib/scoring";

export type PersonFileRecord = {
  source: string;
  registry_id: string;
  name: string;
  name_normalized?: string;
  role?: string | null;
  company?: string | null;
  company_domain?: string | null;
  location?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
  confidence?: number;
  source_tier?: string;
  evidence?: string[];
};

export type PeopleQuery = {
  query: string;
  role?: string | null;
  location?: string | null;
  limit?: number;
};

const DATA_DIRS = [resolve(process.cwd(), "data"), resolve(process.cwd(), "../data")];

function findFile(): string | null {
  for (const dir of DATA_DIRS) {
    const p = join(dir, "people_complete.jsonl");
    if (existsSync(p)) return p;
  }
  return null;
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !/^(the|and|for|with|that|have|has|from|find|me|my|are|was|were|who|which|people|person|founders?|need|want|soon|asap|now)$/.test(
          w,
        ),
    );
}

/** Real-looking human name: first + last, letters only. Handles kill junk. */
function isRealName(name: string): boolean {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[A-Za-z][A-Za-z'.-]*$/.test(p));
}

/** Quality gate: real name + at least 2 of role/company/email/linkedin. */
export function passesPeopleQualityGate(rec: PersonFileRecord): boolean {
  if (!rec?.registry_id || !isRealName(rec.name ?? "")) return false;
  const signals = [rec.role, rec.company, rec.email, rec.linkedin].filter(
    (v) => typeof v === "string" && v.trim().length > 0,
  ).length;
  return signals >= 2;
}

function locationMatches(rec: PersonFileRecord, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = `${rec.location ?? ""}`.toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

function rowToPerson(rec: PersonFileRecord, score: number): PersonRow {
  const email = rec.email?.trim() || undefined;
  const link = rec.linkedin?.trim() || rec.website?.trim() || "";
  const lead: Lead = {
    source: "people_db",
    platform: "People directory",
    title: rec.company ? `${rec.name} — ${rec.company}` : rec.name,
    snippet: rec.bio?.slice(0, 160) || [rec.role, rec.company].filter(Boolean).join(" at ") || rec.name,
    full_post_url: link,
    author: rec.name,
    posted_at: undefined,
    score,
    match_reasons: ["People directory match"],
    ...(email ? { inline_contacts: { emails: [email], phones: [], links: [] as string[] } } : {}),
  };
  return {
    key: `people:${rec.source}:${rec.registry_id}`,
    name: rec.name,
    title_hint: rec.role ?? undefined,
    role_hint: rec.role ?? undefined,
    company_hint: rec.company ?? undefined,
    company_domain: rec.company_domain ?? undefined,
    location_hint: rec.location ?? undefined,
    linkedin_url: rec.linkedin ?? undefined,
    description: lead.snippet,
    why_match: `People directory${rec.company ? ` · ${rec.company}` : ""}`,
    sample_url: link,
    signal_count: 1,
    ...(email ? { inline_contacts: { emails: [email], phones: [], links: [] as string[] } } : {}),
    lead,
    score,
  };
}

/** Stream-scan the people DB. Role/location narrow when present. */
export async function searchCompletePeople(q: PeopleQuery): Promise<PersonRow[]> {
  const path = findFile();
  if (!path) return [];
  const limit = q.limit ?? 24;
  const qTokens = tokenize(q.query);
  const locTokens = tokenize(q.location ?? "");
  const roleNeedle = (q.role ?? "").trim().toLowerCase();
  const out: PersonRow[] = [];

  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    let rec: PersonFileRecord;
    try {
      rec = JSON.parse(s) as PersonFileRecord;
    } catch {
      continue;
    }
    if (!passesPeopleQualityGate(rec)) continue;
    if (!locationMatches(rec, locTokens)) continue;
    if (
      roleNeedle &&
      !`${rec.role ?? ""} ${rec.bio ?? ""}`.toLowerCase().includes(roleNeedle)
    )
      continue;
    let score = rec.confidence ?? 50;
    if (qTokens.length) {
      const hay = `${rec.name} ${rec.role ?? ""} ${rec.company ?? ""} ${rec.bio ?? ""}`.toLowerCase();
      const hits = qTokens.filter((t) => hay.includes(t)).length;
      if (!hits) continue;
      score += Math.min(20, hits * 8);
    }
    out.push(rowToPerson(rec, Math.min(98, score)));
    if (out.length >= limit * 4) break;
  }
  rl.close();
  stream.close();

  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}
