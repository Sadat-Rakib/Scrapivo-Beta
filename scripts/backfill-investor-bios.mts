/**
 * Backfill missing investor bios from public firm/investor pages.
 * Extractive only: meta description / about paragraphs, trimmed. Nothing invented.
 * Public pages, no auth, polite delay, per-fetch timeout. LinkedIn skipped (bot-walled).
 * Usage: npx tsx scripts/backfill-investor-bios.mts [--limit 200]
 * Re-runnable: skips rows that already have a bio.
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { load as cheerioLoad } from "cheerio";

const ROOT = resolve(process.cwd());
const FILE = resolve(ROOT, "data/investors_complete.jsonl");

const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 200);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, timeoutMs = 10000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Reject artifact sentences: glued words, repeated slogans, nav junk. */
function cleanSentence(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 40) return null;
  if (/cookie|subscribe|newsletter|all rights reserved/i.test(t)) return null;
  if (/\S{22,}/.test(t)) return null; // glued tokens like "gofurthertogether"
  const words = t.toLowerCase().split(" ");
  const seen = new Set<string>();
  for (const w of words) {
    if (w.length < 4) continue;
    if (seen.has(w)) return null; // repeated slogan words
    seen.add(w);
  }
  return t;
}

function extractBio(html: string, firm: string): string | null {
  const $ = cheerioLoad(html);
  $("script, style, nav, header, footer, noscript").remove();
  // Meta description first: cleanest source, no glued-word artifacts.
  const meta = (
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const metaClean = meta.length >= 60 ? cleanSentence(meta) : null;
  if (metaClean) return metaClean.slice(0, 600);
  const paras: string[] = [];
  $("main p, [role='main'] p, .about p, #about p, p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 60 && text.length < 800) paras.push(text);
    if (paras.join(" ").length > 900) return false;
  });
  const combined = paras.join(" ").replace(/\s+/g, " ").trim();
  if (combined.length < 60) return null;
  // Keep firm-relevant sentences first (extractive, no rewriting).
  const sentences = combined.match(/[^.!?]+[.!?]/g) ?? [combined];
  const firstWord = (firm || "").toLowerCase().split(" ")[0];
  const kept: string[] = [];
  const scored = sentences
    .map((s) => cleanSentence(s))
    .filter((s): s is string => !!s)
    .map((s) => ({ s, hit: firstWord && s.toLowerCase().includes(firstWord) ? 1 : 0 }));
  scored.sort((a, b) => b.hit - a.hit);
  for (const { s } of scored) {
    kept.push(s);
    if (kept.join(" ").length >= 500) break;
  }
  const out = kept.join(" ").slice(0, 600).trim();
  return out.length >= 60 ? out : null;
}

async function harvestBio(website: string, firm: string): Promise<string | null> {
  const base = website.replace(/\/$/, "");
  for (const url of [base, `${base}/about`]) {
    const html = await fetchText(url);
    if (!html) continue;
    const bio = extractBio(html, firm);
    if (bio) return bio;
  }
  return null;
}

async function main() {
  const redo = process.argv.includes("--redo-harvested");
  try {
    copyFileSync(FILE, `${FILE}.pre-bio-backfill.bak`);
  } catch {
    // backup already taken on first run
  }
  const lines = readFileSync(FILE, "utf8").split("\n").filter(Boolean);
  const rows = lines.map((l) => JSON.parse(l));
  let done = 0;
  let filled = 0;
  for (const r of rows) {
    const needsRedo = redo && r.bio_source === "harvested";
    if ((r.bio && !needsRedo) || !r.website || done >= limit) continue;
    done++;
    const bio = await harvestBio(r.website, r.firm);
    if (bio) {
      r.bio = bio;
      r.bio_source = "harvested";
      r.bio_scope = "firm";
      filled++;
    } else if (needsRedo) {
      r.bio = null;
      r.bio_source = null;
      r.bio_scope = null;
    }
    await sleep(400);
    if (done % 25 === 0) console.log(`progress ${done} filled ${filled}`);
  }
  writeFileSync(FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(JSON.stringify({ total: rows.length, attempted: done, filled }, null, 2));
}

main();
