import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

const Context = z.object({
  audience: z.enum(["companies", "agencies", "people", "all"]).optional(),
  goal: z.enum(["jobs", "clients", "both"]).optional(),
  niche: z.string().max(200).optional(),
  service: z.string().max(200).optional(),
  location: z.string().max(120).optional(),
  business: z.string().max(120).optional(),
  experience_level: z.enum(["0-1", "2-4", "5+"]).optional(),
  work_style: z.enum(["remote", "onsite", "any"]).optional(),
});

/**
 * Answers from the clarifying-question flow. Every field optional — the flow is
 * skippable by design, and applyClarifyAnswers fills recommended defaults, so
 * omitting this entirely runs the search a careful operator would have run.
 */
const ClarifyInput = z.object({
  audience: z.enum(["people", "companies", "posts", "all"]).optional(),
  buyer_type: z.enum(["startups", "smb", "agency", "enterprise", "individual", "any"]).optional(),
  geography: z.enum(["global", "us", "na", "eu", "uk", "local"]).optional(),
  experience: z.enum(["0-1", "1-2", "3-4", "5+"]).optional(),
  signal_focus: z.enum(["all", "recommend", "pain", "compare"]).optional(),
  craft: z.string().max(80).optional(),
  local_opportunity: z
    .enum(["any", "no_website", "seo_poor", "has_phone", "sales_ready"])
    .optional(),
  investor_stage: z.enum(["pre-seed", "seed", "series-a", "series-b", "any"]).optional(),
  investor_check: z.enum(["angel", "seed", "growth", "any"]).optional(),
  other: z.record(z.string(), z.string().max(120)).optional(),
});

const Input = z.object({
  query: z.string().min(2).max(300),
  context: Context.optional(),
  clarify: ClarifyInput.optional(),
  /** Search intensity: scrapy = normal, insane = deeper, crazy = maximum. */
  tier: z.enum(["scrapy", "insane", "crazy"]).optional(),
  /** Extended thinking: slower, more careful extraction + verification. */
  thinker: z.boolean().optional(),
});

/** Tier budgets: result caps, score floor adjustment, enrich caps. */
const TIER_CONFIG = {
  scrapy: { poolMul: 1, minScoreBonus: 0, enrichCap: 6, investorCap: 40 },
  insane: { poolMul: 1.5, minScoreBonus: -3, enrichCap: 10, investorCap: 60 },
  crazy: { poolMul: 2, minScoreBonus: -5, enrichCap: 16, investorCap: 100 },
} as const;

export const runSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { searchAllSources } = await import("./search/sources.server");
    const { classifyQuery, getSubredditBoostsForQuery, inferGoalFromQuery } =
      await import("./search/query-classifier");
    const { expandFromClassified } = await import("./search/query-expander");
    const { generateSmartSuggestions } = await import("./search/suggestions");
    const { dedupeByUrl, fuzzyDedupeLeads, diversifiedTop12 } = await import("./scoring");
    const { validateLeads } = await import("./validation");

    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, searches_used, searches_reset_at, years_experience")
      .eq("id", userId)
      .maybeSingle();

    let used = profile?.searches_used ?? 0;
    const resetAt = profile?.searches_reset_at ? new Date(profile.searches_reset_at) : new Date(0);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400_000);
    if (resetAt < dayAgo) {
      used = 0;
      await supabase
        .from("profiles")
        .update({ searches_used: 0, searches_reset_at: now.toISOString() })
        .eq("id", userId);
    }
    const plan = profile?.plan ?? "free";
    // Owner bypass: unlimited searches, never quota-gated (see lib/owner.ts).
    const { isOwnerEmail } = await import("./owner");
    const isOwner = isOwnerEmail(context.user.email);
    if (!isOwner && plan === "free" && used >= 5) {
      return {
        error: "limit",
        message: "Free plan: 5 searches per day. Try again tomorrow.",
        leads: [],
        sources: [] as string[],
        suggestions: [] as string[],
        queryType: "generic" as const,
      };
    }

    const tierCfg = TIER_CONFIG[data.tier ?? "scrapy"];
    const thinker = data.thinker ?? false;
    if (thinker) console.info(`[discover] thinker on (tier=${data.tier ?? "scrapy"})`);
    // AI relevance can set this later (slots.work_mode === "remote").
    let remoteSignal = false;
    const classified = classifyQuery(data.query);
    // Structured project context ("the 75% info"): audience/goal steer source
    // routing; location fills in when the query itself didn't specify one.
    const ctx = data.context;
    classified.audience = ctx?.audience ?? null;
    // Default to client-demand (people/businesses asking for the service).
    // Query text can override when the user states jobs vs selling vs demand hunt.
    const inferredGoal = inferGoalFromQuery(data.query);
    classified.goal = ctx?.goal ?? inferredGoal ?? "clients";
    if (ctx?.location && ctx.location.toLowerCase() !== "anywhere" && !classified.location) {
      classified.location = ctx.location;
    }
    // Prefer project service when the typed query is thin OR a vague umbrella skill
    // ("design", "developer") that starves related-skill expansion.
    const VAGUE_CORE = new Set([
      "design",
      "designer",
      "developer",
      "dev",
      "engineer",
      "engineering",
      "marketing",
      "help",
      "service",
      "services",
      "freelance",
      "freelancer",
    ]);
    if (
      ctx?.service?.trim() &&
      (!classified.coreSkill ||
        classified.coreSkill.length < 3 ||
        VAGUE_CORE.has(classified.coreSkill.toLowerCase()))
    ) {
      classified.coreSkill = ctx.service.trim();
    }
    // Bare "design" must carry web/UI/graphic related skills (classifyQuery now
    // does this on buying_signal; re-run a skill-only classify if still thin).
    if ((classified.relatedSkills?.length ?? 0) <= 1 && classified.coreSkill) {
      const syn = classifyQuery(`need a ${classified.coreSkill}`);
      if (syn.relatedSkills?.length > 1) {
        classified.relatedSkills = [
          ...new Set([...(classified.relatedSkills || []), ...syn.relatedSkills]),
        ];
        if (!classified.roleTitle || classified.roleTitle === classified.raw) {
          classified.roleTitle = syn.roleTitle || classified.roleTitle;
        }
      }
    }

    // ── Clarifying answers BEFORE expand so location/craft reshape queries ──
    const { applyClarifyAnswers, buildClarifyingQuestions, shouldClarify, extractStatedAudience } =
      await import("./search/clarifier");
    const { tokenizeInput } = await import("./search/tokenize-input");
    const queryTokens = tokenizeInput(data.query);
    const refinement = applyClarifyAnswers(classified, data.clarify ?? {});
    const clarifyQuestions =
      !data.clarify && shouldClarify(classified)
        ? buildClarifyingQuestions(classified, {
            hasLocation: !!classified.location,
            known: { stage: queryTokens.stage, sector: queryTokens.sector },
          })
        : [];

    const { buildSearchPlan, planUsesInvestorSeed, planNeedsLocalEnrichment } =
      await import("./search/playbook-planner");
    const searchPlanBase = buildSearchPlan(classified, refinement, {
      service: ctx?.service,
      niche: ctx?.niche,
      location: ctx?.location || classified.location,
      audience: ctx?.audience,
      goal: ctx?.goal || classified.goal,
    });
    const { refineSearchPlanWithLlm } = await import("./search/playbook-planner");
    const searchPlan =
      searchPlanBase.playbook === "CUSTOM"
        ? await refineSearchPlanWithLlm(searchPlanBase, data.query)
        : searchPlanBase;

    if (refinement.craft) {
      classified.coreSkill = refinement.craft;
    }
    if (refinement.location) {
      classified.location = refinement.location;
    }
    if (classified.location) {
      const { normalizeLocalLocation } = await import("./local/city-gazetteer");
      classified.location = normalizeLocalLocation(classified.location);
    }

    // AI relevance extraction for job/hiring goals: the LLM pulls the REAL
    // role/skill + work-mode words out of the input (deterministic tokenizer
    // facts stay ground truth) so "companies actively hiring remotely" gets
    // usable ATS/job-board terms instead of boilerplate leftovers. Cached
    // server-side; regex fallback keeps it functional without an LLM.
    if (classified.goal === "jobs") {
      try {
        const { extractSlots } = await import("./search/slot-extractor.server");
        const slots = await extractSlots(data.query, queryTokens, { maxTokens: 256 });
        const junkCore =
          !classified.coreSkill ||
          /^(actively|hiring|remotely|remote|now|asap)\b/i.test(classified.coreSkill);
        if (slots.role && junkCore) classified.coreSkill = slots.role;
        if (slots.work_mode === "remote") remoteSignal = true;
      } catch (e) {
        console.warn("[discover] AI slot extraction failed; regex path only", e);
      }
    }

    const { injectLocationBias } = await import("./search/query-expander");
    let expanded = expandFromClassified(classified);
    expanded = injectLocationBias(expanded, classified.location);

    if (refinement.craft) {
      // The user corrected what we detected — that beats extraction outright.
      expanded.skill = refinement.craft;
      expanded.relatedSkills = [refinement.craft, ...expanded.relatedSkills].slice(0, 6);
    }
    if (refinement.buyerTerms.length) {
      // Bias web discovery toward the stated buyer type without narrowing the
      // craft: "startup" + "needs a designer", not "startup designer".
      const buyerOr = refinement.buyerTerms.map((t) => `"${t}"`).join(" OR ");
      expanded.booleanWebQueries = [
        `(${buyerOr}) "${expanded.skill}" ("need" OR "looking for" OR "hiring")`,
        ...expanded.booleanWebQueries,
      ];
    }
    if (refinement.extraSubreddits.length) {
      expanded.subreddits = [
        ...new Set([...refinement.extraSubreddits, ...expanded.subreddits]),
      ].slice(0, 14);
    }
    // Query/clarifier "everything" must clear project audience (companies/people)
    // so People/Posts tabs are not wiped after a healthy fetch.
    const statedAud = extractStatedAudience(data.query);
    const refAud = refinement.audience as string;
    if (refAud === "all" || statedAud === "all") {
      classified.audience = "all";
    } else if (refAud && refAud !== "all") {
      classified.audience =
        refAud === "posts"
          ? "all"
          : refAud === "people"
            ? "people"
            : refAud === "companies"
              ? "companies"
              : classified.audience;
    }
    // Agency hunting: prepend agency-intent dorks so web discovery looks for
    // agencies needing the user's service (white label / overflow work).
    if (ctx?.audience === "agencies") {
      const svc = ctx.service || classified.coreSkill;
      expanded.booleanWebQueries = [
        `"${svc}" agency ("looking for" OR "need" OR "hiring" OR "white label" OR "overflow work")`,
        `"agency" "${svc}" ("subcontract" OR "freelancer" OR "partner")`,
        ...expanded.booleanWebQueries,
      ];
    }
    // Inject project service into relevance queries so Welcome/auto searches stay on-skill.
    if (ctx?.service?.trim()) {
      const svc = ctx.service.trim();
      expanded.booleanWebQueries = [
        `"${svc}" ("need a" OR "looking for" OR "hiring" OR "who can")`,
        ...expanded.booleanWebQueries,
      ];
    }
    const subredditBoosts = getSubredditBoostsForQuery(classified);
    const productClarify = classified.type === "product";
    const explicitYoe = !!(data.clarify?.experience || data.clarify?.other?.experience);
    const expFromClarify = productClarify ? undefined : refinement.experience;
    const exp = productClarify
      ? undefined
      : (expFromClarify ??
        (classified.goal === "jobs" ? (ctx?.experience_level ?? "0-1") : undefined));
    // AI relevance can set this later (slots.work_mode === "remote").
    const style = ctx?.work_style ?? "remote";
    const queryWantsSenior =
      /\b(senior|sr\.?|staff|principal|lead|[5-9]\+?\s*(?:years|yrs|yoe)|1[0-9]\+?\s*(?:years|yrs|yoe))\b/i.test(
        data.query,
      );
    const queryWantsOnsite = /\b(on[- ]?site|in[- ]?office|in person|onsite)\b/i.test(data.query);
    if (refinement.signalTerms?.length) {
      const focusOr = refinement.signalTerms
        .slice(0, 5)
        .map((t) => `"${t}"`)
        .join(" OR ");
      expanded.booleanWebQueries = [
        `(${focusOr}) ("${classified.coreSkill}" OR "${data.query.slice(0, 60)}")`,
        ...expanded.booleanWebQueries,
      ];
      expanded.redditBuyerQueries = [
        ...refinement.signalTerms.slice(0, 4).map((t) => `${t} ${classified.coreSkill}`),
        ...expanded.redditBuyerQueries,
      ];
    }
    const prefs = {
      yearsExperience: productClarify ? null : (profile?.years_experience ?? null),
      preferJunior: !productClarify && (exp === "0-1" || exp === "1-2") && !queryWantsSenior,
      // Project buckets use "2-4"; clarifier uses "3-4".
      preferMid: !productClarify && (exp === "2-4" || exp === "3-4") && !queryWantsSenior,
      preferSenior: !productClarify && (exp === "5+" || queryWantsSenior),
      preferRemote: (style === "remote" && !queryWantsOnsite) || remoteSignal,
      maxAgeHours: refinement.maxAgeHours,
      /** User answered YoE in clarifier — enforce even on clients ATS signals. */
      explicitExperience: explicitYoe && !!exp,
      location: classified.location ?? null,
      /** Clarifier opportunity filter for the local DB-first branch. */
      localOpportunity: refinement.localOpportunity ?? null,
    };

    // Investor outreach matches — file-first (complete JSONL), live merged as fallback/blend.
    if (planUsesInvestorSeed(searchPlan) || refinement.findInvestors) {
      const { searchInvestors } = await import("./investors/search");
      const { getInvestorSectors, getInvestorStages } = await import("./investors/types");
      // Fit score from actual slot overlap — stage/sector/geo/check/image.
      // Never a constant; every point traces to a matched filter.
      const investorFit = (inv: Record<string, unknown>): number => {
        const stages =
          "stages" in inv && Array.isArray(inv.stages)
            ? (inv.stages as string[])
            : getInvestorStages(inv as never);
        const sectors =
          "sectors" in inv && Array.isArray(inv.sectors)
            ? (inv.sectors as string[])
            : getInvestorSectors(inv as never);
        const loc = (
          ("location" in inv && typeof inv.location === "string" ? inv.location : "") +
          " " +
          (("investment_locations" in inv && Array.isArray(inv.investment_locations)
            ? (inv.investment_locations as string[]).join(" ")
            : "") ||
            ("locations" in inv && Array.isArray(inv.locations)
              ? (inv.locations as string[]).join(" ")
              : ""))
        ).toLowerCase();
        const sweet =
          ("check_max_usd" in inv && typeof inv.check_max_usd === "number"
            ? inv.check_max_usd
            : 0) ||
          ("check_min_usd" in inv && typeof inv.check_min_usd === "number" ? inv.check_min_usd : 0);
        const wantStage = (refinement.investorStage || "").toLowerCase();
        const wantSector = (refinement.investorSector || "").toLowerCase();
        const wantLoc = (refinement.location || "").toLowerCase();
        const wantCheck = refinement.investorCheck;
        let s = 60;
        if (
          wantStage &&
          wantStage !== "any" &&
          stages.some((x) => x.toLowerCase().replace(/-/g, "") === wantStage.replace(/-/g, ""))
        )
          s += 10;
        if (wantSector && sectors.some((x) => x.toLowerCase().includes(wantSector))) s += 10;
        if (wantLoc && wantLoc !== "global" && loc.includes(wantLoc)) s += 10;
        if (wantCheck && wantCheck !== "any") {
          if (wantCheck === "angel" && sweet > 0 && sweet < 100_000) s += 5;
          if (wantCheck === "seed" && sweet >= 100_000 && sweet <= 5_000_000) s += 5;
          if (wantCheck === "growth" && sweet > 5_000_000) s += 5;
        }
        if ("image_url" in inv && typeof inv.image_url === "string" && inv.image_url) s += 3;
        return Math.min(s, 98);
      };
      const { searchCompleteInvestors } = await import("./investors/local-file-source");
      const { decideSource, insufficientMessage } = await import("./search/source-router");
      type Lead = import("./scoring").Lead;
      // Requested scale: parse "20+"/"100+" from query, default 12.
      const requestedCount = (() => {
        const m = data.query.match(/(\d+)\s*\+/);
        return m ? Number(m[1]) : 12;
      })();
      const localMatches = (() => {
        try {
          return searchCompleteInvestors({
            query: data.query,
            stage: refinement.investorStage,
            location: refinement.location || undefined,
            checkBand: refinement.investorCheck,
            sector: refinement.investorSector || undefined,
            limit: 100,
          });
        } catch {
          return [];
        }
      })();
      const decision = decideSource(classified, localMatches.length, requestedCount);
      const liveInvestors =
        decision === "local"
          ? []
          : await searchInvestors({
              query: data.query,
              stage: refinement.investorStage,
              location: refinement.location || undefined,
              checkBand: refinement.investorCheck,
              sector: refinement.investorSector || undefined,
              limit: 40,
            });
      // Map complete-file rows to investor shape (every row traces to JSONL provenance).
      const localAsInvestors = localMatches.map((r) => ({
        id: r.id,
        type: "individual" as const,
        name: r.name,
        firm: r.firm,
        role: r.role,
        entity_type: "vc" as const,
        email: r.email,
        location: r.location,
        investment_locations: [r.location],
        investment_categories: r.stages.flatMap((st) => r.sectors.map((s) => `${st} (${s})`)),
        links: { linkedin: r.linkedin, website: r.website },
        website: r.website ?? undefined,
        image_url: r.image_url,
        information_completeness_score: r.completeness,
        _provenance: r.provenance,
      }));
      // Blend + dedupe by email/id; local wins on conflict.
      const seenKeys = new Set(localAsInvestors.map((r) => `${r.email}|${r.id}`.toLowerCase()));
      const blendedLive = liveInvestors.filter((inv: { id: string; email?: string | null }) => {
        const email = String(inv.email ?? "").toLowerCase();
        const key = `${email}|${inv.id}`.toLowerCase();
        if (seenKeys.has(key)) return false;
        if (email && [...seenKeys].some((k) => k.startsWith(email))) return false;
        return true;
      });
      let investors = [...localAsInvestors, ...blendedLive].slice(
        0,
        Math.max(tierCfg.investorCap, requestedCount),
      );
      // Completeness gate: every served row must carry a contact route.
      // Email-less rows run through free-only enrichment (bounded); rows still
      // contact-less after it are dropped, never shown. Nothing is fabricated.
      let gateNote: string | null = null;
      const hasEmail = (inv: unknown) => {
        const e = (inv as { email?: unknown }).email;
        return typeof e === "string" && e.includes("@");
      };
      const emailed = investors.filter(hasEmail);
      const emailLess = investors.filter((inv) => !hasEmail(inv));
      if (emailLess.length > 0 && emailed.length < requestedCount) {
        const { discoverContacts } = await import("./contact/discover-contacts.server");
        let enriched = 0;
        const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
          Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
        for (const inv of emailLess.slice(0, tierCfg.enrichCap)) {
          try {
            const rec = inv as {
              firm?: string;
              name?: string;
              website?: string;
              email?: string;
            };
            const company = typeof rec.firm === "string" && rec.firm ? rec.firm : (rec.name ?? "");
            const found = await withTimeout(
              discoverContacts({
                company: String(company).slice(0, 80),
                personName: typeof rec.name === "string" ? rec.name : undefined,
                freeOnly: true,
                maxPages: 3,
                skipRegistries: true,
              }),
            );
            const email = found?.emails?.[0]?.email;
            if (email) {
              rec.email = email;
              enriched++;
            }
          } catch {
            // Enrichment is best-effort; failures just hide the row below.
          }
        }
        const hidden = investors.length - emailed.length - enriched;
        investors = investors.filter(hasEmail);
        const bits: string[] = [];
        if (enriched > 0)
          bits.push(`${enriched} contact${enriched === 1 ? "" : "s"} found via lookup`);
        if (hidden > 0) bits.push(`${hidden} without contact info hidden`);
        if (bits.length) gateNote = bits.join(" · ");
      } else if (emailLess.length > 0) {
        const hidden = emailLess.length;
        investors = emailed;
        gateNote = `${hidden} without contact info hidden`;
      }
      const insufficientBase =
        decision === "blend" || investors.length < requestedCount
          ? insufficientMessage(investors.length, requestedCount)
          : null;
      const insufficient = [insufficientBase, gateNote].filter(Boolean).join(" · ") || null;

      const mappedPeople = investors
        .filter((inv) => !("type" in inv) || inv.type === "individual")
        .map((inv) => {
          const name = inv.name;
          const firm = "firm" in inv ? inv.firm : "";
          const role = "role" in inv ? inv.role : "title" in inv ? inv.title : "";
          const locs =
            "investment_locations" in inv
              ? inv.investment_locations
              : "locations" in inv
                ? inv.locations
                : [];

          const fit = investorFit(inv as unknown as Record<string, unknown>);
          // Carry the DB email onto the row: every downstream contact surface
          // (green box, mailto chips, table column, detail drawer) reads it.
          const dbEmail =
            "email" in inv && typeof inv.email === "string" && inv.email.includes("@")
              ? inv.email
              : undefined;
          const inline = dbEmail
            ? { emails: [dbEmail], phones: [], links: [] as string[] }
            : undefined;
          // About: real bio first (160 chars), else an organized summary from
          // the record's structured fields — "role at firm · invests at
          // Pre-seed & Series A · invests in cloud, cybersecurity · based in
          // Boston". Raw "Stage (Sector)" category strings never display.
          const rawBio = "bio" in inv && typeof inv.bio === "string" ? inv.bio.trim() : "";
          const invStages = (
            "stages" in inv && Array.isArray(inv.stages) ? (inv.stages as unknown[]) : []
          )
            .filter((s): s is string => typeof s === "string" && !!s.trim())
            .slice(0, 3)
            .map((s) => s.replace(/_/g, "-"));
          // Long sector entries are concatenated category blobs — keep only
          // clean labels so the summary reads like a sentence, not a dump.
          const cleanSectors = (
            "sectors" in inv && Array.isArray(inv.sectors) ? (inv.sectors as unknown[]) : []
          )
            .filter(
              (s): s is string =>
                typeof s === "string" && s.trim().length > 0 && s.trim().length <= 40,
            )
            .slice(0, 3);
          const aboutLocation =
            locs[0] || ("location" in inv && typeof inv.location === "string" ? inv.location : "");
          const description = rawBio
            ? rawBio.slice(0, 160)
            : [
                [role, firm].filter(Boolean).join(" at "),
                invStages.length ? `invests at ${invStages.join(" & ")}` : "",
                cleanSectors.length
                  ? `invests in ${cleanSectors.map((s) => s.toLowerCase()).join(", ")}`
                  : "",
                aboutLocation ? `based in ${aboutLocation}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
          // Why-match sentence from actually-matched slots.
          const whyBits: string[] = [];
          const wantStage = (refinement.investorStage || "").toLowerCase();
          const wantSector = (refinement.investorSector || "").toLowerCase();
          if (wantStage && wantStage !== "any")
            whyBits.push(`backs ${refinement.investorStage} rounds`);
          if (wantSector) whyBits.push(`invests in ${refinement.investorSector}`);
          if (refinement.location) whyBits.push(`active in ${refinement.location}`);
          const whyMatch = `Investor at ${firm}${whyBits.length ? ` — ${whyBits.join(", ")}` : ""}.`;
          const lead: Lead = {
            source: "investors",
            platform: "Investors",
            title: `${name} — ${firm}`,
            subtitle: [role, locs.join(", ")].filter(Boolean).join(" · ") || undefined,
            snippet: description,
            full_post_url: `https://www.google.com/search?q=${encodeURIComponent(name + " " + firm + " investor")}`,
            author: name,
            posted_at: undefined,
            score: fit,
            match_reasons: ["Investor match"],
            ...(inline ? { inline_contacts: inline } : {}),
          };

          const invLinks =
            "links" in inv ? (inv.links as { linkedin?: string } | undefined) : undefined;
          const invProfiles =
            "profiles" in inv ? (inv.profiles as { linkedin?: string } | undefined) : undefined;
          const liUrl =
            ("linkedin" in inv && typeof inv.linkedin === "string" ? inv.linkedin : undefined) ||
            ("linkedin_url" in inv && typeof inv.linkedin_url === "string"
              ? inv.linkedin_url
              : undefined) ||
            invLinks?.linkedin ||
            invProfiles?.linkedin ||
            undefined;
          return {
            key: `inv:${inv.id}`,
            name,
            title_hint: role,
            role_hint: role || undefined,
            company_hint: firm,
            location_hint: locs.join(", ") || undefined,
            linkedin_url: liUrl,
            description,
            why_match: whyMatch,
            sample_url: lead.full_post_url,
            signal_count: 1,
            ...(inline ? { inline_contacts: inline } : {}),
            lead,
            score: fit,
          };
        });
      // Social gate — every displayed investor must carry a real profile link
      // (the DB is 1,252/1,252 LinkedIn). Rows without one are dropped and
      // logged, never shown as dash-filled rows, never fabricated.
      const people = mappedPeople.filter((p) => !!p.linkedin_url);
      if (mappedPeople.length !== people.length) {
        console.info(
          `[investors] dropped ${mappedPeople.length - people.length} individual(s) without a LinkedIn profile`,
        );
      }

      const mappedCompanies = investors
        .filter((inv) => "type" in inv && inv.type === "firm")
        .map((inv) => {
          const categories = "investment_categories" in inv ? inv.investment_categories : [];
          const website = "website" in inv && typeof inv.website === "string" ? inv.website : "";
          const links =
            "links" in inv ? (inv.links as { linkedin?: string } | undefined) : undefined;
          const domain = website
            ? website.replace(/^https?:\/\//, "").split("/")[0] || undefined
            : undefined;
          return {
            key: inv.id,
            name: inv.name,
            domain,
            description: `VC Firm · ${categories.slice(0, 3).join(", ")}`,
            why_now: categories.slice(0, 3).join(", "),
            signal_count: 1,
            platforms: ["Investors"],
            website: website || undefined,
            linkedin_url: links?.linkedin || undefined,
            inline_contacts:
              website || links?.linkedin
                ? {
                    emails: [],
                    phones: [],
                    links: [website, links?.linkedin].filter(Boolean) as string[],
                  }
                : undefined,
            sample_url: website,
            leads: [],
            score: investorFit(inv as unknown as Record<string, unknown>),
          };
        });
      // Social gate for firms — LinkedIn or a real website, never a bare name.
      const companies = mappedCompanies.filter((c) => !!(c.linkedin_url || c.website));
      // Owner runs unlimited searches — never tick the daily counter.
      if (!isOwner) {
        await supabase
          .from("profiles")
          .update({ searches_used: used + 1, searches_reset_at: now.toISOString() })
          .eq("id", userId);
      }
      // Investor hunts are completed searches too — log them like the main
      // path does, otherwise they never appear in chat history.
      const investorSources =
        decision === "local"
          ? ["investors-complete-file"]
          : ["investors-complete-file", "investors"];
      await supabase.from("search_history").insert({
        user_id: userId,
        query: data.query,
        results_count: investors.length,
        sources_searched: investorSources,
      });
      return {
        error: null,
        message: insufficient,
        // Investors live ONLY in people/companies shapes — dumping them into
        // posts/leads made the unified feed render every investor twice
        // (People section + Posts cards).
        leads: [],
        posts: [],
        companies,
        people,
        local: [],
        investors,
        sources: investorSources,
        suggestions: ["Try FinTech Seed", "Climate investors in Europe", "Angel check under $50K"],
        queryType: classified.type,
        refinement: insufficient ? `${refinement.summary} · ${insufficient}` : refinement.summary,
        clarifyQuestions: [],
        plan: searchPlan,
      };
    }

    // Companies-DB seed rows (hiring companies) — collected in the jobs
    // branch below, merged into the companies segment after segmentation.
    const companySeedRows: import("./search/lead-segments").CompanyRow[] = [];
    // People-DB seed rows (directory + user CSVs) — collected below,
    // merged into the people segment after segmentation.
    const peopleSeedRows: import("./search/lead-segments").PersonRow[] = [];

    let {
      leads: raw,
      sources,
      debug,
    } = await searchAllSources({
      classified,
      expanded,
      subredditBoosts,
      prefs,
    });

    if (searchPlan.playbook === "GENERAL_PEOPLE") {
      try {
        const { searchCompletePeople } = await import("./people/local-file-source");
        peopleSeedRows.push(
          ...(await searchCompletePeople({
            query: `${classified.coreSkill || ""} ${data.query}`,
            role:
              classified.roleTitle && classified.roleTitle !== classified.raw
                ? classified.roleTitle
                : null,
            location: classified.location,
            limit: 24,
          })),
        );
        if (peopleSeedRows.length) sources = [...new Set([...sources, "people_db"])];
      } catch (e) {
        console.warn("[discover] people DB blend failed", e);
      }
    }

    if (searchPlan.playbook === "JOB_DISCOVERY") {
      try {
        const { ensureJobCatalogRegistered } = await import("./jobs/source-catalog");
        const { ensureFreehireSourceRegistered } = await import("./jobs/freehire-source");
        const { fetchAllJobSources } = await import("./jobs/registry");
        ensureJobCatalogRegistered();
        ensureFreehireSourceRegistered();
        const extraJobs = await fetchAllJobSources({
          query: classified.roleTitle || classified.coreSkill || data.query,
          location: classified.location || "",
          remoteOnly: !!prefs.preferRemote,
          limit: 80,
        });
        const seen = new Set(raw.map((l) => l.full_post_url));
        for (const j of extraJobs) {
          if (!j.url || seen.has(j.url)) continue;
          seen.add(j.url);
          raw.push({
            source: j.source.replace(/^source-(ats-)?/, ""),
            platform: j.source.replace(/^source-(ats-)?/, ""),
            title: `${j.title} @ ${j.company}`,
            snippet: [j.location, j.salary, j.description]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 400),
            full_post_url: j.url,
            author: j.company,
            posted_at: j.posted_at || undefined,
            engagement: 40,
            is_decision_maker: true,
          });
        }
        if (extraJobs.length) sources = [...new Set([...sources, "jobcatalog"])];
      } catch (e) {
        console.warn("[discover] job catalog merge failed", e);
      }

      // Companies DB blend: actively-hiring companies from the companies DB
      // (YC directory hiring flags today; registry-derived hiring signals as
      // the datasets grow) — the user asked for companies, not only postings.
      // Merged into the companies segment AFTER segmentation (declared here,
      // that scope has no companies array yet).
      try {
        const { searchCompleteCompanies } = await import("./companies/local-file-source");
        companySeedRows.push(
          ...(await searchCompleteCompanies({
            query: classified.coreSkill || data.query,
            hiringOnly: true,
            location: classified.location,
            limit: 24,
          })),
        );
        if (companySeedRows.length) sources = [...new Set([...sources, "companies_db"])];
      } catch (e) {
        console.warn("[discover] companies DB blend failed", e);
      }
    }

    if (planNeedsLocalEnrichment(searchPlan) && classified.location) {
      const localCount = raw.filter((l) =>
        ["osm", "geoapify", "foursquare", "coreclaw_maps"].includes(l.source),
      ).length;
      if (localCount < 8) {
        try {
          const { searchOsmLocalBusinesses } = await import("./search/osm-local-businesses.server");
          const extraLocal = await searchOsmLocalBusinesses(expanded, classified.location);
          const seenLoc = new Set(raw.map((l) => (l.author || l.title).toLowerCase()));
          for (const l of extraLocal) {
            const k = (l.author || l.title).toLowerCase();
            if (seenLoc.has(k)) continue;
            seenLoc.add(k);
            raw.push(l);
          }
          if (extraLocal.length) sources = [...new Set([...sources, "osm"])];
        } catch (e) {
          console.warn("[discover] local osm merge failed", e);
        }
      }
    }

    // 1) exact-URL dedup, then 2) cross-source fuzzy dedup (Task 1.1) so the
    // same job on a job board + a LinkedIn mention collapse to one lead.
    const { isStronglyRelevantToSkill, isWeakFamilyTerm } = await import("./search/query-expander");
    const { enrichLeadWhy, scoreLead } = await import("./scoring");
    const { scoreUrgency, detectDemandBuckets, scoreIntentFit } =
      await import("./search/intent-lexicon");
    const { segmentLeads, applyJobDiscoveryBoost } = await import("./search/lead-segments");

    // Stage funnel tracing: SCRAPIVO_DEBUG_STAGES=1 prints per-source counts at
    // each attrition point, so "35 fetched but 3 shown" is diagnosable.
    const traceStages = !!process.env.SCRAPIVO_DEBUG_STAGES;
    const trace = (stage: string, arr: ReadonlyArray<{ source?: string }>) => {
      if (!traceStages) return;
      const by: Record<string, number> = {};
      for (const l of arr) by[l.source ?? "?"] = (by[l.source ?? "?"] ?? 0) + 1;
      const top = Object.entries(by)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}:${n}`)
        .join(" ");
      console.log(`[stages] ${stage.padEnd(12)} ${String(arr.length).padStart(4)}  ${top}`);
    };

    const deduped = fuzzyDedupeLeads(dedupeByUrl(raw));
    trace("raw", raw);
    trace("deduped", deduped);
    let validated = validateLeads(deduped, classified, expanded, prefs);
    // Soft-keep only when validate emptied a healthy multi-source fetch —
    // never paper over a zero-source / single-source Reddit-only collapse.
    const sourceVariety = new Set(deduped.map((l) => l.source).filter(Boolean)).size;
    if (
      validated.length === 0 &&
      deduped.length >= 8 &&
      sourceVariety >= 2 &&
      (classified.goal === "clients" || classified.signalMode === "buying_signal")
    ) {
      const { isStronglyRelevantToSkill: strongSkill } = await import("./search/query-expander");
      const {
        isSellerOrProviderLead: isSeller,
        isPersonalStoryNoise: isStory,
        isEducationalNoise: isEdu,
        isLikelyScam: isScam,
        isOffSkillRole: isOffSkill,
        hasExpiredSignal: isExpired,
        isMarketplaceOrListicle: isListicle,
        JOB_BOARD_SOURCES: boards,
        detectBuyerIntent,
      } = await import("./validation");
      validated = deduped
        .filter((l) => {
          if (
            isScam(l) ||
            isSeller(l, classified.coreSkill, classified.relatedSkills) ||
            isStory(l) ||
            isEdu(l)
          )
            return false;
          if (isOffSkill(l, classified.coreSkill, classified.relatedSkills)) return false;
          if (isExpired(l) || isListicle(l)) return false;
          if (l.ai_role_in_post === "seeker" || l.ai_intent === "seeker") return false;
          const text = `${l.title} ${l.snippet}`;
          const skillOk =
            strongSkill(text, classified.coreSkill) ||
            classified.relatedSkills.slice(0, 8).some((s) => strongSkill(text, s));
          if (!skillOk) return false;
          if (boards.has(l.source)) return true;
          return (
            detectBuyerIntent(text).isBuyer ||
            /\b(need (a|an|someone)|looking for (a|an)|looking to hire|who can|willing to pay|\[hiring\]|we(?:'| a)?re hiring)\b/i.test(
              text,
            )
          );
        })
        .slice(0, 16)
        .map((l) => ({
          ...l,
          score: Math.min(l.score ?? 0, 45),
          match_reasons: [...(l.match_reasons ?? []), "Active hire ask"].slice(0, 6),
        }));
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[runSearch] validate emptied ${deduped.length} → soft-kept ${validated.length}`,
        );
      }
    }

    // Sampled URL liveness — drop confirmed dead / gone links before ranking.
    try {
      const { filterAliveLeads } = await import("./search/fetch-gate.server");
      validated = await filterAliveLeads(validated, { sample: 20, concurrency: 5 });
      trace("alive", validated);
    } catch {
      /* optional */
    }

    const directoryMode = classified.intentMode === "directory_smb";
    const skillGate = (ctx?.service?.trim() || classified.coreSkill || "").trim();
    const { isOpenNiche, normalizeNiche } = await import("./project-context");
    // "all" / "anyone" etc. from Q/A → no niche boost/filter.
    const nicheNeedle = isOpenNiche(ctx?.niche) ? "" : normalizeNiche(ctx?.niche).toLowerCase();
    if (ctx?.niche && isOpenNiche(ctx.niche)) {
      // Keep stored value but never treat it as an ICP noun filter.
      classified.icpNoun = classified.icpNoun || null;
    }
    const relatedOk = (text: string) =>
      classified.relatedSkills.some(
        (s) =>
          s.length > 3 &&
          !isWeakFamilyTerm(s) &&
          !/^(lead|leads|generation|service|services|client|clients)$/i.test(s) &&
          isStronglyRelevantToSkill(text, s),
      );
    const skillOkFor = (text: string) => {
      if (directoryMode) return true;
      if (
        isStronglyRelevantToSkill(text, skillGate) ||
        isStronglyRelevantToSkill(text, classified.coreSkill) ||
        relatedOk(text)
      ) {
        return true;
      }
      const lower = text.toLowerCase();
      // Product pitches: invoice↔invoicing — never bare lead/services/generation.
      if (classified.type === "product") {
        const bag = [classified.coreSkill, ...classified.relatedSkills];
        for (const t of bag) {
          const tl = t.toLowerCase().trim();
          if (tl.length >= 6 && /\s/.test(tl) && lower.includes(tl)) return true;
          for (const w of tl.split(/\s+/)) {
            if (w.length < 5) continue;
            if (
              /^(lead|leads|generation|service|services|client|clients|with|from|that|this|help|need|find)$/i.test(
                w,
              )
            ) {
              continue;
            }
            if (new RegExp(`(?<![a-z0-9+#])${w}(?![a-z0-9])`).test(lower)) return true;
            if (w.startsWith("invoice") && /invoice/.test(lower)) return true;
          }
        }
        return /invoice|invoicing|billing|bookkeep|client acquisition|lead\s*gen|crm\b/i.test(
          lower,
        );
      }
      if (/tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${classified.raw}`)) {
        return /\b(tutor|tutoring|homework|lessons|instructor)\b/i.test(lower);
      }
      return false;
    };
    const SEEKER_RE =
      /\b(i(?:'| a)?m a|i am a|available for (hire|work)|open to work|looking for (work|a (job|role|position))|for hire|hire me|i will build|hire me to)\b/i;
    const CLEAR_THIRD_PARTY_BUYER_RE =
      /\b(need someone to|who can (build|help|make)|willing to pay|our (startup|company|team) needs|looking to hire)\b/i;

    trace("validated", validated);

    const ranked = validated.map((l) => {
      const text = `${l.title} ${l.snippet}`;
      const skillOk = skillOkFor(text);
      const lead = enrichLeadWhy(
        { ...l, score: scoreLead(l) },
        skillOk ? skillGate || classified.coreSkill : undefined,
      );
      // Cross-signal: funding/growth timing boosts marketing/growth ICPs
      const demand = detectDemandBuckets(text);
      const urg = scoreUrgency(text);
      if (
        demand.buckets.includes("timing") &&
        /market|growth|seo|ads|gtm/i.test(classified.coreSkill + classified.raw)
      ) {
        lead.score = (lead.score ?? 0) + 12;
        lead.match_reasons = [
          ...(lead.match_reasons ?? []),
          "Timing/growth signal relevant to marketing ICP",
        ].slice(0, 6);
      }
      // Explicit “I need a X” + skill overlap
      if (demand.buckets.includes("explicit_demand") && skillOk) {
        lead.score = (lead.score ?? 0) + 10;
      }
      if (urg.hasUrgency) lead.score = (lead.score ?? 0) + 6;
      if (nicheNeedle && text.toLowerCase().includes(nicheNeedle)) {
        lead.score = (lead.score ?? 0) + 8;
        lead.match_reasons = [
          ...(lead.match_reasons ?? []),
          `Matches your niche (${ctx?.niche})`,
        ].slice(0, 6);
      }
      // Published contact in the post = higher trust / outreach readiness.
      if (
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text) ||
        /t\.me\/|wa\.me\/|discord\.gg\//i.test(text)
      ) {
        lead.score = (lead.score ?? 0) + 6;
        lead.match_reasons = [...(lead.match_reasons ?? []), "Contact published in the post"].slice(
          0,
          6,
        );
      }
      // Hard-demote seekers / "I am a web developer looking for work"
      if (
        lead.ai_role_in_post === "seeker" ||
        lead.ai_intent === "seeker" ||
        (SEEKER_RE.test(text) && !CLEAR_THIRD_PARTY_BUYER_RE.test(text))
      ) {
        lead.score = Math.min(lead.score ?? 0, 28);
      }
      const fit = scoreIntentFit({
        text,
        skillRelevant: skillOk,
        hasEvidenceUrl: !!lead.full_post_url,
      });
      lead.score = Math.round((lead.score ?? 0) * 0.7 + fit * 0.3);
      // JOB_DISCOVERY merge: job-native leads rank above generic web-search
      // cards; non-job-shaped web rows are demoted so postings win.
      if (searchPlan.playbook === "JOB_DISCOVERY") {
        const [boosted] = applyJobDiscoveryBoost([{ lead, text }]);
        return boosted;
      }
      return lead;
    });

    // Quality gate: drop seekers; for clients require real buyer signal + skill
    // (skill-alone was letting tutorials / listicles into Posts).
    const {
      isHirePolarityLookingFor,
      leadIntentText,
      isSellerOrProviderLead,
      isSalesFamilyCraft,
      isSalesTalentHireAsk,
      isPersonalStoryNoise,
      isEducationalNoise,
      detectProductIntent,
    } = await import("./validation");
    const { isProfileShapedLead } = await import("./search/lead-segments");
    const {
      isRecent: isRecentDate,
      CLIENTS_SOCIAL_MAX_AGE_DAYS,
      ATS_COMPANY_MAX_AGE_DAYS,
    } = await import("./search/query-expander");
    const UNDATED_DROP_SOURCES = new Set([
      "linkedin",
      "serpapi",
      "tavily",
      "webboolean",
      "searxng",
      "instagram",
      "facebook",
      "github",
    ]);
    const salesCraft = isSalesFamilyCraft(classified.coreSkill, classified.relatedSkills);
    const craftHireTerms = [
      classified.coreSkill,
      classified.roleTitle,
      ...(classified.relatedSkills ?? []),
    ].filter((t): t is string => !!t && t.trim().length >= 3);
    const LINKEDIN_FREELANCE_BUYER_RE =
      /\b(freelancer|contractor|freelance|budget|who can|need someone to|looking to hire|looking for (a|an|someone)|willing to pay|need a (freelance|contractor|developer|designer|sales)|looking for a (sales|sdr|bdr|salesperson|designer|developer)|anyone recommend|\[hiring\])\b/i;
    // Posting on one of these is itself an act of buying — the org/person put
    // the work up publicly with intent to pay. No hire grammar required.
    const DEMAND_BY_SOURCE = new Set([
      "greenhouse",
      "lever",
      "ashby",
      "smartrecruiters",
      "workable",
      "recruitee",
      "jobicy",
      "arbeitnow",
      "freelancer",
      "tenders",
      "stackexchange",
      "dealroom",
      "neuronfeed",
      "workatastartup",
      "startupsgallery",
    ]);
    // Include "looking for a/an" — matches SERP/social dork phrasing.
    const TITLE_HIRE_RE =
      /\b(i(?:'| a)?m (looking|need)|we(?:'| a)?re (looking|hiring|need)|looking to hire|looking for (a|an|someone)|need (a|an|someone)|who can|willing to pay|freelancer needed|help wanted|\[hiring\]|we're hiring|we are hiring)\b/i;
    const BODY_HIRE_RE =
      /\b(need a|need an|need someone|looking to hire|looking for (a|an|someone)|who can|willing to pay|freelancer needed|help wanted|\[hiring\]|we're hiring|we are hiring|hiring (a |an )?(designer|developer|freelancer|sales|sdr|bdr)|looking for a (sales|salesperson|sdr|bdr))\b/i;
    const quality = directoryMode
      ? ranked
      : ranked.filter((l) => {
          const title = l.title || "";
          const text = leadIntentText(l);
          const fullText = `${l.title} ${l.snippet}`;
          if (l.ai_role_in_post === "seeker" || l.ai_intent === "seeker") return false;
          if (SEEKER_RE.test(fullText) && !CLEAR_THIRD_PARTY_BUYER_RE.test(fullText)) return false;
          if (isSellerOrProviderLead(l, classified.coreSkill, classified.relatedSkills))
            return false;
          if (isPersonalStoryNoise(l) || isEducationalNoise(l)) return false;
          // LinkedIn thought-leadership / listicles that match "need a designer"
          // as prose, not a hire ask ("So You Need a Designer in 2026").
          if (
            l.source === "linkedin" &&
            /\b(so you need|how to (hire|find|become)|why you (need|should)|tips for hiring|ultimate guide|unpaid design tests|hiring trend|strong belief|emotion\s*=|thoughts on|a day in the life)\b/i.test(
              title,
            ) &&
            !/\b(we(?:'| a)?re hiring|looking to hire|looking for (a|an)|\[hiring\]|willing to pay|dm me|apply (now|here))\b/i.test(
              fullText,
            )
          ) {
            return false;
          }
          const urg = scoreUrgency(text);
          const demand = detectDemandBuckets(text);
          const skillOk = skillOkFor(fullText);
          if (skillGate && !skillOk) return false;
          const goalNow = classified.goal ?? "clients";
          const clientsMode = goalNow === "clients" || classified.signalMode === "buying_signal";
          // Bare profile pages are not Posts; keep only if clearly a field DM
          // for the People tab.
          if (
            clientsMode &&
            isProfileShapedLead(l) &&
            !(
              l.is_decision_maker &&
              skillOk &&
              /\b(cto|ceo|coo|founder|co-?founder|owner|director|vp\b|head of|sales|sdr|bdr)\b/i.test(
                fullText,
              )
            )
          ) {
            return false;
          }
          // Field decision-makers (CTO/founder) — keep for People even undated.
          const dmRelevant =
            !!l.is_decision_maker &&
            skillOk &&
            /\b(cto|ceo|coo|founder|co-?founder|owner|director|vp\b|head of)\b/i.test(fullText);
          const isSocial =
            l.source === "reddit" ||
            l.source === "twitter" ||
            l.source === "hn" ||
            l.source === "linkedin" ||
            l.source === "instagram" ||
            l.source === "facebook" ||
            l.source === "bluesky" ||
            l.source === "mastodon" ||
            l.source === "lemmy" ||
            l.source === "discourse";
          // Company boards (ATS etc.): 7d. Social/web: 2d.
          const maxAgeDays = DEMAND_BY_SOURCE.has(l.source)
            ? ATS_COMPANY_MAX_AGE_DAYS
            : CLIENTS_SOCIAL_MAX_AGE_DAYS;
          if (clientsMode && l.posted_at && !isRecentDate(l.posted_at, maxAgeDays) && !dmRelevant) {
            return false;
          }
          // Hard-drop undated SERP/web/IG/FB. Keep LinkedIn /posts/ with slug
          // only when we still need People fill — but prefer dated.
          const isLiPostWithAuthor =
            l.source === "linkedin" &&
            /linkedin\.com\/posts\//i.test(l.full_post_url || "") &&
            !!(l.author || /linkedin\.com\/posts\/[A-Za-z0-9-]+_/i.test(l.full_post_url || ""));
          // Time-boxed SERP only when the engine used a day/hour window.
          // Week + demand_verified kept when hire grammar matches (thin-day fill).
          const timeBoxed =
            l.freshness_window === "day" ||
            l.freshness_window === "hour" ||
            (l.demand_verified === true &&
              (l.freshness_window === "day" || l.freshness_window === "hour"));
          const weekHireOk =
            l.demand_verified === true &&
            l.freshness_window === "week" &&
            (TITLE_HIRE_RE.test(title) ||
              BODY_HIRE_RE.test(text) ||
              isHirePolarityLookingFor(title, craftHireTerms) ||
              isHirePolarityLookingFor(text, craftHireTerms));
          // Serper rarely returns dates — week-boxed + demand_verified social is the normal case.
          const weekSocialOk =
            l.demand_verified === true &&
            l.freshness_window === "week" &&
            (l.source === "linkedin" ||
              l.source === "twitter" ||
              l.source === "facebook" ||
              l.source === "instagram" ||
              l.source === "serpapi");
          if (
            clientsMode &&
            !l.posted_at &&
            !timeBoxed &&
            !weekHireOk &&
            !weekSocialOk &&
            UNDATED_DROP_SOURCES.has(l.source) &&
            !(
              isLiPostWithAuthor &&
              (BODY_HIRE_RE.test(text) || isSalesTalentHireAsk(text) || TITLE_HIRE_RE.test(title))
            ) &&
            !dmRelevant
          ) {
            return false;
          }
          // Instagram/Facebook: keep demand_verified week-window social.
          if (
            clientsMode &&
            !l.posted_at &&
            !timeBoxed &&
            !weekHireOk &&
            !weekSocialOk &&
            !(
              l.demand_verified === true &&
              (TITLE_HIRE_RE.test(title) || BODY_HIRE_RE.test(text))
            ) &&
            (l.source === "instagram" || l.source === "facebook")
          ) {
            return false;
          }
          // Also drop undated news / dealroom / github / hn for clients —
          // these were the "Recently (undated)" and megathread junk paths.
          if (
            clientsMode &&
            !l.posted_at &&
            !timeBoxed &&
            !dmRelevant &&
            (l.source === "news" ||
              l.source === "dealroom" ||
              l.source === "neuronfeed" ||
              l.source === "github" ||
              (l.source === "hn" && /who is hiring|ask hn/i.test(l.title || "")))
          ) {
            return false;
          }
          // Sources where the act of posting IS the demand signal: a company
          // opening a role on its own ATS, a buyer posting a paid project, a
          // public tender. These never carry "we're hiring" grammar in the
          // title, so the hire-grammar gate below dropped 100% of them — which
          // is why Companies was always 0 while Reddit ("[HIRING] need a
          // designer") sailed through. Relevance still enforced, and on the
          // TITLE only, never the description.
          const sourceIsDemand = DEMAND_BY_SOURCE.has(l.source) && skillOkFor(l.title || "");
          // Product pitches hunt customers/competitors — hire-grammar is wrong.
          // Accept product-intent / customer-pain language + skill match.
          const productMode = classified.type === "product";
          if (productMode && clientsMode) {
            const productish =
              detectProductIntent(fullText) ||
              urg.hasUrgency ||
              demand.buckets.length > 0 ||
              sourceIsDemand ||
              dmRelevant ||
              /\b(looking for (a |an )?(tool|app|software|saas|platform|alternative)|switching from|recommend .{0,24}(tool|app|software)|anyone use|need (a |an )?(better |good )?(way|tool|app)|competitor|pricing|customers? for)\b/i.test(
                fullText,
              );
            if (!productish && !skillOk) return false;
            if (
              /\b(hire me|my portfolio|my rates|available for hire|open to work|check out my gig|dm me your)\b/i.test(
                text,
              ) &&
              !detectProductIntent(fullText)
            ) {
              return false;
            }
            const scoreFloor = l.posted_at && isSocial ? 28 : 34;
            return skillOk && ((l.score ?? 0) >= scoreFloor || productish || dmRelevant);
          }
          if (clientsMode) {
            const titleBuyer =
              TITLE_HIRE_RE.test(title) ||
              isHirePolarityLookingFor(title, craftHireTerms) ||
              isSalesTalentHireAsk(title) ||
              CLEAR_THIRD_PARTY_BUYER_RE.test(title);
            const bodyBuyer =
              urg.hasUrgency ||
              demand.buckets.includes("explicit_demand") ||
              CLEAR_THIRD_PARTY_BUYER_RE.test(text) ||
              isHirePolarityLookingFor(text, craftHireTerms) ||
              isSalesTalentHireAsk(text) ||
              BODY_HIRE_RE.test(text);
            const llmBuyer =
              l.ai_role_in_post === "buyer" ||
              l.ai_intent === "hiring" ||
              l.ai_intent === "buying" ||
              l.ai_intent === "researching";
            // Dated social may use body hire; undated/web still needs title hire.
            // Time-boxed / week-hire SERP counts as dated for buyer heuristics.
            const datedOrBoxed = !!l.posted_at || timeBoxed || weekHireOk;
            const heuristicBuyer =
              titleBuyer ||
              (bodyBuyer && datedOrBoxed && isSocial) ||
              (bodyBuyer && !/\bstarting at\s*\$/i.test(title) && isSocial) ||
              (salesCraft && isSalesTalentHireAsk(text) && (timeBoxed || weekHireOk));
            const buyerish =
              heuristicBuyer || (llmBuyer && (titleBuyer || bodyBuyer || datedOrBoxed || isSocial));
            // Twitter/X / LinkedIn: short buyer asks — dated OR SERP time-boxed.
            const twitterKeep =
              l.source === "twitter" &&
              skillOk &&
              datedOrBoxed &&
              (bodyBuyer || titleBuyer || urg.hasUrgency || (l.score ?? 0) >= 40);
            const linkedInKeep =
              l.source === "linkedin" &&
              skillOk &&
              datedOrBoxed &&
              (bodyBuyer ||
                titleBuyer ||
                LINKEDIN_FREELANCE_BUYER_RE.test(text) ||
                CLEAR_THIRD_PARTY_BUYER_RE.test(text));
            if (!buyerish && !dmRelevant && !twitterKeep && !linkedInKeep && !sourceIsDemand)
              return false;
            if (
              /\b(hire me|my portfolio|my rates|available for hire|open to work|check out my gig|need a pro .{0,40} service|get a quote|for your (business|company|startup)|dm me your|commission[- ]based partner|starting at\s*\$|let'?s fix that room|try (our|my) (agent|tool|service)|i built (an? |this )?(ai )?agent)\b/i.test(
                text,
              ) &&
              !CLEAR_THIRD_PARTY_BUYER_RE.test(text) &&
              !(salesCraft && isSalesTalentHireAsk(text))
            ) {
              return false;
            }
            if (l.source === "linkedin" && !dmRelevant && !linkedInKeep) {
              if (
                !titleBuyer &&
                !LINKEDIN_FREELANCE_BUYER_RE.test(text) &&
                !CLEAR_THIRD_PARTY_BUYER_RE.test(text) &&
                !(llmBuyer && (titleBuyer || bodyBuyer)) &&
                !BODY_HIRE_RE.test(text) &&
                !isSalesTalentHireAsk(text)
              ) {
                return false;
              }
            }
            // Dated social: lower score floor; undated/web still needs 36+.
            const scoreFloor = datedOrBoxed && isSocial ? 28 : dmRelevant ? 30 : 36;
            return skillOk && ((l.score ?? 0) >= scoreFloor || buyerish || dmRelevant);
          }
          return urg.hasUrgency || demand.buckets.length > 0 || skillOk || (l.score ?? 0) >= 50;
        });

    trace("quality", quality);

    const goal = classified.goal ?? "clients";
    const qualityPool = quality.length;
    const volumePersona =
      classified.type === "product" ||
      /tutor|teacher|tutoring/i.test(`${classified.coreSkill} ${classified.raw}`);
    const clientsVolume =
      goal === "clients" || classified.signalMode === "buying_signal" || volumePersona;
    // Large pool for three-figure Posts / Companies / People — segment BEFORE
    // diversify so tab volume is not capped by a thin ranked cut.
    const poolCap = Math.round(
      (clientsVolume || (goal === "both" && qualityPool >= 80) ? 500 : 320) * tierCfg.poolMul,
    );
    const qualitySorted = [...quality].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const pool = qualitySorted.slice(0, poolCap);

    const maxTotal = poolCap;
    const rankedForFeed = diversifiedTop12(pool, {
      directoryMode,
      maxJobBoard: goal === "jobs" ? 8 : goal === "both" ? 4 : 2,
      // Company-identity ATS boards are the Companies segment on the clients
      // path — an org posting a role for this craft IS a prospective buyer.
      maxCompanyAts: goal === "jobs" ? 20 : 150,
      minSocial: goal === "jobs" ? 2 : clientsVolume ? 15 : 5,
      // Cap Reddit/Freelancer so social / Upwork / gov / communities can surface.
      maxReddit: clientsVolume ? 18 : Math.min(8, maxTotal),
      maxTotal,
      // Warm floor (35) — enough to cut junk without starving sparse crafts.
      // Higher tiers lower the floor to surface more leads.
      minScore: clientsVolume ? Math.max(0, 35 + tierCfg.minScoreBonus) : 0,
      maxPerPlatform: maxTotal,
      maxFreelancer: clientsVolume ? 18 : Math.min(12, maxTotal),
    });
    trace("diversified", rankedForFeed);

    // Always-on compact funnel log (local + production) for mix diagnosis.
    {
      const bySrc = (arr: ReadonlyArray<{ source?: string }>) => {
        const by: Record<string, number> = {};
        for (const l of arr) by[l.source ?? "?"] = (by[l.source ?? "?"] ?? 0) + 1;
        return Object.entries(by)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([s, n]) => `${s}:${n}`)
          .join(" ");
      };
      console.info(
        `[discover] raw=${raw.length} quality=${quality.length} pool=${pool.length} out=${rankedForFeed.length} | quality_by ${bySrc(quality)} | out_by ${bySrc(rankedForFeed)} | fetch ${debug?.sourceCounts ? JSON.stringify(debug.sourceCounts) : "{}"}`,
      );
    }

    // Segment from the full quality pool (not only the diversify cut) so
    // Companies/People can reach three figures when supply exists.
    let segments = segmentLeads(pool, { craft: classified.coreSkill || expanded.skill });
    // Posts feed: diversify for mix (Freelancer soft-cap + social pin).
    segments = {
      ...segments,
      posts: rankedForFeed,
      companies: [
        // Companies-DB hiring rows lead the segment — real verified companies,
        // not name-extracted posts.
        ...companySeedRows.filter((s) => !segments.companies.some((c) => c.key === s.key)),
        ...segments.companies,
      ].slice(0, 150),
      people: [
        // People-DB directory rows lead — verified directory records,
        // not name-extracted posts.
        ...peopleSeedRows.filter((s) => !segments.people.some((p) => p.key === s.key)),
        ...segments.people,
      ].slice(0, 150),
      local: (segments.local || []).slice(0, 150),
    };

    // Top 2–3 cards: PIE contact harvest (regex → page → capped enrich → LLM).
    // Fail-soft with a hard time budget so Discover never stalls.
    let leadsWithContacts = rankedForFeed;
    try {
      const { enrichTopLeadContacts } = await import("./contact/pie-top-leads.server");
      leadsWithContacts = await Promise.race([
        enrichTopLeadContacts(rankedForFeed),
        new Promise<typeof rankedForFeed>((r) => setTimeout(() => r(rankedForFeed), 12_000)),
      ]);
      // Keep enriched contact fields on the posts tab when URLs match.
      if (leadsWithContacts !== rankedForFeed) {
        const byUrl = new Map(leadsWithContacts.map((l) => [l.full_post_url || "", l]));
        segments = {
          ...segments,
          posts: segments.posts.map((p) => byUrl.get(p.full_post_url || "") || p),
        };
      }
    } catch {
      leadsWithContacts = rankedForFeed;
    }

    // Audience scopes tabs — but NEVER return a blank Posts feed when we have
    // underlying signal leads (that caused "0 posts" empty-state with Companies > 0).
    // Only wipe when the user explicitly chose companies-only / people-only.
    const aud = classified.audience ?? "all";
    const dedupeUrls = (arr: typeof rankedForFeed) => {
      const seen = new Set<string>();
      return arr.filter((l) => {
        const u = l.full_post_url || "";
        if (!u || seen.has(u)) return false;
        seen.add(u);
        return true;
      });
    };
    if (aud === "people") {
      segments = {
        posts: dedupeUrls(segments.people.map((p) => p.lead)),
        companies: [],
        people: segments.people,
        local: [],
      };
    } else if (aud === "companies" || aud === "agencies") {
      segments = {
        posts: dedupeUrls(segments.companies.flatMap((c) => c.leads)),
        companies: segments.companies,
        people: [],
        local: segments.local,
      };
    }
    // If scoped segment still has no posts but ranked leads exist, keep the leads
    // as posts so Discover is never a blank wall.
    if (!segments.posts.length && leadsWithContacts.length) {
      segments = { ...segments, posts: leadsWithContacts };
    }

    // Free identity enrichment for the top companies (Wikidata, ~300ms each,
    // hard 4s budget). Fills website/LinkedIn/X without paid credit.
    try {
      const { wikidataCompanyLookup, wikidataPersonLookup } =
        await import("./contact/free-registries.server");
      const targets = segments.companies.slice(0, 12).filter((c) => !c.website || !c.linkedin_url);
      if (targets.length) {
        await Promise.race([
          Promise.allSettled(
            targets.map(async (c) => {
              const w = await wikidataCompanyLookup(c.name);
              if (!w) return;
              if (!c.website && w.website) {
                c.website = w.website;
                try {
                  c.domain = c.domain || new URL(w.website).hostname.replace(/^www\./, "");
                } catch {
                  /* keep existing domain */
                }
              }
              c.linkedin_url = c.linkedin_url || w.socials.linkedin;
              c.twitter_url = c.twitter_url || w.socials.twitter;
              if (!c.description && w.hq) {
                c.description = `${c.name} — ${w.hq}`;
              }
            }),
          ),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
      }
      // Best-effort person socials for top people missing profile links.
      const peopleTargets = segments.people
        .slice(0, 8)
        .filter((p) => !p.linkedin_url && !p.github_url && !p.author_url);
      if (peopleTargets.length) {
        await Promise.race([
          Promise.allSettled(
            peopleTargets.map(async (p) => {
              const w = await wikidataPersonLookup(p.name);
              if (!w) return;
              p.linkedin_url = p.linkedin_url || w.socials.linkedin;
              p.github_url = p.github_url || w.socials.github;
              if (!p.author_url && w.socials.twitter) p.author_url = w.socials.twitter;
            }),
          ),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      }
      // ScrapeGraphAI: enrich top companies still missing a website (fail-soft).
      try {
        const { enrichCompaniesWithScrapegraph } = await import("./search/scrapegraph.server");
        await enrichCompaniesWithScrapegraph(segments.companies, 6);
      } catch {
        /* optional enricher */
      }
    } catch {
      /* enrichment is best-effort */
    }

    // Local businesses: harvest website emails + MillionVerifier for top rows.
    try {
      const locals = segments.local || [];
      const targets = locals.filter((b) => b.website && !b.email).slice(0, 8);
      if (targets.length) {
        const { harvestDomainContacts } = await import("./contact/harvest.server");
        const { verifyEmailDeep } = await import("./contact/verify-contact.server");
        await Promise.race([
          Promise.allSettled(
            targets.map(async (b) => {
              try {
                const host = b.domain || new URL(b.website!).hostname.replace(/^www\./, "");
                const harvested = await harvestDomainContacts(host);
                const email = harvested?.emails?.[0]?.email;
                if (!email) return;
                b.email = email;
                const v = await verifyEmailDeep(email);
                b.email_verified = v.tier === "verified";
                b.verify_note = v.label;
              } catch {
                /* skip one */
              }
            }),
          ),
          new Promise((r) => setTimeout(r, 10_000)),
        ]);
      }
      // Verify emails already present on OSM tags.
      const withEmail = locals.filter((b) => b.email && !b.verify_note).slice(0, 6);
      if (withEmail.length) {
        const { verifyEmailDeep } = await import("./contact/verify-contact.server");
        await Promise.race([
          Promise.allSettled(
            withEmail.map(async (b) => {
              const v = await verifyEmailDeep(b.email!);
              b.email_verified = v.tier === "verified";
              b.verify_note = v.label;
            }),
          ),
          new Promise((r) => setTimeout(r, 8_000)),
        ]);
      }
    } catch {
      /* local enrich optional */
    }

    const suggestions =
      leadsWithContacts.length === 0 ||
      (classified.intentMode === "directory_smb" && !classified.location)
        ? generateSmartSuggestions(classified)
        : [];

    if (process.env.NODE_ENV === "development" && debug) {
      console.info("[runSearch]", {
        query: data.query,
        ...debug,
        afterDedup: deduped.length,
        afterValidate: validated.length,
        afterQuality: quality.length,
        afterTop10: leadsWithContacts.length,
      });
    }

    // Owner runs unlimited searches — never tick the daily counter.
    if (!isOwner) {
      await supabase.from("profiles").update({ searches_used: used + 1 }).eq("id", userId);
    }
    await supabase.from("search_history").insert({
      user_id: userId,
      query: data.query,
      results_count: leadsWithContacts.length,
      sources_searched: sources,
    });

    if (traceStages) {
      console.log(
        `[stages] SEGMENTS    posts:${segments.posts.length} ` +
          `companies:${segments.companies.length} people:${segments.people.length} ` +
          `local:${segments.local?.length ?? 0}`,
      );
    }

    return {
      leads: leadsWithContacts,
      posts: segments.posts,
      companies: segments.companies,
      people: segments.people,
      local: segments.local || [],
      sources,
      suggestions,
      queryType: classified.type,
      /**
       * Clarifying-question flow. `clarify` is the question set to show when
       * the query was vague; `refinement.summary` is what we actually assumed,
       * shown back so the user can see and correct it rather than guessing why
       * results look the way they do.
       *
       * Returned WITH results, never instead of them — the questions refine a
       * search that already ran, so nobody is blocked behind a form.
       */
      clarify: clarifyQuestions,
      refinement: refinement.summary,
      plan: searchPlan,
      error: null as string | null,
      message: null as string | null,
    };
  });

export const getRemainingSearches = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, searches_used, searches_reset_at")
      .eq("id", userId)
      .maybeSingle();
    const plan = profile?.plan ?? "free";
    let used = profile?.searches_used ?? 0;
    const resetAt = profile?.searches_reset_at ? new Date(profile.searches_reset_at) : new Date(0);
    if (resetAt < new Date(Date.now() - 86400_000)) used = 0;
    const { isOwnerEmail } = await import("./owner");
    const owner = isOwnerEmail(context.user.email);
    const cap = owner || plan !== "free" ? Infinity : 5;
    // Owner is unlimited — never present an accruing counter as a budget.
    return { plan, used: owner ? 0 : used, cap: cap === Infinity ? null : cap };
  });

/**
 * Classify a query and return clarifying questions WITHOUT searching.
 *
 * Exists so the question flow can run BEFORE results instead of after. The
 * original design showed questions alongside results (refine what you already
 * have), but that means the first search is the wrong one and the user watches
 * it happen — asking first is what was actually wanted.
 *
 * Deliberately cheap: classification only, no source fan-out, no network, no
 * search-quota consumption. Safe to call on every keystroke-completed query.
 */
export const prepareSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(2).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const { classifyQuery } = await import("./search/query-classifier");
    const { buildClarifyingQuestions, shouldClarify, applyClarifyAnswers } =
      await import("./search/clarifier");
    const classified = classifyQuery(data.query);
    const needed = shouldClarify(classified);
    const { tokenizeInput } = await import("./search/tokenize-input");
    const prepTokens = tokenizeInput(data.query);
    return {
      needsClarify: needed,
      questions: needed
        ? buildClarifyingQuestions(classified, {
            hasLocation: !!classified.location,
            known: { stage: prepTokens.stage, sector: prepTokens.sector },
          })
        : [],
      // What we'd assume if they skip — shown so the flow never feels like a
      // black box they're forced through.
      defaultSummary: applyClarifyAnswers(classified, {}).summary,
    };
  });
