/** What the deterministic relation reader makes of a custom label. Temporary. */
import { detectRelation } from "../src/lib/understanding/fallback";
import { classifyHead } from "../src/lib/understanding/lexicon";

const SUBJECT = classifyHead("businesses");

const LABELS = [
  "partnered with Contentful",
  "partnered with Twilio",
  "partners with Stripe",
  "integrated with Xero",
  "accredited by the CQC",
  "certified by B Corp",
  "listed on Trustpilot",
  "rated 4 stars",
  "franchisees of a national chain",
  "sponsors of Web Summit",
  "members of the chamber of commerce",
  "regulated by the FCA",
  "using Shopify",
  "attending Web Summit",
  "hiring nurses",
];

for (const label of LABELS) {
  const hit = detectRelation(label, SUBJECT);
  console.log(
    `${label.padEnd(38)} -> ${hit ? `${hit.type} obj=${hit.object?.value ?? "-"} dir=${hit.direction} c=${hit.confidence}` : "none"}`,
  );
}
