/**
 * A one-line-per-case view of the deterministic extractor, for reading the
 * brief's own examples back. Not a test: it asserts nothing and exists so a
 * systemic misread is visible at a glance instead of buried in a 50k-line
 * report.
 *
 *   npx tsx scripts/probe-understanding.mts
 *   npx tsx scripts/probe-understanding.mts --full "cafes in porto"
 */
import { extractFrameDeterministic } from "../src/lib/understanding/fallback";
import { validateFrame } from "../src/lib/understanding/validate";
import { syncClarification } from "../src/lib/understanding/clarify-state";

const CASES = [
  // §2 prospecting modes
  "coffee roasters within 15 km of Copenhagen",
  "coffee shops without websites",
  "companies looking for marketing help",
  "companies hiring React developers",
  "recently funded AI startups",
  // §3 relation none
  "restaurants in Lisbon",
  "restaurants without websites",
  "restaurants looking for photographers",
  // §4 user context vs prospect need
  "I sell website design. Find me 100 local businesses in Alberta.",
  "Find businesses in Alberta without websites because I sell web design.",
  // §5 subject → relation → object
  "web designers looking for clients",
  "businesses looking for web designers",
  // §7 noun-phrase interpretation
  "dental practices in Malmö",
  "heads of talent at fintech companies",
  "freelance copywriters",
  "law firms across Ontario",
  "veterinary orthopaedic specialists near Reykjavik",
  // §8 clause-bound location
  "robotics founders around Trondheim trying to hire embedded engineers right now",
  // §9 temporal is not a location
  "companies that posted a marketing role in the last two weeks",
  // §10 quantity
  "Give me 50 restaurants in Lisbon",
  "I need at least 25 dental practices in Gdansk",
  "up to 50 boutique hotels outside Tbilisi",
  "as many kombucha breweries as possible in Oregon",
  // §12 constraints + negation
  "freelance copywriters under $150/hour, excluding Toronto",
  "software companies with at least 100 employees, not agencies",
  // §13 compound
  "dentists in Perth and also orthodontists in Adelaide",
  // §14 plain entity discovery
  "cafes in San Francisco",
  "marketing agencies in Bristol",
  // §15 clarification
  "find businesses",
  "founders in Oslo looking for developers",
  // §17 custom / unknown
  "companies partnered with Stripe",
  "companies around Porto doing that thing with creators",
  // §21 chaos
  "need some founders round gdansk tryna bring on rust ppl rn",
  "any physio clinics near reykjavik no proper website n got phone?",
  "who around porto needs someone for seo asap",
  "find me 30 boutique hotels outside tbilisi, not chains, insta if possible",
  "need climate startups ljubljana funded this yr + founders names if u can",
  // §23 sizes
  "Berlin startups",
  "dentists in Malmö without websites",
  "find SaaS companies around Cork hiring senior Python developers",
  "I'm selling website services to local businesses. Find me 100+ businesses in Alberta that don't have a real website, phone required, socials and reviews if possible, verify that they exist and truly don't have a website, and give me a table plus outreach drafts.",
  // §22 dangerous pairs
  "SEO consultants in Dublin",
  "businesses looking for SEO consultants",
  "developers looking for jobs",
  "companies raising funding",
  "investors funding companies",
  "companies that provide recruiting",
  "companies hiring recruiters",
];

function build(raw: string) {
  const { frame } = validateFrame(extractFrameDeterministic(raw));
  return syncClarification(frame);
}

const full = process.argv.includes("--full");
const only = process.argv.filter((a) => !a.startsWith("-")).slice(2);

if (full || only.length) {
  for (const raw of only.length ? only : CASES) {
    console.log(JSON.stringify(build(raw), null, 2));
    console.log("─".repeat(78));
  }
  process.exit(0);
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

for (const raw of CASES) {
  const f = build(raw);
  const t = f.target;
  const what =
    t.role?.value ?? t.category?.value ?? t.business_type?.value ?? t.industry?.value ?? t.descriptors[0]?.value ?? "—";
  const rel =
    f.relation.type.value === "none"
      ? "none"
      : `${f.relation.type.value}${f.relation.object ? `→${f.relation.object.value}` : ""}`;
  const loc = f.location ? `${f.location.scope}:${f.location.value}` : "—";
  const q = f.quantity
    ? [
        f.quantity.requested != null ? `=${f.quantity.requested}` : "",
        f.quantity.minimum != null ? `≥${f.quantity.minimum}` : "",
        f.quantity.maximum != null ? `≤${f.quantity.maximum}` : "",
        f.quantity.unlimited ? "∞" : "",
      ]
        .filter(Boolean)
        .join("")
    : "—";
  const tm = f.temporal ? `${f.temporal.relation}:${f.temporal.window ?? f.temporal.year ?? ""}` : "—";
  const cl = f.clarification.needed ? `? ${f.clarification.reason}` : "";
  const cmp = f.compound.is_compound ? ` [${f.compound.subgoals.length} subgoals]` : "";
  const sell = f.user_context?.selling?.service?.value ?? f.user_context?.selling?.product?.value;
  const cons = f.constraints.length
    ? ` [${f.constraints
        .map((c) => `${c.negated ? "!" : ""}${c.field}${c.operator === "eq" ? "" : `.${c.operator}`}=${String(c.value)}`)
        .join(", ")}]`
    : "";
  const deliver = [
    f.required_fields.length ? `req:${f.required_fields.length}` : "",
    f.preferred_fields.length ? `pref:${f.preferred_fields.length}` : "",
    f.verification.length ? `verify:${f.verification.length}` : "",
    f.output.length ? `out:${f.output.length}` : "",
  ].filter(Boolean);

  console.log(
    `${pad(raw, 58)} ${pad(f.prospecting_mode.value, 18)} ${pad(t.entity_type.value, 9)} ${pad(what, 26)} ${pad(rel, 30)} ${pad(loc, 22)} ${pad(q, 7)} ${pad(tm, 18)}${sell ? ` sells:${sell}` : ""}${cons}${deliver.length ? ` {${deliver.join(" ")}}` : ""}${cmp} ${cl}`,
  );
}
