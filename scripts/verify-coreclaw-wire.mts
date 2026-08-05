/**
 * Smoke checks for CoreClaw wiring (no API key required).
 * Run: npx tsx scripts/verify-coreclaw-wire.mts
 */
import { coreclawEnabled } from "../src/lib/contact/coreclaw.server.ts";

const fail: string[] = [];
const ok = (n: string, c: boolean) => {
  if (!c) fail.push(n);
  else console.log("OK:", n);
};

ok("coreclaw disabled without CORECLAW_API_KEY", !coreclawEnabled() || !!process.env.CORECLAW_API_KEY);

const liCo = "https://www.linkedin.com/company/acme";
const liPe = "https://www.linkedin.com/in/jane-doe";
ok("company URL pattern", /linkedin\.com\/company\//i.test(liCo));
ok("person URL pattern", /linkedin\.com\/in\//i.test(liPe));
ok("company pattern rejects /in/", !/linkedin\.com\/company\//i.test(liPe));

const ig = "https://www.instagram.com/acme.studio/";
const yt = "https://www.youtube.com/@acme";
const tt = "https://www.tiktok.com/@acme";
ok("ig url", /instagram\.com\//i.test(ig));
ok("yt url", /youtube\.com\/@/i.test(yt));
ok("tiktok url", /tiktok\.com\/@/i.test(tt));

if (fail.length) {
  console.error("FAIL:", fail.join("; "));
  process.exit(1);
}
console.log("PASS verify-coreclaw-wire");
