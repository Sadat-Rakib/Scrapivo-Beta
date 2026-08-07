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
  other: z.record(z.string(), z.string().max(120)).optional(),
});

const Input = z.object({
  query: z.string().min(2).max(300),
  context: Context.optional(),
  clarify: ClarifyInput.optional(),
});

export const runSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { searchAllSources } = await import("./search/sources.server");
    const { classifyQuery, getSubredditBoostsForQuery } = await import("./search/query-classifier");
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
    if (plan === "free" && used >= 5) {
      return {
        error: "limit",
        message: "Free plan: 5 searches per day. Try again tomorrow.",
        leads: [],
        sources: [] as string[],
        suggestions: [] as string[],
        queryType: "generic" as const,
      };
    }

    const classified = classifyQuery(data.query);
    // Structured project context ("the 75% info"): audience/goal steer source
    // routing; location fills in when the query itself didn't specify one.
    const ctx = data.context;
    classified.audience = ctx?.audience ?? null;
    // Default to client-demand (people/businesses asking for the service).
    classified.goal = ctx?.goal ?? "clients";
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
    const expanded = expandFromClassified(classified);

    // ── Clarifying answers → concrete search inputs ────────────────────────
    // Applied BEFORE the audience/service tweaks below so an explicit user
    // choice ("target startups") shapes the same query fields those use.
    const { applyClarifyAnswers, buildClarifyingQuestions, shouldClarify } =
      await import("./search/clarifier");
    const refinement = applyClarifyAnswers(classified, data.clarify ?? {});
    // Only offer questions when the query was actually vague AND the user
    // hasn't already answered them.
    const clarifyQuestions =
      !data.clarify && shouldClarify(classified)
        ? buildClarifyingQuestions(classified, { hasLocation: !!classified.location })
        : [];

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
    // Apply clarifier location / audience (previously computed then ignored).
    if (refinement.location) {
      classified.location = refinement.location;
    }
    if (refinement.audience && refinement.audience !== "all") {
      classified.audience =
        refinement.audience === "posts"
          ? "all"
          : refinement.audience === "people"
            ? "people"
            : refinement.audience === "companies"
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
    // Product clarifiers ask signal focus, not YoE — don't force junior filters.
    const productClarify = classified.type === "product";
    const expFromClarify = productClarify ? undefined : refinement.experience;
    const exp = productClarify
      ? undefined
      : (expFromClarify ?? ctx?.experience_level ?? "0-1");
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
      preferRemote: style === "remote" && !queryWantsOnsite,
      maxAgeHours: refinement.maxAgeHours,
    };

    const {
      leads: raw,
      sources,
      debug,
    } = await searchAllSources({
      classified,
      expanded,
      subredditBoosts,
      prefs,
    });

    // 1) exact-URL dedup, then 2) cross-source fuzzy dedup (Task 1.1) so the
    // same job on a job board + a LinkedIn mention collapse to one lead.
    const { isStronglyRelevantToSkill, isWeakFamilyTerm } = await import("./search/query-expander");
    const { enrichLeadWhy, scoreLead } = await import("./scoring");
    const { scoreUrgency, detectDemandBuckets, scoreIntentFit } =
      await import("./search/intent-lexicon");
    const { segmentLeads } = await import("./search/lead-segments");

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
    // Never return a blank Discover when we still have skill-matched posts —
    // validate was wiping design SERP/Upwork hits (off-skill + negativeSignals).
    if (
      validated.length === 0 &&
      deduped.length > 0 &&
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
          if (isScam(l) || isSeller(l, classified.coreSkill, classified.relatedSkills) || isStory(l) || isEdu(l))
            return false;
          if (isOffSkill(l, classified.coreSkill, classified.relatedSkills)) return false;
          if (isExpired(l) || isListicle(l)) return false;
          if (l.ai_role_in_post === "seeker" || l.ai_intent === "seeker") return false;
          const text = `${l.title} ${l.snippet}`;
          const skillOk =
            strongSkill(text, classified.coreSkill) ||
            classified.relatedSkills.slice(0, 8).some((s) => strongSkill(text, s));
          if (!skillOk) return false;
          // Soft-keep must still look like demand or a company opening —
          // skill-alone was re-admitting POV/notes after validate emptied.
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
            if (/^(lead|leads|generation|service|services|client|clients|with|from|that|this|help|need|find)$/i.test(w)) {
              continue;
            }
            if (new RegExp(`(?<![a-z0-9+#])${w}(?![a-z0-9])`).test(lower)) return true;
            if (w.startsWith("invoice") && /invoice/.test(lower)) return true;
          }
        }
        return /invoice|invoicing|billing|bookkeep|client acquisition|lead\s*gen|crm\b/i.test(lower);
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
      return lead;
    });

    // Quality gate: drop seekers; for clients require real buyer signal + skill
    // (skill-alone was letting tutorials / listicles into Posts).
    const { isHirePolarityLookingFor, leadIntentText, isSellerOrProviderLead, isSalesFamilyCraft, isSalesTalentHireAsk, isPersonalStoryNoise, isEducationalNoise, detectProductIntent } =
      await import("./validation");
    const { isProfileShapedLead } = await import("./search/lead-segments");
    const { isRecent: isRecentDate, CLIENTS_SOCIAL_MAX_AGE_DAYS, ATS_COMPANY_MAX_AGE_DAYS } =
      await import("./search/query-expander");
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
          if (isSellerOrProviderLead(l, classified.coreSkill, classified.relatedSkills)) return false;
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
          if (
            clientsMode &&
            !l.posted_at &&
            !timeBoxed &&
            !weekHireOk &&
            UNDATED_DROP_SOURCES.has(l.source) &&
            !(isLiPostWithAuthor && (BODY_HIRE_RE.test(text) || isSalesTalentHireAsk(text) || TITLE_HIRE_RE.test(title))) &&
            !dmRelevant
          ) {
            return false;
          }
          // Instagram/Facebook: undated drops unless the query itself was
          // time-boxed (same reasoning as above — the engine did the dating).
          if (
            clientsMode &&
            !l.posted_at &&
            !timeBoxed &&
            !weekHireOk &&
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
          const sourceIsDemand =
            DEMAND_BY_SOURCE.has(l.source) && skillOkFor(l.title || "");
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
              heuristicBuyer ||
              (llmBuyer && (titleBuyer || bodyBuyer || datedOrBoxed || isSocial));
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
    const maxTotal =
      goal === "both" && qualityPool >= 80
        ? 500
        : goal === "clients" || classified.signalMode === "buying_signal" || volumePersona
          ? 450
          : 280;
    const leads = diversifiedTop12(quality, {
      directoryMode,
      maxJobBoard: goal === "jobs" ? 8 : goal === "both" ? 4 : 2,
      // Company-identity ATS boards are the Companies segment on the clients
      // path — an org posting a role for this craft IS a prospective buyer.
      maxCompanyAts: goal === "jobs" ? 20 : 120,
      minSocial: goal === "jobs" ? 2 : goal === "clients" ? 10 : 5,
      maxReddit: goal === "clients" ? 40 : maxTotal,
      maxTotal,
      // Warm floor (45) — volume without weak / no-signal rows.
      minScore:
        goal === "clients" || classified.signalMode === "buying_signal" || volumePersona
          ? 45
          : 0,
      maxPerPlatform: maxTotal,
      // Cap Freelancer so social/public/ATS can surface in the viewport.
      maxFreelancer: goal === "clients" || classified.signalMode === "buying_signal" ? 30 : maxTotal,
    });
    trace("diversified", leads);

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
        `[discover] raw=${raw.length} quality=${quality.length} out=${leads.length} | quality_by ${bySrc(quality)} | out_by ${bySrc(leads)} | fetch ${debug?.sourceCounts ? JSON.stringify(debug.sourceCounts) : "{}"}`,
      );
    }

    // Top 2–3 cards: PIE contact harvest (regex → page → capped enrich → LLM).
    // Fail-soft with a hard time budget so Discover never stalls.
    let leadsWithContacts = leads;
    try {
      const { enrichTopLeadContacts } = await import("./contact/pie-top-leads.server");
      leadsWithContacts = await Promise.race([
        enrichTopLeadContacts(leads),
        new Promise<typeof leads>((r) => setTimeout(() => r(leads), 12_000)),
      ]);
    } catch {
      leadsWithContacts = leads;
    }

    let segments = segmentLeads(leadsWithContacts);
    // Audience scopes tabs — but NEVER return a blank Posts feed when we have
    // underlying signal leads (that caused "0 posts" empty-state with Companies > 0).
    const aud = classified.audience ?? "all";
    const dedupeUrls = (arr: typeof leads) => {
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
      };
    } else if (aud === "companies" || aud === "agencies") {
      segments = {
        posts: dedupeUrls(segments.companies.flatMap((c) => c.leads)),
        companies: segments.companies,
        people: [],
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

    const suggestions =
      leadsWithContacts.length === 0 || (classified.intentMode === "directory_smb" && !classified.location)
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

    await supabase
      .from("profiles")
      .update({ searches_used: used + 1 })
      .eq("id", userId);
    await supabase.from("search_history").insert({
      user_id: userId,
      query: data.query,
      results_count: leadsWithContacts.length,
      sources_searched: sources,
    });

    if (traceStages) {
      console.log(
        `[stages] SEGMENTS    posts:${segments.posts.length} ` +
          `companies:${segments.companies.length} people:${segments.people.length}`,
      );
    }

    return {
      leads: leadsWithContacts,
      posts: segments.posts,
      companies: segments.companies,
      people: segments.people,
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
    const cap = plan === "free" ? 5 : Infinity;
    return { plan, used, cap: cap === Infinity ? null : cap };
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
    return {
      needsClarify: needed,
      questions: needed
        ? buildClarifyingQuestions(classified, { hasLocation: !!classified.location })
        : [],
      // What we'd assume if they skip — shown so the flow never feels like a
      // black box they're forced through.
      defaultSummary: applyClarifyAnswers(classified, {}).summary,
    };
  });
