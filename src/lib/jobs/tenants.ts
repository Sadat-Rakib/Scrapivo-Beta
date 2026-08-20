import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AtsProvider } from "@/lib/search/ats-sources.server";

export type AtsTenant = { company: string; provider: string; board: string };

let cached: AtsTenant[] | null = null;

export function loadCompanyAtsTenants(): AtsTenant[] {
  if (cached) return cached;
  const candidates = [
    resolve(process.cwd(), "data/company_ats_tenants.json"),
    resolve(process.cwd(), "../data/company_ats_tenants.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      cached = JSON.parse(readFileSync(p, "utf8")) as AtsTenant[];
      return cached;
    } catch {
      /* try next */
    }
  }
  cached = [];
  return cached;
}

export function tenantBoardsFor(provider: AtsProvider | string): string[] {
  return loadCompanyAtsTenants()
    .filter((t) => t.provider === provider && t.board)
    .map((t) => t.board);
}
