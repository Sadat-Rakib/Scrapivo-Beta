// Scrapivo search Edge Function
//
// Required secrets (supabase secrets set):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SERPAPI_KEY, SCRAPECREATORS_KEY, TAVILY_API_KEY, GITHUB_TOKEN (optional)
//
// Deploy secrets must match the Supabase project hosting profiles + search_history.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expandQuery } from "./query-expander.ts";
import { deduplicateLeads } from "./intent-filter.ts";
import type { Lead } from "./types.ts";

import { searchReddit } from "./sources/reddit.ts";
import { searchHackerNews } from "./sources/hackernews.ts";
import { searchTwitter } from "./sources/twitter.ts";
import { searchLinkedIn } from "./sources/linkedin.ts";
import { searchBluesky } from "./sources/bluesky.ts";
import { searchInstagram } from "./sources/instagram.ts";
import { searchFacebook } from "./sources/facebook.ts";
import { searchTikTok } from "./sources/tiktok.ts";
import { searchUpwork } from "./sources/upwork.ts";
import { searchRemoteOK } from "./sources/remoteok.ts";
import { searchGreenhouse, searchLever } from "./sources/greenhouse.ts";
import { searchGitHub } from "./sources/github.ts";
import { searchGoogleJobs, searchWellfound } from "./sources/google_jobs.ts";
import { searchTavily } from "./sources/tavily.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("searches_used, searches_reset_at, plan")
      .eq("id", user.id)
      .single();

    const resetAt = new Date(profile?.searches_reset_at || 0);
    const hoursSince = (Date.now() - resetAt.getTime()) / 3600000;
    let searchesUsed = hoursSince >= 24 ? 0 : (profile?.searches_used || 0);
    if (hoursSince >= 24) {
      await supabase
        .from("profiles")
        .update({ searches_used: 0, searches_reset_at: new Date().toISOString() })
        .eq("id", user.id);
    }
    const plan = profile?.plan || "free";
    const limit = plan === "pro" || plan === "studio" ? 100 : 5;
    if (searchesUsed >= limit) {
      return new Response(
        JSON.stringify({ error: "Daily search limit reached", limit }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const rawQuery = (body.query || "").trim();
    if (!rawQuery || rawQuery.length < 2) {
      return new Response(JSON.stringify({ error: "Query too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const query = expandQuery(rawQuery);
    console.log(`Searching for: ${query.skill} (${query.role})`);

    const sourceFns: Array<{ name: string; fn: () => Promise<Lead[]> }> = [
      { name: "reddit", fn: () => searchReddit(query) },
      { name: "hackernews", fn: () => searchHackerNews(query) },
      { name: "twitter", fn: () => searchTwitter(query) },
      { name: "linkedin", fn: () => searchLinkedIn(query) },
      { name: "bluesky", fn: () => searchBluesky(query) },
      { name: "instagram", fn: () => searchInstagram(query) },
      { name: "facebook", fn: () => searchFacebook(query) },
      { name: "tiktok", fn: () => searchTikTok(query) },
      { name: "upwork", fn: () => searchUpwork(query) },
      { name: "remoteok", fn: () => searchRemoteOK(query) },
      { name: "greenhouse", fn: () => searchGreenhouse(query) },
      { name: "lever", fn: () => searchLever(query) },
      { name: "google_jobs", fn: () => searchGoogleJobs(query) },
      { name: "wellfound", fn: () => searchWellfound(query) },
      { name: "github", fn: () => searchGitHub(query) },
      { name: "tavily", fn: () => searchTavily(query) },
    ];

    const results = await Promise.allSettled(sourceFns.map((s) => s.fn()));

    const allLeads: Lead[] = [];
    const sourceCounts: Record<string, number> = {};

    results.forEach((r, i) => {
      const name = sourceFns[i].name;
      if (r.status === "fulfilled") {
        sourceCounts[name] = r.value.length;
        allLeads.push(...r.value);
      } else {
        sourceCounts[name] = 0;
        console.error(`Source ${name} failed:`, r.reason);
      }
    });

    console.log("Raw results by source:", sourceCounts);

    const final = deduplicateLeads(allLeads)
      .filter((l) => l.intent_score > 0 && l.post_url && l.post_body_snippet)
      .sort((a, b) => b.intent_score - a.intent_score)
      .slice(0, 30);

    await supabase.from("search_history").insert({
      user_id: user.id,
      query: rawQuery,
      results_count: final.length,
      sources_searched: [...new Set(final.map((l) => l.platform))],
    });
    await supabase
      .from("profiles")
      .update({ searches_used: searchesUsed + 1 })
      .eq("id", user.id);

    return new Response(
      JSON.stringify({
        results: final,
        query: rawQuery,
        skill: query.skill,
        role: query.role,
        total: final.length,
        sources_searched: [...new Set(final.map((l) => l.platform))],
        raw_count: allLeads.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Search error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
