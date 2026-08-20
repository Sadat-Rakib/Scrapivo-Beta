/**
 * End-to-end smoke: investors, clarifiers, local tags, search modules, env readiness.
 * Run: npx tsx scripts/smoke-all-features.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const f of [".env", ".env.local"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();

import { injectLocationBias, expandFromClassified } from "../src/lib/search/query-expander";
import { classifyQuery } from "../src/lib/search/query-classifier";
import {
  applyClarifyAnswers,
  buildClarifyingQuestions,
  isFindInvestorHunt,
  isLocalBusinessHunt,
} from "../src/lib/search/clarifier";
import { passesLocationFilter } from "../src/lib/validation";
import { searxngUnavailable } from "../src/lib/search/serp-providers.server";
import { searchInvestors, getAllInvestors } from "../src/lib/investors/search";
import { deriveOpportunityTags } from "../src/lib/search/lead-segments";
import type { Lead } from "../src/lib/scoring";

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, cond: unknown, detail?: string) {
  const ok = Boolean(cond);
  results.push({ name, ok, detail: ok ? detail : detail || "failed" });
  console.log(`${ok ? "ok " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
}

function present(k: string) {
  return !!(process.env[k] || "").trim();
}

async function probeUrl(url: string, ms = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== 1. Investors seed ===");
  const all = getAllInvestors();
  check("investors loaded", all.length >= 500, `count=${all.length}`);
  check(
    "no Unknown titles",
    all.every((i) => {
      const name = "name" in i ? String(i.name || "") : "";
      const title = "title" in i ? String((i as { title?: string }).title || "") : "";
      return !/^unknown$/i.test(name) && !/^unknown$/i.test(title);
    }),
  );
  check(
    "no needs_review in seed",
    all.every((i) => {
      const s = "status" in i ? (i as { status?: string }).status : undefined;
      return !s || s === "active";
    }),
  );
  const fintech = await searchInvestors({ query: "FinTech", stage: "Seed", limit: 20 });
  check("FinTech Seed search", fintech.length > 0, `n=${fintech.length}`);
  const canada = await searchInvestors({ location: "Canada", limit: 20 });
  check("Canada location search", canada.length > 0, `n=${canada.length}`);
  const angel = await searchInvestors({ checkBand: "angel", limit: 20 });
  check("angel check band", angel.length > 0, `n=${angel.length}`);
  const climate = await searchInvestors({ sector: "Climate", stage: "Seed", limit: 10 });
  check("Climate Seed sector", climate.length > 0, `n=${climate.length}`);
  const empty = await searchInvestors({ limit: 10000 });
  check("empty filters ≈ all", empty.length === all.length, `n=${empty.length}`);
  const bd = await searchInvestors({ location: "Bangladesh", limit: 50 });
  check("Bangladesh geo", bd.length > 0, `n=${bd.length}`);

  console.log("\n=== 2. Clarifiers (investors / local / geo) ===");
  const invQ = classifyQuery("find investors for my FinTech startup");
  check("investor hunt detected", isFindInvestorHunt(invQ));
  const invQs = buildClarifyingQuestions(invQ);
  check(
    "investor clarifiers include stage/check",
    invQs.some((q) => q.id === "investor_stage") && invQs.some((q) => q.id === "investor_check"),
    invQs.map((q) => q.id).join(","),
  );
  const invRef = applyClarifyAnswers(invQ, {
    investor_stage: "Seed",
    investor_check: "seed",
    geography: "us",
  });
  check("investor refine findInvestors", invRef.findInvestors === true);
  check("investor refine stage", invRef.investorStage === "Seed");

  const localQ = classifyQuery("dentists in Austin without websites");
  check("local business hunt detected", isLocalBusinessHunt(localQ));
  const localQs = buildClarifyingQuestions(localQ);
  check(
    "local clarifier has opportunity",
    localQs.some((q) => q.id === "local_opportunity"),
    localQs.map((q) => q.id).join(","),
  );

  const designQ = classifyQuery("need a designer");
  const designRef = applyClarifyAnswers(designQ, {
    geography: "eu",
    craft: "UI designer",
    experience: "3-4",
  });
  check(
    "geo eu → location",
    /Europe/i.test(designRef.location || ""),
    designRef.location || "(null)",
  );
  if (designRef.craft) designQ.coreSkill = designRef.craft;
  designQ.location = designRef.location;
  let expanded = expandFromClassified(designQ);
  expanded = injectLocationBias(expanded, designQ.location);
  const blob = [...expanded.booleanWebQueries, ...expanded.socialQueries].join(" ");
  check("expanded queries have Europe", /Europe/i.test(blob));

  console.log("\n=== 3. Validation / opportunity tags ===");
  const euLead = {
    source: "reddit",
    platform: "Reddit",
    title: "Need a designer in Berlin",
    snippet: "Based in Germany",
    full_post_url: "https://reddit.com/r/forhire/1",
  } as Lead;
  check("Europe filter keeps Berlin", passesLocationFilter(euLead, "Europe"));
  check(
    "US filter drops India",
    !passesLocationFilter(
      { ...euLead, title: "Need designer in Mumbai", snippet: "Bangalore" } as Lead,
      "United States",
    ),
  );
  const tags = deriveOpportunityTags({ website: undefined, email: "a@b.com", phone: "1" });
  check("tags no_website+has_email", tags.includes("no_website") && tags.includes("has_email"));
  const tags2 = deriveOpportunityTags({
    website: "https://example.com",
    email: undefined,
    phone: undefined,
  });
  check("tags with website alone", !tags2.includes("no_website"));

  console.log("\n=== 4. Routes / UI files exist ===");
  for (const f of [
    "src/routes/_authenticated/discover.tsx",
    "src/routes/_authenticated/local-businesses.tsx",
    "src/routes/_authenticated/investors.tsx",
    "src/routes/_authenticated/jobs.tsx",
    "src/lib/contact/shared-contact-intelligence.server.ts",
    "src/lib/search/playbook-planner.ts",
    "src/lib/contact/domain-memory.server.ts",
    "src/lib/profile/discover-profiles.server.ts",
    "src/lib/intelligence/evidence.ts",
    "src/lib/jobs/ats-adapters.ts",
    "src/components/discover/result-tabs.tsx",
    "data/investors_merged.json",
  ]) {
    check(`file ${f}`, existsSync(resolve(process.cwd(), f)));
  }

  console.log("\n=== 5. Env readiness (deploy checklist) ===");
  const authOk = present("MY_SUPABASE_URL") || present("VITE_MY_SUPABASE_URL");
  check("Supabase URL set", authOk);
  check(
    "Supabase publishable key",
    present("MY_SUPABASE_PUBLISHABLE_KEY") || present("VITE_MY_SUPABASE_PUBLISHABLE_KEY"),
  );

  const searxDead = searxngUnavailable();
  const searxUrl = (process.env.SEARXNG_URL || "").trim();
  console.log(`  SEARXNG_URL=${searxUrl || "(empty)"} searxngUnavailable=${searxDead}`);

  const paid =
    present("SERPER_API_KEY") || present("SERPAPI_KEY") || present("SCRAPINGDOG_API_KEY");
  check(
    "at least one SERP key (Serper/SerpAPI/ScrapingDog)",
    paid,
    paid ? "present" : "MISSING — Discover volume will collapse on Vercel",
  );
  console.log(`  USE_PAID_SOURCES=${process.env.USE_PAID_SOURCES || "(unset)"}`);
  if (!searxDead && searxUrl) {
    const up = await probeUrl(searxUrl.replace(/\/$/, "") + "/");
    if (up) check("SearXNG reachable locally", true, searxUrl);
    else {
      console.log(
        `  WARN SearXNG configured but not reachable (${searxUrl}) — Discover will fall back to paid SERP`,
      );
      results.push({
        name: "SearXNG reachable locally",
        ok: true,
        detail: "soft-fail: using SERP fallback",
      });
    }
  } else {
    console.log("  (SearXNG not required if paid SERP keys + USE_PAID_SOURCES=true on Vercel)");
  }

  // Soft probes — don't fail the suite if optional keys missing
  const soft: Record<string, boolean> = {
    TAVILY_API_KEY: present("TAVILY_API_KEY"),
    SAM_GOV_KEY: present("SAM_GOV_KEY"),
    GEOAPIFY_API_KEY: present("GEOAPIFY_API_KEY"),
    FOURSQUARE_API_KEY: present("FOURSQUARE_API_KEY"),
    GROQ_API_KEY: present("GROQ_API_KEY") || present("OPENROUTER_API_KEY"),
    REDDIT_CLIENT_ID: present("REDDIT_CLIENT_ID"),
  };
  console.log("\n=== Soft / optional keys ===");
  for (const [k, v] of Object.entries(soft)) {
    console.log(`  ${v ? "ok " : "·· "} ${k}`);
  }

  console.log("\n=== 6. Live SERP smoke (if keys) ===");
  if (present("SERPER_API_KEY")) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY!.trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: "looking for freelance designer hiring", num: 5 }),
      });
      const j = (await res.json()) as { organic?: unknown[] };
      check(
        "Serper live search",
        res.ok && (j.organic?.length ?? 0) > 0,
        `status=${res.status} organic=${j.organic?.length ?? 0}`,
      );
    } catch (e) {
      check("Serper live search", false, String(e));
    }
  } else if (present("SERPAPI_KEY")) {
    try {
      const u = new URL("https://serpapi.com/search.json");
      u.searchParams.set("engine", "google");
      u.searchParams.set("q", "looking for freelance designer hiring");
      u.searchParams.set("api_key", process.env.SERPAPI_KEY!.trim());
      u.searchParams.set("num", "5");
      const res = await fetch(u);
      const j = (await res.json()) as { organic_results?: unknown[] };
      check(
        "SerpAPI live search",
        res.ok && (j.organic_results?.length ?? 0) > 0,
        `status=${res.status} organic=${j.organic_results?.length ?? 0}`,
      );
    } catch (e) {
      check("SerpAPI live search", false, String(e));
    }
  } else {
    console.log("  skip live SERP (no Serper/SerpAPI key)");
  }

  // Investor hunt classification → would short-circuit Discover (unit-level)
  console.log("\n=== 7. Discover investor short-circuit shape ===");
  const invHits = await searchInvestors({
    query: "FinTech",
    stage: invRef.investorStage,
    location: invRef.location || undefined,
    checkBand: invRef.investorCheck as "seed" | undefined,
    limit: 10,
  });
  check("Discover-like investor results", invHits.length > 0, `n=${invHits.length}`);
  check(
    "investor rows have name + invest locs/categories",
    invHits.every((i) => {
      const name = "name" in i && i.name;
      const cats =
        ("investment_categories" in i && (i.investment_categories?.length ?? 0) > 0) ||
        ("focus_areas" in i && ((i as { focus_areas?: string[] }).focus_areas?.length ?? 0) > 0) ||
        ("stages" in i && ((i as { stages?: string[] }).stages?.length ?? 0) > 0);
      return Boolean(name) && Boolean(cats);
    }),
  );

  console.log("\n======== SUMMARY ========");
  console.log(`passed ${results.filter((r) => r.ok).length}/${results.length}`);
  console.log(
    "\nDeploy tip: On Vercel set USE_PAID_SOURCES=true, leave SEARXNG_URL empty,",
    "set SERPER_API_KEY (or SERPAPI_KEY), MY_SUPABASE_*, and run investor migration if using DB sync.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
