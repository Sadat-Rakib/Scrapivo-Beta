/**
 * Domain pattern memory — learn then prefer.
 * Run: npx tsx scripts/verify-domain-memory.mts
 */
import {
  clearDomainMemoryCaches,
  getLearnedPatterns,
  recordPatternHit,
  inferPatternKeyFromEmail,
  updateDomainVerifyState,
  getDomainVerifyState,
} from "../src/lib/contact/domain-memory.server";
import { deriveEmailCandidates } from "../src/lib/contact/email-patterns";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  clearDomainMemoryCaches();

  check(
    "infer first.last",
    inferPatternKeyFromEmail("jane.doe@acme.test", "Jane Doe") === "first.last",
  );

  await recordPatternHit("acme.test", "first.last");
  await recordPatternHit("acme.test", "first.last");
  await recordPatternHit("acme.test", "flast");

  const learned = await getLearnedPatterns("acme.test", { limit: 2 });
  check("top learned is first.last", learned[0] === "first.last", `got=${learned.join(",")}`);
  check("second learned includes flast", learned.includes("flast"));

  const cands = deriveEmailCandidates("John Smith", "acme.test", {
    learnedPatterns: learned,
    limit: 5,
  });
  check("candidates non-empty", cands.length > 0);
  check(
    "learned pattern ranked first",
    cands[0].pattern === "first.last",
    `top=${cands[0].pattern} prior=${cands[0].prior}`,
  );

  await updateDomainVerifyState("acme.test", {
    is_catch_all: true,
    last_status: "catch_all",
    risky_streak: 2,
  });
  const st = await getDomainVerifyState("acme.test");
  check("catch-all state stored", st?.is_catch_all === true);

  console.log(failed ? `\n${failed} failed` : "\nDomain memory tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
