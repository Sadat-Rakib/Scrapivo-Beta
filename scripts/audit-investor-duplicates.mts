/**
 * Investor duplicates audit — finds duplicate clusters across ALL 7,645+
 * records using multiple signals, and writes a human-reviewable report.
 *
 * NOTHING is removed by this script. It only reports. After you edit the
 * `decision` block inside the JSON report, run with --apply to merge/drop:
 *
 *   npx tsx scripts/audit-investor-duplicates.mts            # generate report
 *   npx tsx scripts/audit-investor-duplicates.mts --apply    # apply your decisions
 *
 * Match signals:
 *   1. normalized name   ("2AM Ventures" == "2AM  ventures!")
 *   2. website domain    (www.acme.com == acme.com/)
 *   3. email             (exact, lowercased)
 *   4. linkedin slug     (/company/acme-vc == linkedin.com/company/acme_vc)
 *   5. fuzzy name        (Dice bigram ≥ 0.92 + shared token, same entity class)
 *
 * Output: data/investor_duplicates_report.json (+ .md)
 */
import { readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const DATA = resolve("data/investors_merged.json");
const REPORT = resolve("data/investor_duplicates_report.json");
const REPORT_MD = resolve("data/investor_duplicates_report.md");

// ── helpers ─────────────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function domainOf(u: string): string | null {
  if (!u || u.length < 4) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const h = url.hostname.toLowerCase().replace(/^www\./, "");
    return h.includes(".") && h.length > 3 ? h : null;
  } catch {
    return null;
  }
}

function linkedinSlug(u: string): string | null {
  if (!u) return null;
  const m = /linkedin\.com\/(company|in|school)\/([^/?#]+)/i.exec(u);
  if (!m) return null;
  return `${m[1]}/${m[2].toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
}

/** Dice coefficient over character bigrams — cheap fuzzy name similarity. */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) {
    const o = gb.get(g);
    if (o) hit += Math.min(n, o);
  }
  return (2 * hit) / (ga.size + gb.size);
}

function tokens(s: string): Set<string> {
  return new Set(normName(s).split(/[\s\-_.]+/).filter((t) => t.length >= 3));
}

/** Completeness proxy — richer records should win merges (mirrors search.ts). */
function completeness(r: Rec): number {
  let s = 0;
  if (str(r.name)) s += 1;
  const links = (r.links ?? {}) as Rec;
  if (str(r.website) || str(links.website)) s += 1;
  if (str(links.linkedin)) s += 1;
  if (str(links.twitter) || str(links.x)) s += 1;
  if (str(r.email)) s += 1;
  if (str(r.image_url) || str(links.image_url)) s += 2;
  if (str(r.location)) s += 1;
  if (Array.isArray(r.investment_locations) && r.investment_locations.length) s += 1;
  if (Array.isArray(r.investment_categories) && r.investment_categories.length) s += 1;
  if (str((r.sweet_spot as Rec | undefined)?.sweet_spot)) s += 1;
  if (Number(r.check_sweet_spot_usd ?? 0) > 0) s += 1;
  if (str(r.role) || str(r.title)) s += 1;
  if (str(r.firm) || str(r.firm_name)) s += 1;
  if (str(r.thesis) || str(r.bio)) s += 1;
  return s;
}

function entityClass(r: Rec): "firm" | "individual" {
  const t = String(r.type ?? "").toLowerCase();
  if (t === "firm") return "firm";
  if (t === "individual") return "individual";
  const et = String(r.entity_type ?? "").toLowerCase();
  if (/firm|fund|network|accelerator|capital/.test(et)) return "firm";
  return "individual";
}

function memberView(r: Rec): Rec {
  const links = (r.links ?? {}) as Rec;
  return {
    id: r.id,
    name: r.name,
    class: entityClass(r),
    entity_type: r.entity_type ?? r.investor_type ?? null,
    website: str(r.website) || str(links.website) || null,
    linkedin: str(links.linkedin) || null,
    twitter: str(links.twitter) || str(links.x) || null,
    email: str(r.email) || null,
    image_url: str(r.image_url) || str(links.image_url) || null,
    location: str(r.location) || (Array.isArray(r.locations) ? (r.locations as string[])[0] : null),
    firm: str(r.firm) || str(r.firm_name) || null,
    source: str(r.source) || str(r.source_batch) || null,
    completeness: completeness(r),
  };
}

// ── load ────────────────────────────────────────────────────────────────────
const file = JSON.parse(readFileSync(DATA, "utf8")) as { investors?: Rec[]; entities?: Rec[] };
const rows: Rec[] = file.investors ?? file.entities ?? [];
console.log(`[audit] ${rows.length} records loaded`);

interface Cluster {
  key: string;
  reason: Set<string>;
  idx: Set<number>;
}
const clusters: Cluster[] = [];
const byIdx = new Map<number, Cluster>();
const link = (key: string, reason: string, a: number, b?: number): void => {
  let c =
    (byIdx.get(a) ?? undefined) ?? (b !== undefined ? byIdx.get(b) : undefined) ?? undefined;
  if (!c) {
    c = { key, reason: new Set(), idx: new Set() };
    clusters.push(c);
  }
  c.reason.add(reason);
  c.idx.add(a);
  if (b !== undefined) c.idx.add(b);
  byIdx.set(a, c);
  if (b !== undefined) byIdx.set(b, c);
};

const normNames = rows.map((r) => normName(str(r.name)));
const domains = rows.map((r) => domainOf(str(r.website) || str((r.links as Rec)?.website)));
const emails = rows.map((r) => str(r.email).toLowerCase());
const liSlugs = rows.map((r) => linkedinSlug(str((r.links as Rec)?.linkedin)));

// 1–4: exact-signal maps
const mapKeys: [Map<string, number[]>, string][] = [
  [new Map(), "normalized-name"],
  [new Map(), "domain"],
  [new Map(), "email"],
  [new Map(), "linkedin"],
];
normNames.forEach((v, i) => {
  if (v.length > 2) push(mapKeys[0][0], v, i);
});
domains.forEach((v, i) => v && push(mapKeys[1][0], v, i));
emails.forEach((v, i) => v && push(mapKeys[2][0], v, i));
liSlugs.forEach((v, i) => v && push(mapKeys[3][0], v, i));

function push(m: Map<string, number[]>, k: string, i: number): void {
  const arr = m.get(k);
  if (arr) arr.push(i);
  else m.set(k, [i]);
}
for (const [m, reason] of mapKeys) {
  for (const idxs of m.values()) {
    for (let j = 1; j < idxs.length; j++) link(reason + ":" + reason, reason, idxs[0], idxs[j]);
  }
}

// 5: fuzzy names — candidate pairs must share ≥1 token AND same class.
const tokenIndex = new Map<string, number[]>();
rows.forEach((_, i) => {
  for (const t of tokens(str(rows[i].name))) push(tokenIndex, t, i);
});
let fuzzyPairs = 0;
const seenPair = new Set<string>();
for (const idxs of tokenIndex.values()) {
  if (idxs.length < 2 || idxs.length > 60) continue; // skip hyper-common tokens
  for (let a = 0; a < idxs.length; a++) {
    for (let b = a + 1; b < idxs.length; b++) {
      const i = idxs[a];
      const j = idxs[b];
      if (byIdx.has(i) && byIdx.has(j) && byIdx.get(i) === byIdx.get(j)) continue;
      const pk = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seenPair.has(pk)) continue;
      seenPair.add(pk);
      if (entityClass(rows[i]) !== entityClass(rows[j])) continue;
      const ni = normNames[i];
      const nj = normNames[j];
      if (!ni || !nj) continue;
      // Cheap length gate then Dice on normalized names.
      if (Math.abs(ni.length - nj.length) > Math.max(ni.length, nj.length) * 0.4) continue;
      if (dice(ni, nj) >= 0.92) {
        link("fuzzy", "fuzzy-name", i, j);
        fuzzyPairs++;
      }
    }
  }
}

const real = clusters.filter((c) => c.idx.size > 1);
console.log(
  `[audit] ${real.length} duplicate clusters (${real.reduce((n, c) => n + c.idx.size, 0)} rows involved, ${fuzzyPairs} fuzzy links)`,
);

// ── report ──────────────────────────────────────────────────────────────────
const reportClusters = real.map((c, n) => {
  const members = [...c.idx]
    .map((i) => ({ index: i, ...memberView(rows[i]) }))
    .sort((x, y) => y.completeness - x.completeness);
  return {
    cluster_id: `cluster-${String(n + 1).padStart(4, "0")}`,
    matched_on: [...c.reason],
    suggested_keep_id: members[0]?.id ?? null,
    decision: { keep_id: null as string | null, drop_ids: [] as string[], note: "" },
    members,
  };
});

const dupRows = real.reduce((n, c) => n + c.idx.size, 0);
const report = {
  generated_at: new Date().toISOString(),
  total_records: rows.length,
  clusters_found: real.length,
  duplicate_rows_involved: dupRows,
  how_to_review:
    "For each cluster set decision.keep_id to the record id you want to KEEP and list every other member id in decision.drop_ids (or leave keep_id null to accept suggested_keep_id). Add note freely.",
  apply_command: "npx tsx scripts/audit-investor-duplicates.mts --apply",
  clusters: reportClusters,
};
writeFileSync(REPORT, JSON.stringify(report, null, 2));

// Markdown twin for easy reading.
const md: string[] = [
  `# Investor Duplicates Report`,
  ``,
  `Generated: ${report.generated_at}  ·  ${report.total_records} records scanned  ·  **${report.clusters_found} clusters** (${dupRows} rows involved)`,
  ``,
  `> Review each cluster, pick the keeper, then run: \`npx tsx scripts/audit-investor-duplicates.mts --apply\``,
  `> If \`decision.keep_id\` is left null the **suggested** keeper (richest record) is used.`,
  ``,
];
for (const c of reportClusters) {
  md.push(`## ${c.cluster_id} — matched on: ${c.matched_on.join(", ")}`);
  md.push(``);
  md.push(`| keep? | name | id | class | website | linkedin | email | img | loc | completeness |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const m of c.members) {
    const star = m.id === c.suggested_keep_id ? "⭐" : " ";
    md.push(
      `| ${star} | ${String(m.name)} | \`${String(m.id)}\` | ${m.class} | ${m.website ?? "—"} | ${
        m.linkedin ? "yes" : "—"
      } | ${m.email ? "yes" : "—"} | ${m.image_url ? "yes" : "—"} | ${String(m.location ?? "—")} | ${m.completeness} |`,
    );
  }
  md.push("");
}
writeFileSync(REPORT_MD, md.join("\n"));
console.log(`[audit] report → ${REPORT}`);
console.log(`[audit] readable twin → ${REPORT_MD}`);

// ── apply mode ──────────────────────────────────────────────────────────────
if (process.argv.includes("--apply")) {
  const prev = JSON.parse(readFileSync(REPORT, "utf8")) as typeof report;
  const dropIds = new Set<string>();
  const mergeInto = new Map<string, string>(); // dropped id → keeper id
  const byId = new Map<string, Rec>();
  for (const r of rows) byId.set(String(r.id), r);

  let decided = 0;
  for (const c of prev.clusters) {
    const keep = c.decision.keep_id ?? c.suggested_keep_id;
    if (!keep) continue;
    const drops = c.members.map((m) => String(m.id)).filter((id) => id !== keep);
    if (!drops.length) continue;
    decided++;
    for (const d of drops) {
      dropIds.add(d);
      mergeInto.set(d, keep);
    }
  }
  console.log(`[apply] ${decided} clusters decided → dropping ${dropIds.size} rows`);

  // Fill-missing merge from dropped into keeper before removal.
  const fillStr = (k: Rec, d: Rec, key: string, linkKey?: string): void => {
    const kl = (k.links ?? {}) as Rec;
    if (!str(k[key]) && !(linkKey && str(kl[linkKey]))) {
      const v = str(d[key]) || str(((d.links ?? {}) as Rec)?.[linkKey ?? ""]);
      if (v) {
        if (linkKey && !str(k[key])) {
          kl[linkKey] = v;
          k.links = kl;
        } else k[key] = v;
      }
    }
  };
  for (const [dId, kId] of mergeInto) {
    const keeper = byId.get(kId);
    const dropped = byId.get(dId);
    if (!keeper || !dropped) continue;
    fillStr(keeper, dropped, "website", "website");
    fillStr(keeper, dropped, "email");
    fillStr(keeper, dropped, "image_url", "image_url");
    if (!str(((keeper.links ?? {}) as Rec).linkedin) && str(((dropped.links ?? {}) as Rec).linkedin)) {
      (keeper.links as Rec).linkedin = ((dropped.links ?? {}) as Rec).linkedin;
    }
    if (!str(keeper.location) && str(dropped.location)) keeper.location = dropped.location;
    if (Array.isArray(dropped.investment_categories)) {
      const have = new Set((keeper.investment_categories as string[]) ?? []);
      for (const cat of dropped.investment_categories as string[])
        if (!have.has(cat)) ((keeper.investment_categories ??= []) as string[]).push(cat);
    }
    if (Array.isArray(dropped.investment_locations)) {
      const have = new Set((keeper.investment_locations as string[]) ?? []);
      for (const loc of dropped.investment_locations as string[])
        if (!have.has(loc)) ((keeper.investment_locations ??= []) as string[]).push(loc);
    }
    if (!str(keeper.bio) && str(dropped.bio)) keeper.bio = dropped.bio;
    if (!str(keeper.thesis) && str(dropped.thesis)) keeper.thesis = dropped.thesis;
  }

  const kept = rows.filter((r) => !dropIds.has(String(r.id)));
  copyFileSync(DATA, resolve("data/investors_merged.pre-dedupe.bak.json"));

  const out = { ...file, investors: kept, entities: undefined, total_entities: kept.length };
  delete out.entities;
  const json = JSON.stringify(out, null, 2);
  JSON.parse(json); // strict gate
  const tmp = DATA + ".tmp";
  writeFileSync(tmp, json);
  try {
    renameSync(tmp, DATA);
  } catch {
    copyFileSync(tmp, DATA);
    const { rmSync } = await import("node:fs");
    rmSync(tmp, { force: true });
  }
  console.log(`[apply] wrote ${DATA}: ${kept.length} entities (was ${rows.length})`);
}
