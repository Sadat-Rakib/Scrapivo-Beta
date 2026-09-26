/**
 * Encoding hygiene (Phase 4): runtime mojibake repair.
 *
 * Provider payloads and scraped snippets are occasionally UTF-8 bytes
 * mis-decoded as cp1252 ("â€”" for "—", "Â·" for "·"). fixMojibake reverses
 * that single most common corruption and normalizes to NFC. Pure ASCII and
 * already-clean text pass through untouched; undecodable input is returned
 * as-is (never throws, never invents content).
 */

const CP1252_EXTRA: Record<string, string> = {
  "€": "\x80",
  "‚": "\x82",
  "ƒ": "\x83",
  "„": "\x84",
  "…": "\x85",
  "†": "\x86",
  "‡": "\x87",
  "ˆ": "\x88",
  "‰": "\x89",
  "Š": "\x8A",
  "‹": "\x8B",
  "Œ": "\x8C",
  "Ž": "\x8E",
  "‘": "\x91",
  "’": "\x92",
  "“": "\x93",
  "”": "\x94",
  "•": "\x95",
  "–": "\x96",
  "—": "\x97",
  "˜": "\x98",
  "™": "\x99",
  "š": "\x9A",
  "›": "\x9B",
  "œ": "\x9C",
  "ž": "\x9E",
  "Ÿ": "\x9F",
};

/** Classic double-encoding signatures: â€/â”/Ã/Â sequences. */
const MOJIBAKE_RE = /â[\u0080-\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|Ã[\u0080-\u00BF]|Â[·‐-―¡-¿]/;

export function fixMojibake(input: unknown): string {
  if (typeof input !== "string") return "";
  if (!input) return input;
  if (!MOJIBAKE_RE.test(input)) {
    return /[^\x00-\x7F]/.test(input) ? input.normalize("NFC") : input;
  }
  try {
    let mapped = "";
    for (const ch of input) mapped += CP1252_EXTRA[ch] ?? ch;
    const roundTripped = Buffer.from(mapped, "latin1").toString("utf8");
    if (!roundTripped.includes("�") && !MOJIBAKE_RE.test(roundTripped)) {
      return roundTripped.normalize("NFC");
    }
  } catch {
    // fall through to NFC normalization below
  }
  return input.normalize("NFC");
}
