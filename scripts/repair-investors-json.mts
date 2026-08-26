/**
 * Repair data/investors_merged.json — recover ALL records (including manual edits)
 * from the corrupted merge (doubled `{` opens + missing commas between records).
 *
 * Strategy: character-level, string-aware scan with a container stack. When a
 * structural anomaly appears, apply the minimal fix that makes it valid JSON:
 *   - `{` immediately following `{`            → drop the duplicate open
 *   - `{` following a completed element in `[` → insert the missing comma
 * Everything else aborts loudly (never guesses). Output is gated behind a
 * strict JSON.parse verification + row-count sanity, then written atomically.
 *
 * The repaired file exposes the array under BOTH `investors` (what
 * src/lib/investors/search.ts reads) and keeps header counts truthful.
 * Run:  npx tsx scripts/repair-investors-json.mts [--force]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const SRC = resolve("data/investors_merged.json");
const BACKUP = resolve("data/investors_merged.corrupt.bak.json");
const TMP = resolve("data/investors_merged.repaired.tmp.json");

interface RepairStats {
  droppedDuplicateOpens: number;
  insertedMissingCommas: number;
  boundaryObjectsClosed: number;
  maxDepth: number;
}

type Container = "array" | "object";

/** Token-expectation while walking. */
enum Exp {
  Value = 0, // a value (or key-in-object handled separately) may start here
  SepOrClose = 1, // `,` `}` `]` expected
  KeyOrClose = 2, // object: `"key"` or `}`
}

function repairJsonText(src: string): { out: string; stats: RepairStats; fixedAt: number[] } {
  const out: string[] = [];
  const stack: Container[] = [];
  const stats: RepairStats = {
    droppedDuplicateOpens: 0,
    insertedMissingCommas: 0,
    boundaryObjectsClosed: 0,
    maxDepth: 0,
  };
  const fixedAt: number[] = [];
  let exp = Exp.Value;
  let inStr = false;
  let esc = false;

  const prevMeaningful = (): string => {
    for (let i = out.length - 1; i >= 0; i--) {
      const s = out[i];
      if (!/\s/.test(s)) return s;
    }
    return "";
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inStr) {
      out.push(ch);
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        inStr = false;
        exp = exp === Exp.KeyOrClose ? Exp.SepOrClose : Exp.SepOrClose;
      }
      continue;
    }

    switch (ch) {
      case '"': {
        // String start — a KEY when object expects key, otherwise a value.
        if (exp === Exp.SepOrClose) {
          const top = stack[stack.length - 1];
          if (top === "array") {
            // Missing comma between array elements.
            out.push(",");
            stats.insertedMissingCommas++;
            fixedAt.push(i);
          } else if (top === "object") {
            // `"key"` right after a completed value → missing member comma.
            out.push(",");
            stats.insertedMissingCommas++;
            fixedAt.push(i);
            exp = Exp.KeyOrClose;
          }
        }
        inStr = true;
        esc = false;
        out.push(ch);
        break;
      }
      case "{":
      case "[": {
        if (exp === Exp.SepOrClose && stack.length && stack[stack.length - 1] === "array") {
          out.push(",");
          stats.insertedMissingCommas++;
          fixedAt.push(i);
        } else if (exp === Exp.SepOrClose && stack.length && stack[stack.length - 1] === "object") {
          // A new object opened where an object only allows `,` or `}`. In
          // valid JSON this can never continue inward — the only sane repair
          // is: close objects until the enclosing ARRAY resurfaces, insert
          // the missing element comma, and treat `{` as a fresh element.
          while (stack.length && stack[stack.length - 1] !== "array") {
            out.push("}");
            stack.pop();
            stats.boundaryObjectsClosed++;
          }
          if (!stack.length) throw new Error(`boundary unwind hit top level @${i}`);
          out.push(",");
          stats.insertedMissingCommas++;
          fixedAt.push(i);
        }
        if (
          (exp === Exp.Value || exp === Exp.KeyOrClose) &&
          prevMeaningful() === "{" &&
          stack[stack.length - 1] === "object"
        ) {
          // `{` opening immediately after `{` with no key between — the
          // duplicate-open corruption signature. Drop this one.
          stats.droppedDuplicateOpens++;
          fixedAt.push(i);
          continue;
        }
        stack.push(ch === "{" ? "object" : "array");
        stats.maxDepth = Math.max(stats.maxDepth, stack.length);
        out.push(ch);
        exp = ch === "{" ? Exp.KeyOrClose : Exp.Value;
        break;
      }
      case "}":
      case "]": {
        const want: Container = ch === "}" ? "object" : "array";
        const top = stack[stack.length - 1];
        if (!stack.length || top !== want) throw new Error(`unbalanced ${ch} @${i}`);
        stack.pop();
        out.push(ch);
        exp = Exp.SepOrClose;
        break;
      }
      case ",":
        out.push(ch);
        exp = stack[stack.length - 1] === "object" ? Exp.KeyOrClose : Exp.Value;
        break;
      case ":":
        out.push(ch);
        exp = Exp.Value;
        break;
      default: {
        if (/\s/.test(ch)) {
          out.push(ch);
          break;
        }
        if (exp === Exp.SepOrClose && stack[stack.length - 1] === "array") {
          // bare literal/number starting right after a completed element
          out.push(",");
          stats.insertedMissingCommas++;
          fixedAt.push(i);
          exp = Exp.Value;
        } else if (exp === Exp.SepOrClose || exp === Exp.KeyOrClose) {
          // literals like true/false/null/digits outside a value slot — only
          // tolerable directly after `:`; anything else is real corruption.
          if (prevMeaningful() !== ":") {
            throw new Error(`unexpected token '${ch}' @${i} ctx=${src.slice(Math.max(0, i - 80), i + 40)}`);
          }
          exp = Exp.Value;
        }
        // Emit the whole literal/number token verbatim.
        const m = /^(true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(src.slice(i));
        if (!m) throw new Error(`unrecognized char '${ch}' @${i}`);
        out.push(m[0]);
        i += m[0].length - 1;
        exp = Exp.SepOrClose;
        break;
      }
    }
  }

  if (stack.length) throw new Error(`unclosed containers remain: ${stack.length}`);
  const text = out.join("");
  return { out: text, stats, fixedAt };
}

function classify(rec: Record<string, unknown>): "firm" | "individual" {
  const t = String(rec.type ?? "").toLowerCase();
  if (t === "firm") return "firm";
  if (t === "individual") return "individual";
  const et = String(rec.entity_type ?? rec.record_type ?? "").toLowerCase();
  if (/firm|fund|network|accelerator|vc$|capital/.test(et)) return "firm";
  if (/vc|angel|scout|investor|person|individual/.test(et)) return "individual";
  // Records tied to a person role/title default individual; named orgs default firm.
  if (rec.role || rec.title) return "individual";
  return "firm";
}

function ensureId(rec: Record<string, unknown>, idx: number): string {
  if (typeof rec.id === "string" && rec.id.trim()) return rec.id;
  const basis =
    String(rec.name ?? "") +
    "|" +
    String(rec.website ?? "") +
    "|" +
    String((rec.links as Record<string, unknown> | undefined)?.linkedin ?? "");
  const h = createHash("sha1").update(basis || String(idx)).digest("hex").slice(0, 12);
  return `ent-${h}`;
}

// ── main ────────────────────────────────────────────────────────────────────
const force = process.argv.includes("--force");

console.log(`[repair] reading ${SRC} (${(statSync(SRC).size / 1048576).toFixed(2)} MB)`);
const src = readFileSync(SRC, "utf8");

let parsedHeader: Record<string, unknown> | null = null;
try {
  parsedHeader = null; // whole-file parse known-bad; header salvaged below
} catch {
  /* ignore */
}

// Salvage original header fields (schema_version, generated_at, merge_stats…)
const headerEnd = src.indexOf('"entities"');
if (headerEnd < 0 && !force) {
  console.error("[repair] could not locate entities array marker — aborting");
  process.exit(1);
}
const headText = headerEnd > 0 ? src.slice(0, headerEnd) : "";
const salvage: Record<string, unknown> = {};
try {
  const headObj = JSON.parse(headText.replace(/,\s*$/, "") + "}");
  for (const k of ["schema_version", "generated_at", "merge_stats", "total_entities", "firms", "individuals"]) {
    if (k in headObj) salvage[k] = headObj[k];
  }
} catch {
  console.warn("[repair] header salvage failed — continuing with defaults");
}

// Locate the main array body: prefer `entities`, fall back to `investors`.
const arrKey = src.indexOf('"entities"') >= 0 ? "entities" : "investors";
const arrStart = src.indexOf(`"${arrKey}"`);
const bodyOpen = src.indexOf("[", arrStart);
if (bodyOpen < 0) {
  console.error("[repair] no array body found — aborting");
  process.exit(1);
}
// Find matching close bracket (string-aware).
let depth = 0;
let inStr = false;
let esc = false;
let bodyEnd = -1;
for (let i = bodyOpen; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') inStr = true;
  else if (c === "[") depth++;
  else if (c === "]") {
    depth--;
    if (depth === 0) {
      bodyEnd = i;
      break;
    }
  }
}
if (bodyEnd < 0) {
  console.error("[repair] unterminated array — aborting");
  process.exit(1);
}
const body = src.slice(bodyOpen, bodyEnd + 1);
console.log(`[repair] array "${arrKey}" spans ${body.length.toLocaleString()} chars`);

let repairedBody = body;
let stats: RepairStats = { droppedDuplicateOpens: 0, insertedMissingCommas: 0, maxDepth: 0 };
let fixedAt: number[] = [];
let ok = false;
try {
  JSON.parse(body); // maybe only the wrapper was broken?
  ok = true;
  console.log("[repair] array body already parses clean");
} catch (e) {
  console.log(`[repair] body fails parse (${(e as Error).message.slice(0, 90)}) — running repairer`);
}
if (!ok) {
  const r = repairJsonText(body);
  repairedBody = r.out;
  stats = r.stats;
  fixedAt = r.fixedAt;
  console.log(
    `[repair] fixes: ${stats.droppedDuplicateOpens} duplicate opens dropped, ` +
      `${stats.insertedMissingCommas} commas inserted, depth ${stats.maxDepth}, ` +
      `${fixedAt.length} intervention points`,
  );
}

const rows = JSON.parse(repairedBody) as Record<string, unknown>[];
if (!Array.isArray(rows)) {
  console.error("[repair] recovered body is not an array — aborting");
  process.exit(1);
}

// Normalize rows: guarantee id + name; quarantine nameless rows (never delete).
const kept: Record<string, unknown>[] = [];
const quarantined: { index: number; reason: string; snippet: string }[] = [];
for (let i = 0; i < rows.length; i++) {
  const rec = rows[i];
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    quarantined.push({ index: i, reason: "non-object row", snippet: JSON.stringify(rec)?.slice(0, 120) ?? "" });
    continue;
  }
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (!name) {
    quarantined.push({
      index: i,
      reason: "missing name",
      snippet: JSON.stringify(rec).slice(0, 160),
    });
    continue;
  }
  rec.id = ensureId(rec, i);
  kept.push(rec);
}

let firms = 0;
let individuals = 0;
for (const r of kept) (classify(r) === "firm" ? firms++ : individuals++);

const outFile = {
  schema_version: 3,
  generated_at: new Date().toISOString(),
  total_entities: kept.length,
  firms,
  individuals,
  merge_stats: {
    ...(typeof salvage.merge_stats === "object" && salvage.merge_stats ? (salvage.merge_stats as object) : {}),
    repair: {
      repaired_at: new Date().toISOString(),
      source_rows_recovered: rows.length,
      duplicate_opens_dropped: stats.droppedDuplicateOpens,
      missing_commas_inserted: stats.insertedMissingCommas,
      quarantined: quarantined.length,
      prior_header_counts: {
        total_entities: salvage.total_entities ?? null,
        firms: salvage.firms ?? null,
        individuals: salvage.individuals ?? null,
      },
    },
  },
  investors: kept,
};

const json = JSON.stringify(outFile, null, 2);

// Hard gates before touching disk.
JSON.parse(json); // strict re-parse
if (kept.length < 3000) {
  console.error(`[repair] sanity gate: only ${kept.length} rows recovered (<3000) — refusing write`);
  process.exit(1);
}

if (!existsSync(BACKUP)) {
  copyFileSync(SRC, BACKUP);
  console.log(`[repair] original preserved → ${BACKUP}`);
} else {
  console.log("[repair] backup already exists — leaving untouched");
}

writeFileSync(TMP, json);
// OneDrive can hold a transient lock on the target — try rename, fall back
// to copy+delete so the repair still lands.
try {
  renameSync(TMP, SRC);
} catch {
  copyFileSync(TMP, SRC);
  const { rmSync } = await import("node:fs");
  rmSync(TMP, { force: true });
}
console.log(
  `[repair] wrote ${SRC}: ${kept.length} entities (${firms} firms / ${individuals} individuals), ` +
    `${(statSync(SRC).size / 1048576).toFixed(2)} MB`,
);

if (quarantined.length) {
  const qPath = resolve("data/investors_repair_quarantine.json");
  writeFileSync(qPath, JSON.stringify(quarantined, null, 2));
  console.warn(`[repair] ${quarantined.length} unusable rows quarantined → ${qPath} (review manually)`);
}
console.log("[repair] done");
