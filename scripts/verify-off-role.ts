/**
 * A craft word in the title does not mean the JOB is that craft.
 *
 * Reported from a live "need a design" search: "[HIRING] Remote Sales Closer —
 * Web Design Agency — Commission Only — Leads Provided" was shown to a
 * designer. The craft word was the employer's industry, not the role. This
 * pins that shape shut without touching the genuine design asks that were on
 * the same screen.
 *
 *   npx tsx scripts/verify-off-role.ts
 */
import { isOffSkillRole } from "../src/lib/validation";
import type { Lead } from "../src/lib/scoring";

const SKILL = "design";
const RELATED = ["graphic design", "logo", "branding", "figma", "ui", "ux"];

function lead(title: string, snippet = ""): Lead {
  return {
    source: "reddit",
    platform: "Reddit",
    title,
    snippet: snippet || title,
    full_post_url: `https://reddit.com/${encodeURIComponent(title).slice(0, 24)}`,
  } as Lead;
}

// Commission-sales roles that merely NAME a design employer.
const mustDrop = [
  "[HIRING] Remote Sales Closer – Web Design Agency – Commission Only – 15-20% Per Sale – Leads Provided",
  "Sales Rep needed for our design studio",
  "Appointment Setter — Marketing & Design Agency",
  "Cold Caller wanted for web design agency, commission based",
  "Sales Partner to find clients for our branding studio",
  "Closers Needed — Leads Provided — Logo Design Company",
];

// The real design demand that was on the same screen and must survive.
const mustKeep = [
  "[Hiring] Band Logo for Live Shows",
  "[Hiring] Simple Animation for Logo",
  "[Hiring] Looking for a Professional Pitch Deck Designer",
  "[hiring] Magitech(crystalpunk) Airship Design Concept commission",
  "[Hiring] D&D title logo design for my homebrew world",
  "Need a designer for our landing page redesign",
  "Looking for a graphic designer, paid work",
];

let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 84)}`);
  if (!ok) failures++;
};

console.log("\nSales roles at design companies must be dropped ──────────");
for (const t of mustDrop) check(t, isOffSkillRole(lead(t), SKILL, RELATED));

console.log("\nGenuine design asks must survive ─────────────────────────");
for (const t of mustKeep) check(t, !isOffSkillRole(lead(t), SKILL, RELATED));

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} failing`}`);
process.exit(failures === 0 ? 0 : 1);
