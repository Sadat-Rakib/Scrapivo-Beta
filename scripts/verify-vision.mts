import "./_env.mts";
/**
 * Vision OCR verification.
 * An image-only post must reach the demand gate with its text transcribed,
 * because without it the gate sees an empty body and drops a real ask.
 */
import {
  extractImageText,
  looksLikeImageUrl,
  enrichLeadsWithVision,
} from "../src/lib/vision/image-text.server.ts";
import { classifyDemand } from "../src/lib/search/demand-classifier.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  c ? pass++ : fail++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${n}${d && !c ? ` — ${d}` : ""}`);
};

console.log("\nURL detection");
for (const u of ["https://i.redd.it/abc.jpg", "https://i.imgur.com/x.png", "https://pbs.twimg.com/media/a.jpg"])
  ok(`accepts ${u.slice(8, 30)}`, looksLikeImageUrl(u));
for (const u of ["https://v.redd.it/abc", "https://reddit.com/r/x/comments/1/", "https://reddit.com/gallery/1"])
  ok(`rejects ${u.slice(8, 34)}`, !looksLikeImageUrl(u));

console.log("\nTranscription (live, free models)");
// .png form on purpose: the detector requires a real extension, which is
// what actual post images (i.redd.it/x.jpg) look like.
const IMG =
  "https://placehold.co/700x260.png?text=LOOKING+FOR+A+DESIGNER+DM+me+budget+500";
const text = await extractImageText(IMG);
console.log(`       got: ${JSON.stringify(text.slice(0, 90))}`);
ok("returned text", text.length > 0, "empty — all free models rate-limited?");
ok("contains the ask", /designer/i.test(text), text.slice(0, 60));

console.log("\nThe point: an image-only post now clears the demand gate");
// "[Hiring]" is itself a demand tag, so it is no control. A picture post
// titled like this is the real case: nothing to classify on.
const before = classifyDemand({ title: "my latest", body: "" });
ok("without vision it is NOT demand", !before.isDemand, `isDemand=${before.isDemand}`);
const after = classifyDemand({ title: "my latest", body: text });
ok("with vision it IS demand", after.isDemand, `isDemand=${after.isDemand} reason=${after.reason}`);

console.log("\nEnrichment only touches thin posts with images");
const leads = [
  { title: "my latest", snippet: "", image_url: IMG, full_post_url: "u1" },
  { title: "Long text post", snippet: "x".repeat(200), image_url: IMG, full_post_url: "u2" },
];
const out = await enrichLeadsWithVision(leads);
ok("thin post enriched", (out[0].snippet ?? "").length > 0);
ok("fat post untouched", out[1].snippet === leads[1].snippet);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
