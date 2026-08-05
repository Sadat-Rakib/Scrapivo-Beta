// Standalone smoke checks mirroring the classifier / segment fixes (no vite).
function detectSignalFamily(text) {
  const t = (text || "").toLowerCase();
  if (/\b(i need|i want|we need|we want|need someone|want someone|can someone|who can|willing to pay|looking for someone|looking for a|looking for an|need a|need an)\b/.test(t)) {
    return "custom";
  }
  return null;
}

function extractForIcpNoun(raw) {
  const forM = (raw || "").toLowerCase().match(/\bfor\s+(startups?|agenc(?:y|ies)|small businesses|smbs?|founders?|companies|businesses|freelancers?)\b/i);
  if (!forM) return null;
  const n = forM[1].toLowerCase();
  if (/^startup/.test(n)) return "startups";
  return n;
}

const q = "need a web development for startups in Canada";
const family = detectSignalFamily(q);
const icp = extractForIcpNoun(q);
const buying = family !== null;
console.log({ family, icp, buying, expect: { family: "custom", icp: "startups", buying: true } });
if (family !== "custom" || icp !== "startups") process.exit(1);

const BUYER_PHRASE_RE =
  /\b(need(s|ed)? (a|an|someone)|looking for (a|an|someone)|hiring|who can (help|build|make)|any (recommendations?|recs)|anyone (recommend|know)|willing to pay|budget|freelance(r)? needed|seeking (a|an|freelancer))\b/i;
const text = "Need a web developer for our startup ASAP. Looking for someone to build our site.";
console.log({ buyerPhrase: BUYER_PHRASE_RE.test(text) });
if (!BUYER_PHRASE_RE.test(text)) process.exit(1);
console.log("OK");
