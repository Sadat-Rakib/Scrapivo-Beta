/**
 * Universal query-readiness (Part 1): entity-aware, one highest-information
 * question when a bare ask would otherwise search with arbitrary assumptions.
 *
 * Rules are deliberate and few — never interrogate:
 * - "find me investors" (no focus, no count) → ask focus. [Search broadly] escape.
 * - "find me founders" (role known, no industry, no count) → ask kind.
 * Everything else stays as-is: business without a place already asks location;
 * company without industry/location already clarifies; jobs with remote never
 * require a city.
 */
import type { SearchSpec } from "./search-spec";
import type { ClarifyQuestion } from "./clarifier";

const NUMBER_WORDS_RE =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b/i;

const opt = (label: string, hint: string) => ({
  id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  label,
  hint,
});

export type QueryReadiness = {
  ready: boolean;
  /** One question, highest expected value first. Empty when ready. */
  question?: ClarifyQuestion;
};

export function evaluateQueryReadiness(args: {
  spec: SearchSpec;
  query: string;
  force?: boolean;
}): QueryReadiness {
  const { spec, query, force } = args;
  if (force) return { ready: true };
  const hasCount = NUMBER_WORDS_RE.test(query);
  const fieldOf = (f: string) =>
    spec.criteria.find((c) => c.field === f)?.value?.trim() || null;

  if (spec.entity === "investor" && !fieldOf("investor_sector") && !hasCount) {
    return {
      ready: false,
      question: {
        id: "investor_sector",
        question: "What kind of investors are you looking for?",
        options: [
          opt("AI", "AI, ML, infrastructure"),
          opt("SaaS", "Software & cloud"),
          opt("Fintech", "Financial tech"),
          opt("Consumer", "Consumer products"),
        ],
        allowOther: true,
      },
    };
  }

  if (
    spec.entity === "person" &&
    /\bfounder\b/i.test(fieldOf("role") ?? "") &&
    !fieldOf("industry") &&
    // A stated location already narrows the hunt ("founders in Toronto") —
    // asking for industry too would be interrogation, not clarification.
    !fieldOf("location") &&
    !fieldOf("geo_scope") &&
    !hasCount
  ) {
    return {
      ready: false,
      question: {
        id: "entity_industry",
        question: "What kind of founders are you looking for?",
        options: [
          opt("SaaS", "Software startups"),
          opt("AI", "Artificial intelligence"),
          opt("E-commerce", "Online retail"),
          opt("Any", "All kinds"),
        ],
        allowOther: true,
      },
    };
  }

  return { ready: true };
}
