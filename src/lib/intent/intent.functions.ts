/**
 * Intent server functions (Step 4): strategy + per-candidate discovery.
 * Client calls getIntentStrategy once, then discoverCandidateEvidence per
 * candidate (top 20) so progress ("Checking evidence 7/20") is real and the
 * run is cancellable. Verification + ranking stay pure modules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import {
  buildIntentStrategy,
  type IntentStrategy,
} from "./strategy";
import {
  discoverCandidateEvidence,
  type IntentCandidate,
} from "./discover.server";
import { verifyHit } from "./verify.server";
import type { EvidenceObject } from "./evidence";

const candidateSchema = z.object({
  // PersonRow keys embed URLs (often >200 chars) — truncating would break
  // the badge/drawer lookup that matches on the full key.
  key: z.string().min(1).max(500),
  name: z.string().max(300),
  company: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  country: z.string().max(120).nullish(),
});

export const getIntentStrategy = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z.object({ offer: z.string().min(2).max(120), entity: z.string().min(2).max(40) }).parse(d),
  )
  .handler(async ({ data }): Promise<IntentStrategy> => {
    return buildIntentStrategy(data.offer, data.entity);
  });

export const discoverCandidateIntent = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        candidate: candidateSchema,
        strategy: z.custom<IntentStrategy>((v) => !!v && typeof v === "object"),
        offer: z.string().min(2).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ evidence: EvidenceObject[]; checked: number }> => {
    const c: IntentCandidate = {
      key: data.candidate.key,
      name: data.candidate.name,
      company: data.candidate.company ?? null,
      city: data.candidate.city ?? null,
      country: data.candidate.country ?? null,
    };
    const hits = await discoverCandidateEvidence(c, data.strategy);
    const out: EvidenceObject[] = [];
    // Per-hit budget so one hanging classifier call can't stall the run.
    for (const hit of hits) {
      const ev = await Promise.race([
        verifyHit(hit, data.offer, c.key),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
      ]);
      if (ev) out.push(ev);
      if (out.length >= 3) break; // cap verified objects per candidate
    }
    return { evidence: out, checked: hits.length };
  });
