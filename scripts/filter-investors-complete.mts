/**
 * Filter 8098 merged investors -> complete-profile-only JSONL.
 * Strict 7-field bar: name, firm, role, location, sectors, check size, email.
 * Existence: email valid + (website OR linkedin) + completeness >= 8.
 * Output: data/investors_complete.jsonl (flat AI-optimal rows).
 * Run: npx tsx scripts/filter-investors-complete.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const IN = resolve(ROOT, "data/investors_merged.json");
const OUT = resolve(ROOT, "data/investors_complete.jsonl");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseMoney(raw: string): number {
  const s = (raw || "").trim().replace(/[$,\s]/g, "");
  if (!s || s === "—" || s === "-") return 0;
  const m = s.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(m[1]);
  const u = (m[2] || "").toLowerCase();
  if (u === "k") return Math.round(n * 1_000);
  if (u === "m") return Math.round(n * 1_000_000);
  if (u === "b") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

function parseRange(raw: string): { min: number; max: number } {
  const parts = (raw || "").split(/[–—-]/).map((p) => p.trim());
  if (parts.length >= 2) return { min: parseMoney(parts[0]), max: parseMoney(parts[1]) };
  const n = parseMoney(raw);
  return { min: n, max: n };
}

function categorySector(cat: string): string {
  const s = (cat || "").trim();
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  if (open >= 0 && close > open) return s.slice(open + 1, close).trim();
  return s;
}
function categoryStage(cat: string): string {
  const s = (cat || "").trim();
  const open = s.indexOf("(");
  return (open > 0 ? s.slice(0, open) : s).trim();
}

type Raw = Record<string, any>;

function main() {
  const file = JSON.parse(readFileSync(IN, "utf8"));
  const rows: Raw[] = file.investors ?? file.entities ?? [];
  const drops: Record<string, number> = {};
  const drop = (k: string) => (drops[k] = (drops[k] ?? 0) + 1);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const r of rows) {
    const id = String(r.id ?? `${r.name}-${r.firm ?? ""}`);
    if (seen.has(id)) {
      drop("duplicate_id");
      continue;
    }

    const name = String(r.name ?? "").trim();
    if (!name) {
      drop("missing_name");
      continue;
    }
    const firm =
      String(r.firm ?? r.associated_firm?.name ?? (r.type === "firm" ? r.name : "") ?? "").trim();
    if (!firm) {
      drop("missing_firm");
      continue;
    }
    const role = String(r.title ?? r.role ?? "").trim();
    if (!role || /^unknown$/i.test(role)) {
      drop("missing_role");
      continue;
    }
    const location = String(r.location ?? r.investment_locations?.[0] ?? "").trim();
    if (!location) {
      drop("missing_location");
      continue;
    }

    // Sectors: investment_categories "Stage (Sector)" or investment_sectors[]
    let sectors: string[] = [];
    if (Array.isArray(r.investment_categories)) {
      sectors = [...new Set(r.investment_categories.map(categorySector).filter(Boolean))];
    } else if (Array.isArray(r.investment_sectors)) {
      sectors = [...new Set(r.investment_sectors.map((s: string) => String(s).trim()).filter(Boolean))];
    } else if (Array.isArray(r.investment_categories)) {
      sectors = [];
    }
    if (!sectors.length) {
      drop("missing_sectors");
      continue;
    }

    // Check size: cheque_size OR sweet_spot OR check_min/max
    let checkMin = Number(r.check_min_usd ?? 0);
    let checkMax = Number(r.check_max_usd ?? 0);
    const chequeRaw = String(r.cheque_size ?? r.sweet_spot?.raw ?? r.sweet_spot?.sweet_spot ?? "").trim();
    if ((!checkMin || !checkMax) && chequeRaw) {
      const { min, max } = parseRange(chequeRaw);
      checkMin = checkMin || min;
      checkMax = checkMax || max;
    }
    if ((!checkMin && !checkMax) || (checkMin === 0 && checkMax === 0)) {
      drop("missing_check_size");
      continue;
    }

    // Contacts: strict email required
    const email = String(r.email ?? r.contacts?.[0]?.email ?? "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      drop("missing_email");
      continue;
    }

    // Existence: website OR linkedin + completeness >= 8
    const website = String(r.website ?? r.websites?.firm_website ?? r.websites?.investor_website ?? r.links?.website ?? "").trim();
    const linkedin = String(
      r.links?.linkedin ?? r.profiles?.linkedin ?? r.contacts?.[0]?.linkedin ?? "",
    ).trim();
    if (!website && !linkedin) {
      drop("no_corroboration");
      continue;
    }
    const completeness = Number(r.information_completeness_score ?? 0);
    if (completeness < 8) {
      drop("low_completeness");
      continue;
    }

    // Stages derived
    let stages: string[] = [];
    if (Array.isArray(r.investment_categories)) {
      stages = [...new Set(r.investment_categories.map(categoryStage).filter(Boolean))];
    } else if (Array.isArray(r.investment_stages)) {
      stages = [...new Set(r.investment_stages.map((s: string) => String(s).trim()).filter(Boolean))];
    }

    seen.add(id);
    const locParts = location.split(",").map((s: string) => s.trim()).filter(Boolean);
    out.push(
      JSON.stringify({
        id,
        name,
        firm,
        role,
        location,
        location_city: locParts[0] ?? location,
        location_country: locParts[locParts.length - 1] ?? "",
        sectors,
        stages,
        check_min_usd: checkMin,
        check_max_usd: checkMax,
        email,
        linkedin: linkedin || null,
        website: website || null,
        image_url: r.image_url ?? r.profile_photo?.local_path ?? null,
        completeness,
        provenance: [`data/investors_merged.json#${id}`],
      }),
    );
  }

  writeFileSync(OUT, out.join("\n") + (out.length ? "\n" : ""));
  console.log(JSON.stringify({ input: rows.length, surviving: out.length, drops }, null, 2));
}

main();
