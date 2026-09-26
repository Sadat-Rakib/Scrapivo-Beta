/** Build stamp — proves which code serves a test round (locked). */
import { execSync } from "node:child_process";

let cached: { hash: string; builtAt: string } | null = null;

export function buildStamp(): { hash: string; builtAt: string } {
  if (!cached) {
    let hash = "unknown";
    try {
      hash = execSync("git rev-parse --short HEAD", { timeout: 5000 }).toString().trim() || "unknown";
    } catch {
      hash = "nogit";
    }
    try {
      const dirty = execSync("git status --porcelain", { timeout: 5000 }).toString().trim();
      if (dirty) hash += "+dirty";
    } catch {
      /* ignore */
    }
    cached = { hash, builtAt: new Date().toISOString() };
    if (typeof console !== "undefined") {
      console.info(`[build-stamp] hash=${cached.hash} builtAt=${cached.builtAt}`);
    }
  }
  return cached;
}
