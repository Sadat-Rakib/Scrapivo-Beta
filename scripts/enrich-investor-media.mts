/**
 * Investor media + info enrichment — FREE sources only, every candidate
 * validated before acceptance. Fills:
 *   - images   : Clearbit logo → Google favicon → site favicon (firms/sites)
 *                Gravatar(email) → unavatar twitter/github (people)
 *   - website  : inferred from the person's firm record when available
 *   - linkedin/twitter : harvested from their own website HTML
 *
 * Usage:
 *   npx tsx scripts/enrich-investor-media.mts --limit 25            # sample
 *   npx tsx scripts/enrich-investor-media.mts                       # full run
 *   npx tsx scripts/enrich-investor-media.mts --dry-run             # no writes
 * Resumable: data/investor_enrich_progress.json tracks done ids.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const DATA = resolve("data/investors_merged.json");
const PROGRESS = resolve("data/investor_enrich_progress.json");
const PIC_DIR = resolve("public/Investors_Profile_Pics");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0;
/** Parallel workers — each record makes 2-6 polite HTTP calls. */
const CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 6);
const SAVE_EVERY = 20;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const md5 = (s: string): string => createHash("md5").update(s).digest("hex");
type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

async function fetchWithUa(url: string, timeoutMs = 10_000, method = "GET"): Promise<Response | null> {
  try {
    return await fetch(url, {
      method,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Scrapivo/1.0", Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/** Validate a candidate image URL: HTTP 200 + image/* + ≥1KB. */
async function validateImage(url: string): Promise<boolean> {
  const res = await fetchWithUa(url, 9_000);
  if (!res || !res.ok) return false;
  const ct = res.headers.get("content-type") || "";
  if (!/image\//i.test(ct)) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 1024;
}

async function downloadTo(url: string, dest: string): Promise<boolean> {
  const res = await fetchWithUa(url, 15_000);
  if (!res || !res.ok) return false;
  const ct = res.headers.get("content-type") || "";
  if (!/image\//i.test(ct)) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length <= 1024) return false;
  if (DRY) return true;
  const ext = /png/i.test(ct) ? "png" : /gif/i.test(ct) ? "gif" : /webp/i.test(ct) ? "webp" : "jpg";
  writeFileSync(dest.replace(/\.(png|jpe?g|webp|gif)$/, `.${ext}`), buf);
  return true;
}

/** Candidate image URLs, best-first, per record. Firms → logos; people → headshots. */
async function wikipediaThumb(name: string): Promise<string | null> {
  if (!name || name.length < 3) return null;
  const res = await fetchWithUa(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/\s+/g, "_"))}`,
    8_000,
  );
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    return data.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

function imageCandidates(r: Rec, domain: string | null, isFirm: boolean): string[] {
  const links = (r.links ?? {}) as Rec;
  const out: string[] = [];
  if (isFirm && domain) {
    out.push(`https://logo.clearbit.com/${domain}`);
    out.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
    out.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
    out.push(`https://${domain}/favicon.ico`);
    out.push(`http://${domain}/favicon.ico`);
    return out;
  }
  const email = str(r.email).toLowerCase();
  if (email) out.push(`https://www.gravatar.com/avatar/${md5(email)}?d=404&s=256`);
  const tw = str(links.twitter) || str(links.x);
  if (tw) out.push(`https://unavatar.io/twitter/${tw.split("/").pop()}`);
  const gh = str(links.github);
  if (gh) out.push(`https://unavatar.io/github/${gh.split("/").pop()}`);
  const li = str(links.linkedin);
  if (li) out.push(`https://unavatar.io/linkedin/${li.split("/").pop()}?fallback=false`);
  return out;
}

/** Harvest social links from the record's own website HTML. */
async function harvestSocials(domain: string): Promise<{ linkedin?: string; twitter?: string }> {
  const out: { linkedin?: string; twitter?: string } = {};
  const res = await fetchWithUa(`https://${domain}`, 10_000);
  if (!res || !res.ok) return out;
  const html = (await res.text()).slice(0, 300_000);
  const li = /linkedin\.com\/(?:company|in)\/[a-z0-9%_.-]+/i.exec(html);
  if (li) out.linkedin = `https://${li[0].replace(/\/$/, "")}`;
  const tw = /(?:twitter|x)\.com\/[A-Za-z0-9_]{2,15}\b/.exec(html);
  if (tw && !/intent|share|home/i.test(tw[0])) out.twitter = `https://${tw[0]}`;
  return out;
}

// ── load ────────────────────────────────────────────────────────────────────
const file = JSON.parse(readFileSync(DATA, "utf8")) as { investors?: Rec[] };
const rows: Rec[] = file.investors ?? file.entities ?? [];

// Firm-domain lookup for individual→firm website inference.
const firmDomainByName = new Map<string, string>();
for (const r of rows) {
  if (String(r.type ?? "").toLowerCase() !== "firm") continue;
  const d =
    str((r.links as Rec)?.website).replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase() ||
    str(r.website).replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase();
  const n = str(r.name).toLowerCase();
  if (d && n) firmDomainByName.set(n, d.replace(/^www\./, ""));
}

let progress: Record<string, string> = {};
if (existsSync(PROGRESS)) {
  try {
    progress = JSON.parse(readFileSync(PROGRESS, "utf8")) as Record<string, string>;
  } catch {
    progress = {};
  }
}

// --retry-failed: re-attempt records whose first pass found nothing. New
// providers (DuckDuckGo icons, unavatar/linkedin) justify a second chance.
if (args.includes("--retry-failed")) {
  let cleared = 0;
  for (const [id, v] of Object.entries(progress)) {
    if (v === "none") {
      delete progress[id];
      cleared++;
    }
  }
  console.log(`[enrich] retry mode: cleared ${cleared} 'none' entries for re-processing`);
}

// Only enrich records MISSING an image; skip already-done ids.
// Priority: firms (known domains → logos) → records with email (Gravatar
// fast path) → everything else.
const prio = (r: Rec): number => {
  if (String(r.type ?? "").toLowerCase() === "firm") return 0;
  if (str(r.email)) return 1;
  return 2;
};
const targets = rows
  .filter((r) => {
    const id = str(r.id);
    if (!id || progress[id]) return false;
    const links = (r.links ?? {}) as Rec;
    const hasImage = !!str(r.image_url) || !!str(links.image_url);
    return !hasImage;
  })
  .sort((a, b) => prio(a) - prio(b));
console.log(`[enrich] ${targets.length} records need media (of ${rows.length})${DRY ? " — DRY RUN" : ""}`);
const estMinutes = Math.round((targets.length * 2.2) / CONCURRENCY / 60);
console.log(
  `[enrich] ~${estMinutes} min estimated at concurrency=${CONCURRENCY} · progress saves every ${SAVE_EVERY} records`,
);

const work = LIMIT ? targets.slice(0, LIMIT) : targets;

let imagesFound = 0;
let socialsFound = 0;
let sitesInferred = 0;
let processed = 0;

/** Process one record: site inference → social harvest → image candidates. */
async function enrichOne(r: Rec): Promise<void> {
  const id = str(r.id);
  const name = str(r.name);
  const links = (r.links ?? {}) as Rec;
  const isFirm = String(r.type ?? "").toLowerCase() === "firm";

  let domain = str(r.website)
    .replace(/^https?:\/\/(www\.)?/, "")
    .split("/")[0]
    .toLowerCase();
  if (!domain && !isFirm) {
    const fd = firmDomainByName.get(str(r.firm).toLowerCase());
    if (fd) {
      domain = fd;
      sitesInferred++;
      if (!str(r.website) && !str(links.website)) {
        r.website = `https://${fd}`;
        links.website = `https://${fd}`;
      }
    }
  }
  if (!domain && isFirm) {
    domain = str(links.website).replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase();
  }

  if (domain && (!str(links.linkedin) || !str(links.twitter))) {
    const socials = await harvestSocials(domain);
    if (socials.linkedin && !str(links.linkedin)) {
      links.linkedin = socials.linkedin;
      socialsFound++;
    }
    if (socials.twitter && !str(links.twitter) && !str(links.x)) {
      links.twitter = socials.twitter;
      socialsFound++;
    }
  }

  let placed: string | null = null;
  const candidates = [...imageCandidates(r, domain, isFirm)];
  if (!isFirm) {
    const wiki = await wikipediaThumb(name);
    if (wiki) candidates.unshift(wiki);
  }
  for (const cand of candidates) {
    const safeName = name.replace(/[\\/:*?"<>|]/g, "_").trim();
    const dest = resolve(PIC_DIR, `${safeName}.png`);
    if (await downloadTo(cand, dest)) {
      placed = `/Investors_Profile_Pics/${safeName}.png`;
      break;
    }
  }
  if (placed) {
    (r as Record<string, unknown>).image_url = placed;
    links.image_url_source = isFirm ? "firm-logo" : "person-photo";
    imagesFound++;
  }

  r.links = links;
  progress[id] = placed ? "image" : Object.keys(links).length ? "socials" : "none";
}

/** Worker pool over the queue with incremental manifest saves. */
const queue = [...work];
async function worker(wid: number): Promise<void> {
  for (;;) {
    const r = queue.shift();
    if (!r) return;
    try {
      await enrichOne(r);
    } catch (e) {
      console.warn(`[enrich] record failed: ${String((r as Rec).name).slice(0, 40)} — ${(e as Error).message?.slice(0, 60)}`);
    }
    processed++;
    if (processed % 25 === 0) {
      process.stdout.write(
        `[enrich] ${processed}/${work.length} done · ${imagesFound} img · ${socialsFound} socials · ${sitesInferred} sites\n`,
      );
    }
    if (!DRY && processed % SAVE_EVERY === 0) {
      writeFileSync(PROGRESS, JSON.stringify(progress));
    }
    await sleep(150 + wid * 10); // gentle politeness stagger per worker
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

process.stdout.write(
  `\n[enrich] processed=${processed} · ${imagesFound} images · ${socialsFound} socials · ${sitesInferred} sites inferred\n`,
);

// ── persist ────────────────────────────────────────────────────────────────
if (!DRY) {
  copyFileSync(DATA, resolve("data/investors_merged.pre-enrich.bak.json"));
  const out = { ...file, investors: rows };
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
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 2));
  console.log(`[enrich] wrote ${DATA} (+progress manifest)`);
} else {
  console.log("[enrich] dry run — nothing written");
}

console.log(`[enrich] summary: ${imagesFound} images, ${socialsFound} socials, ${sitesInferred} sites inferred`);
