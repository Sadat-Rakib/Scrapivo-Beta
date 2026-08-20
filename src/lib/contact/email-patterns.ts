// =====================================================================
// Email pattern inference & derivation
//
// Emails are the only contact type that is *derivable* — there is no algorithm
// that produces a phone number from a name, but org email is a template applied
// to a name. That asymmetry is why this file exists and why phone discovery
// costs ~3.5x email everywhere.
//
// The workhorse loop is: harvest ONE address at a domain → infer the template
// that produced it → apply that template to every other person you know at the
// company. One found address unlocks the whole org, which is why the harvest
// layer matters far more than the guessing layer.
//
// Honesty rule baked in here: a derived address is a HYPOTHESIS. It carries a
// prior, never a verdict. Whether it survives contact with reality is the
// verifier's job (verify-email.server.ts), and if the domain is catch-all, it
// never can be confirmed at all and must stay labelled as inferred.
// =====================================================================

export type PatternId =
  | "first.last"
  | "firstlast"
  | "flast"
  | "first_last"
  | "first-last"
  | "f.last"
  | "firstl"
  | "first"
  | "last"
  | "last.first"
  | "lastfirst"
  | "lastf"
  | "f.l"
  | "fl";

export type EmailPattern = {
  id: PatternId;
  /** Base rate across orgs — the prior before any evidence from this domain. */
  prior: number;
  /** Build the local part. Returns "" when the name can't fill the template. */
  build: (first: string, last: string) => string;
  label: string;
};

// Priors are rounded from published corpus studies of B2B address formats.
// They are approximations on purpose: their only job is to rank candidates so
// the verifier probes the likely ones first, not to be a calibrated posterior.
export const EMAIL_PATTERNS: EmailPattern[] = [
  {
    id: "first.last",
    prior: 0.33,
    label: "first.last",
    build: (f, l) => (f && l ? `${f}.${l}` : ""),
  },
  { id: "first", prior: 0.15, label: "first", build: (f) => f },
  { id: "flast", prior: 0.13, label: "flast", build: (f, l) => (f && l ? `${f[0]}${l}` : "") },
  { id: "firstlast", prior: 0.11, label: "firstlast", build: (f, l) => (f && l ? `${f}${l}` : "") },
  { id: "firstl", prior: 0.05, label: "firstl", build: (f, l) => (f && l ? `${f}${l[0]}` : "") },
  {
    id: "first_last",
    prior: 0.05,
    label: "first_last",
    build: (f, l) => (f && l ? `${f}_${l}` : ""),
  },
  { id: "f.last", prior: 0.04, label: "f.last", build: (f, l) => (f && l ? `${f[0]}.${l}` : "") },
  { id: "last", prior: 0.03, label: "last", build: (_f, l) => l },
  {
    id: "last.first",
    prior: 0.03,
    label: "last.first",
    build: (f, l) => (f && l ? `${l}.${f}` : ""),
  },
  { id: "lastf", prior: 0.02, label: "lastf", build: (f, l) => (f && l ? `${l}${f[0]}` : "") },
  {
    id: "first-last",
    prior: 0.02,
    label: "first-last",
    build: (f, l) => (f && l ? `${f}-${l}` : ""),
  },
  { id: "lastfirst", prior: 0.02, label: "lastfirst", build: (f, l) => (f && l ? `${l}${f}` : "") },
  { id: "f.l", prior: 0.01, label: "f.l", build: (f, l) => (f && l ? `${f[0]}.${l[0]}` : "") },
  { id: "fl", prior: 0.01, label: "fl", build: (f, l) => (f && l ? `${f[0]}${l[0]}` : "") },
];

const PATTERN_BY_ID = new Map(EMAIL_PATTERNS.map((p) => [p.id, p]));

// Surname particles stay glued to the surname ("van der Berg" → vandenberg-ish
// forms), because that's what mail admins actually do with them.
const SURNAME_PARTICLES = new Set([
  "van",
  "von",
  "de",
  "del",
  "della",
  "der",
  "den",
  "di",
  "da",
  "dos",
  "das",
  "la",
  "le",
  "el",
  "al",
  "bin",
  "ibn",
  "ben",
  "mac",
  "mc",
  "st",
  "saint",
  "abu",
]);

// Honorifics and post-nominals that are not part of the name.
const NAME_NOISE = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "professor",
  "sir",
  "madam",
  "phd",
  "md",
  "mba",
  "cpa",
  "esq",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "cto",
  "ceo",
  "coo",
  "cfo",
  "founder",
  "cofounder",
  "director",
  "manager",
]);

export type ParsedName = {
  first: string;
  last: string;
  /** Normalised full name, useful as a dedupe key. */
  full: string;
  ok: boolean;
};

/**
 * Normalise a display name into ASCII first/last parts suitable for a local
 * part. Accents are folded (mail admins overwhelmingly fold them: "Müller" →
 * "mueller"/"muller" — we emit both downstream), honorifics dropped, middle
 * names dropped, particles kept with the surname.
 */
export function parsePersonName(raw: string): ParsedName {
  const cleaned = (raw || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/['‘’`]/g, "") // O'Brien → OBrien
    .toLowerCase()
    .replace(/[^a-z\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "Smith, Jane" → "Jane Smith"
  const commaFlipped = /^([a-z.\- ]+),\s*([a-z.\- ]+)$/.exec(raw?.toLowerCase() ?? "");
  const source = commaFlipped ? `${commaFlipped[2]} ${commaFlipped[1]}`.trim() : cleaned;

  const tokens = source
    .split(/[\s.]+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length >= 1 && !NAME_NOISE.has(t));

  if (!tokens.length) return { first: "", last: "", full: "", ok: false };
  if (tokens.length === 1) {
    return { first: tokens[0], last: "", full: tokens[0], ok: tokens[0].length >= 2 };
  }

  const first = tokens[0];
  // Walk back from the end collecting the surname plus any leading particles.
  let lastStart = tokens.length - 1;
  while (lastStart > 1 && SURNAME_PARTICLES.has(tokens[lastStart - 1])) lastStart--;
  const last = tokens.slice(lastStart).join("").replace(/-/g, "");

  return {
    first,
    last,
    full: `${first} ${tokens.slice(lastStart).join(" ")}`,
    ok: first.length >= 2 && last.length >= 2,
  };
}

/** German umlaut transliteration — "muller" and "mueller" are both live in the wild. */
function umlautVariants(part: string, raw: string): string[] {
  const src = (raw || "").toLowerCase();
  if (!/[äöüß]/.test(src)) return [part];
  const transliterated = src
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
  return transliterated && transliterated !== part ? [part, transliterated] : [part];
}

export type PatternMatch = {
  pattern: PatternId;
  /** 0..1 — how uniquely this local part identifies the pattern. */
  strength: number;
};

/**
 * Given a known address and the name it belongs to, work out which template
 * produced it. Multiple templates can produce the same string ("jane" is both
 * `first` and — for Jane Jane — `last`), so every match reports a strength:
 * ambiguous evidence should not harden into a confident org pattern.
 */
export function matchPattern(localPart: string, personName: string): PatternMatch[] {
  const { first, last, ok } = parsePersonName(personName);
  if (!ok && !first) return [];
  const local = (localPart || "").toLowerCase().replace(/\+.*$/, "");
  const hits = EMAIL_PATTERNS.filter((p) => {
    const built = p.build(first, last);
    return !!built && built === local;
  });
  if (!hits.length) return [];
  // Strength falls as more templates collide on the same string, and single-
  // character templates (fl, f.l) are inherently weak evidence.
  return hits.map((p) => ({
    pattern: p.id,
    strength: Number(
      Math.min(1, (1 / hits.length) * (p.id === "fl" || p.id === "f.l" ? 0.5 : 1)).toFixed(2),
    ),
  }));
}

export type KnownAddress = {
  email: string;
  /** The person the address belongs to — required to infer a template. */
  name?: string;
};

export type PatternInference = {
  pattern: PatternId | null;
  confidence: number; // 0..1
  /** Every pattern that any known address supported, with accumulated weight. */
  scores: Array<{ pattern: PatternId; score: number }>;
  evidence: string[];
  /** Domain-level fallback when no name-linked address exists. */
  shape_hint?: "dotted" | "single_token" | "underscored" | "hyphenated";
};

/**
 * Infer the org's email template from addresses harvested at the domain.
 *
 * Two tiers of evidence:
 *  - name-linked addresses (strong): we know "jane.smith@" belongs to Jane
 *    Smith, so the template is directly observable.
 *  - shape-only addresses (weak): "jane.smith@acme.com" with no matching person
 *    still tells us the org uses a dotted two-token form, which halves the
 *    candidate space even though it can't distinguish first.last from last.first.
 *
 * Role inboxes (info@, sales@) are excluded — they say nothing about the
 * template and would otherwise vote loudly for `first`.
 */
export function inferOrgPattern(
  known: KnownAddress[],
  roleLocalParts: ReadonlySet<string>,
): PatternInference {
  const scores = new Map<PatternId, number>();
  const evidence: string[] = [];
  const shapeVotes = { dotted: 0, single_token: 0, underscored: 0, hyphenated: 0 };
  let strongEvidence = 0;

  for (const entry of known) {
    const email = (entry.email || "").toLowerCase().trim();
    const local = email.split("@")[0] || "";
    if (!local || roleLocalParts.has(local)) continue;

    if (entry.name) {
      const matches = matchPattern(local, entry.name);
      for (const m of matches) {
        scores.set(m.pattern, (scores.get(m.pattern) ?? 0) + m.strength);
        strongEvidence += m.strength;
      }
      if (matches.length) {
        evidence.push(
          `${email} matches ${matches.map((m) => m.pattern).join("/")} for "${entry.name}"`,
        );
        continue;
      }
    }

    // Shape-only vote.
    if (local.includes(".")) shapeVotes.dotted++;
    else if (local.includes("_")) shapeVotes.underscored++;
    else if (local.includes("-")) shapeVotes.hyphenated++;
    else shapeVotes.single_token++;
  }

  const ranked = [...scores.entries()]
    .map(([pattern, score]) => ({ pattern, score: Number(score.toFixed(2)) }))
    .sort((a, b) => b.score - a.score);

  const shape_hint = (Object.entries(shapeVotes) as Array<[keyof typeof shapeVotes, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!ranked.length) {
    if (shape_hint) evidence.push(`No name-linked address; local parts look ${shape_hint}.`);
    return { pattern: null, confidence: 0, scores: [], evidence, shape_hint };
  }

  const top = ranked[0];
  const runnerUp = ranked[1]?.score ?? 0;
  // Confidence rises with total evidence and with the margin over the runner-up.
  const margin = top.score / (top.score + runnerUp);
  const volume = Math.min(1, strongEvidence / 2); // two clean matches ≈ full volume
  const confidence = Number(Math.min(0.95, margin * volume).toFixed(2));

  return { pattern: top.pattern, confidence, scores: ranked, evidence, shape_hint };
}

export type EmailCandidate = {
  email: string;
  pattern: PatternId;
  /** 0..1 prior BEFORE any verification. Never treat as a verdict. */
  prior: number;
  reason: string;
};

export type DeriveOptions = {
  /** Inferred org pattern — when present it dominates the ranking. */
  inference?: PatternInference;
  /** How many candidates to return (each one costs an SMTP probe). */
  limit?: number;
  /** Skip candidates whose local part is a role inbox. */
  roleLocalParts?: ReadonlySet<string>;
  /** Learned pattern ids (verified hits) — boosted in ranking / probed early. */
  learnedPatterns?: PatternId[];
};

/**
 * Generate ranked candidate addresses for a person at a domain.
 *
 * Ranking, in order of influence:
 *  1. a confidently inferred org pattern (probes it first, everything else far behind)
 *  2. the shape hint (dotted orgs don't use flast)
 *  3. the global prior
 */
export function deriveEmailCandidates(
  personName: string,
  domain: string,
  opts: DeriveOptions = {},
): EmailCandidate[] {
  const d = (domain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  if (!d || !d.includes(".")) return [];
  const parsed = parsePersonName(personName);
  if (!parsed.first) return [];

  const firsts = umlautVariants(parsed.first, personName);
  const lasts = parsed.last ? umlautVariants(parsed.last, personName) : [""];
  const inferred = opts.inference;
  const learned = new Set(opts.learnedPatterns || []);
  const limit = opts.limit ?? 5;

  const out: EmailCandidate[] = [];
  const seen = new Set<string>();

  for (const p of EMAIL_PATTERNS) {
    // Single-name people can only fill `first`.
    if (!parsed.last && p.id !== "first") continue;

    let weight = p.prior;
    let reason = `${p.label} (base rate ${Math.round(p.prior * 100)}%)`;

    if (learned.has(p.id)) {
      // Learned-from-verify beats base rate; still below a high-confidence harvest inference.
      weight = Math.max(weight, 0.72);
      reason = `${p.label} — learned for this domain from prior verified hits`;
    }

    if (inferred?.pattern === p.id && inferred.confidence > 0) {
      weight = 0.4 + 0.55 * inferred.confidence;
      reason = `matches this company's observed ${p.label} format (${Math.round(inferred.confidence * 100)}% confidence)`;
    } else if (inferred?.pattern && inferred.confidence >= 0.6 && !learned.has(p.id)) {
      // A confident inference actively demotes the alternatives.
      weight = p.prior * 0.2;
      reason = `${p.label} — company appears to use ${inferred.pattern}, so this is a long shot`;
    } else if (inferred?.shape_hint && !learned.has(p.id)) {
      const shapeOk =
        (inferred.shape_hint === "dotted" && p.id.includes(".")) ||
        (inferred.shape_hint === "underscored" && p.id.includes("_")) ||
        (inferred.shape_hint === "hyphenated" && p.id.includes("-")) ||
        (inferred.shape_hint === "single_token" && !/[._-]/.test(p.id));
      weight = shapeOk ? p.prior * 1.6 : p.prior * 0.4;
      reason = `${p.label} — company local parts look ${inferred.shape_hint}`;
    }

    for (const f of firsts) {
      for (const l of lasts) {
        const local = p.build(f, l);
        if (!local || local.length < 2) continue;
        if (opts.roleLocalParts?.has(local)) continue;
        const email = `${local}@${d}`;
        if (seen.has(email)) continue;
        seen.add(email);
        out.push({
          email,
          pattern: p.id,
          prior: Number(Math.min(0.95, weight).toFixed(3)),
          reason,
        });
      }
    }
  }

  return out.sort((a, b) => b.prior - a.prior).slice(0, limit);
}

/** Apply a known pattern directly — used when the org format is already stored. */
export function applyPattern(
  pattern: PatternId,
  personName: string,
  domain: string,
): string | null {
  const p = PATTERN_BY_ID.get(pattern);
  const parsed = parsePersonName(personName);
  if (!p || !parsed.first) return null;
  const local = p.build(parsed.first, parsed.last);
  if (!local) return null;
  const d = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return `${local}@${d}`;
}
