/**
 * Need-phrase parser (Phase 1A) — separates ENTITY identity from REQUESTED need.
 *
 * "companies needing marketing" → requested_service=marketing (NOT industry=marketing)
 * "restaurants needing websites" → opportunity=no_website + requested_product=website
 * Plurals / stems handled via phrase grammar, not isolated token lists alone.
 */
export interface NeedPhraseResult {
  requested_service?: string;
  requested_role?: string;
  requested_product?: string;
  opportunity?: "no_website" | "stale_site" | "hiring_gap";
  /** True when the query expresses seeking/need/hiring/asking. */
  isSignal: boolean;
  signalTypes: string[];
  /** Character spans in the raw query that belong to the need phrase (for industry suppression). */
  needSpans: Array<{ start: number; end: number }>;
}

const NEED_VERB =
  /\b(?:need(?:s|ing)?|looking\s+for|asking\s+for|want(?:s|ing)?|hiring|hire|seeking|require(?:s|ing)?)\b/gi;

/** Stem-ish object matchers after a need verb (order: longer / more specific first). */
const NEED_OBJECTS: Array<{
  re: RegExp;
  map: (m: RegExpMatchArray) => Partial<NeedPhraseResult>;
}> = [
  // "needing websites" = business opportunity gap. "asking for website help"
  // is a service request / social ask — not no_website (that is structural).
  {
    re: /\b(?:a\s+)?(?:new\s+)?websites?(?:\s+help)?\b/i,
    map: (m) => {
      const help = /\bhelp\b/i.test(m[0]);
      return {
        requested_product: "website",
        requested_service: help ? "website" : undefined,
        opportunity: help ? undefined : ("no_website" as const),
        isSignal: true,
        signalTypes: help
          ? ["service_request", "social_ask"]
          : ["service_request", "opportunity"],
      };
    },
  },
  {
    re: /\b(?:a\s+)?(?:new\s+)?webs?\b/i,
    map: () => ({
      requested_product: "website",
      opportunity: "no_website" as const,
      isSignal: true,
      signalTypes: ["service_request", "opportunity"],
    }),
  },
  {
    re: /\b(?:seo|search\s+engine\s+optimization)(?:\s+help)?\b/i,
    map: () => ({
      requested_service: "seo",
      isSignal: true,
      signalTypes: ["service_request"],
    }),
  },
  {
    re: /\bmarketing(?:\s+help|\s+agency|\s+services?)?\b/i,
    map: () => ({
      requested_service: "marketing",
      isSignal: true,
      signalTypes: ["service_request"],
    }),
  },
  {
    re: /\b(?:brand\s+)?design(?:ers?|ing)?(?:\s+help)?\b/i,
    map: () => ({
      requested_service: "design",
      isSignal: true,
      signalTypes: ["service_request"],
    }),
  },
  {
    re: /\b(?:website\s+)?developers?\b/i,
    map: () => ({
      requested_role: "developer",
      isSignal: true,
      signalTypes: ["service_request", "hiring"],
    }),
  },
  {
    re: /\b(?:software\s+)?engineers?\b/i,
    map: () => ({
      requested_role: "engineer",
      isSignal: true,
      signalTypes: ["hiring"],
    }),
  },
  {
    re: /\bmarketers?\b/i,
    map: () => ({
      requested_role: "marketer",
      requested_service: "marketing",
      isSignal: true,
      signalTypes: ["hiring", "service_request"],
    }),
  },
  {
    re: /\bcopywriters?\b/i,
    map: () => ({
      requested_role: "copywriter",
      isSignal: true,
      signalTypes: ["hiring", "service_request"],
    }),
  },
  {
    re: /\b(?:sales|crm|agency|freelancer|help)\b/i,
    map: (m) => {
      const v = m[0].toLowerCase();
      if (v === "help") {
        return {
          requested_service: "help",
          isSignal: true,
          signalTypes: ["service_request"],
        };
      }
      return {
        requested_service: v,
        isSignal: true,
        signalTypes: ["service_request"],
      };
    },
  },
];

/** Standalone help phrases that imply signal without a classic need-verb object. */
const HELP_SIGNAL =
  /\b(?:seo|marketing|sales)\s+help\b|\bwithout\s+(?:a\s+|any\s+)?websites?\b|\bno\s+websites?\b|\bno\s+web\s+presence\b/i;

/**
 * Parse need / hiring / asking phrases from a query.
 * Does not set entity identity fields.
 */
export function extractNeedPhrase(rawQuery: string): NeedPhraseResult {
  const text = rawQuery ?? "";
  const out: NeedPhraseResult = {
    isSignal: false,
    signalTypes: [],
    needSpans: [],
  };

  // Explicit no-website opportunity (also a signal of prospecting intent).
  const noWeb = text.match(
    /\b(?:without\s+(?:a\s+|any\s+)?websites?|no\s+websites?|no\s+web\s+presence|need(?:s|ing)?\s+(?:a\s+)?(?:new\s+)?websites?)\b/i,
  );
  if (noWeb && noWeb.index != null) {
    out.opportunity = "no_website";
    out.requested_product = out.requested_product ?? "website";
    out.isSignal = true;
    out.signalTypes.push("opportunity", "service_request");
    out.needSpans.push({ start: noWeb.index, end: noWeb.index + noWeb[0].length });
  }

  if (HELP_SIGNAL.test(text) && !out.isSignal) {
    out.isSignal = true;
    out.signalTypes.push("service_request");
  }

  // Walk need verbs; consume an object to the right.
  NEED_VERB.lastIndex = 0;
  let vm: RegExpExecArray | null;
  while ((vm = NEED_VERB.exec(text)) !== null) {
    const verbStart = vm.index;
    const afterVerb = text.slice(vm.index + vm[0].length);
    let matched = false;
    for (const obj of NEED_OBJECTS) {
      const om = afterVerb.match(obj.re);
      if (!om || om.index == null || om.index > 48) continue;
      // Prefer objects that start soon after the verb (skip long gaps).
      const gap = afterVerb.slice(0, om.index);
      if (/[.!?]/.test(gap)) continue;
      const mapped = obj.map(om);
      Object.assign(out, {
        ...mapped,
        requested_service: mapped.requested_service ?? out.requested_service,
        requested_role: mapped.requested_role ?? out.requested_role,
        requested_product: mapped.requested_product ?? out.requested_product,
        opportunity: mapped.opportunity ?? out.opportunity,
      });
      out.isSignal = true;
      for (const t of mapped.signalTypes ?? []) {
        if (!out.signalTypes.includes(t)) out.signalTypes.push(t);
      }
      const absStart = vm.index + vm[0].length + om.index;
      out.needSpans.push({
        start: verbStart,
        end: absStart + om[0].length,
      });
      matched = true;
      break;
    }
    if (!matched && /\bhiring\b/i.test(vm[0])) {
      // Bare "hiring" with a role noun elsewhere still counts as signal.
      out.isSignal = true;
      if (!out.signalTypes.includes("hiring")) out.signalTypes.push("hiring");
      out.needSpans.push({ start: verbStart, end: verbStart + vm[0].length });
    }
  }

  // "hiring <role>" without need-verb object match above
  const hireRole = text.match(
    /\bhiring\s+([\w][\w\s.-]{0,40}?)(?:\s+in\b|\s+at\b|[.,]|$)/i,
  );
  if (hireRole && hireRole.index != null) {
    const roleRaw = hireRole[1].trim().toLowerCase();
    const craft = roleRaw.match(
      /\b(copywriters?|developers?|engineers?|designers?|marketers?|salespeople|salespersons?|recruiters?|writers?)\b/i,
    );
    if (craft) {
      const specificRole = /\bcontent\s+writers?\b/i.test(roleRaw) ? "content writer" : null;
      out.requested_role =
        specificRole ?? out.requested_role ??
        craft[1]
          .toLowerCase()
          .replace(/copywriters?/, "copywriter")
          .replace(/developers?/, "developer")
          .replace(/engineers?/, "engineer")
          .replace(/designers?/, "designer")
          .replace(/marketers?/, "marketer")
          .replace(/salespeople|salespersons?/, "salesperson")
          .replace(/recruiters?/, "recruiter")
          .replace(/writers?/, "writer");
      out.isSignal = true;
      if (!out.signalTypes.includes("hiring")) out.signalTypes.push("hiring");
      out.needSpans.push({
        start: hireRole.index,
        end: hireRole.index + hireRole[0].length,
      });
    }
  }

  // "looking for copywriters" — role as demand object for people entity
  const lookRole = text.match(
    /\b(?:looking|asking)\s+for\s+(copywriters?|developers?|engineers?|designers?|marketers?|freelancers?)\b/i,
  );
  if (lookRole && lookRole.index != null) {
    const r = lookRole[1].toLowerCase().replace(/s$/, "");
    out.requested_role = out.requested_role ?? r;
    out.isSignal = true;
    if (!out.signalTypes.includes("service_request")) out.signalTypes.push("service_request");
    if (!out.signalTypes.includes("social_ask")) out.signalTypes.push("social_ask");
    out.needSpans.push({
      start: lookRole.index,
      end: lookRole.index + lookRole[0].length,
    });
  }

  // "asking for website help" — social ask, never a structural no_website
  // opportunity. Do NOT match bare "who can help with websites" (ambiguous —
  // clarify rather than guess provider vs seeker).
  const askHelp = text.match(
    /\b(?:asking\s+for|looking\s+for|need(?:s|ing)?)\s+(?:(?:a\s+)?(?:new\s+)?)?(?:website|web|seo|marketing|design)\s+help\b/i,
  );
  if (askHelp && askHelp.index != null) {
    out.isSignal = true;
    out.requested_service =
      out.requested_service ??
      (/website|web/i.test(askHelp[0])
        ? "website"
        : /seo/i.test(askHelp[0])
          ? "seo"
          : /marketing/i.test(askHelp[0])
            ? "marketing"
            : "design");
    if (/website|web/i.test(askHelp[0])) {
      out.requested_product = out.requested_product ?? "website";
    }
    // Strip opportunity if it was set only by a website NEED_OBJECT match.
    if (out.opportunity === "no_website" && !/\b(?:without|no)\s+(?:a\s+|any\s+)?websites?\b/i.test(text)) {
      out.opportunity = undefined;
    }
    if (!out.signalTypes.includes("service_request")) out.signalTypes.push("service_request");
    if (!out.signalTypes.includes("social_ask")) out.signalTypes.push("social_ask");
    out.signalTypes = out.signalTypes.filter((t) => t !== "opportunity");
    out.needSpans.push({
      start: askHelp.index,
      end: askHelp.index + askHelp[0].length,
    });
  }

  out.signalTypes = [...new Set(out.signalTypes)];
  return out;
}

/** True if `index` falls inside any need span (industry words there must not become entity_industry). */
export function indexInNeedSpan(
  index: number,
  spans: NeedPhraseResult["needSpans"],
): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

/**
 * Funding / startup event phrasing — signal/event query, not bare directory.
 */
export function extractFundingSignal(text: string): {
  isFunding: boolean;
  isStartup: boolean;
} {
  const t = text ?? "";
  const isFunding =
    /\b(?:recently\s+)?funded\b|\bfunding\s+round\b|\braised\b|\bseries\s+[a-d]\b|\bseed\s+round\b/i.test(
      t,
    );
  const isStartup = /\bstartups?\b|\bseed[- ]?stage\b/i.test(t);
  return { isFunding, isStartup };
}
