import { z } from "zod";

export const WebsiteIntelSchema = z.object({
  name: z.string().min(1).max(200).nullable(),
  kind: z.enum(["company", "person", "fund", "product", "unknown"]).default("unknown"),
  industry: z.string().max(120).nullable(),
  description: z.string().max(1200).nullable(),
  location: z.string().max(200).nullable(),
  emails: z.array(z.string().email()).max(5).default([]),
  phones: z.array(z.string().max(40)).max(3).default([]),
  linkedin: z.string().url().max(300).nullable(),
  twitter: z.string().url().max(300).nullable(),
  github: z.string().url().max(300).nullable(),
  /** Portfolio/resume URLs: extracted skills for job matching. */
  skills: z.array(z.string().min(1).max(60)).max(15).default([]),
  /** Sectors/stage hints for investor prefill. */
  sectors: z.array(z.string().min(1).max(80)).max(6).default([]),
  stage_hint: z.string().max(60).nullable(),
});

export type WebsiteIntel = z.infer<typeof WebsiteIntelSchema>;

export const FollowUpsSchema = z.object({
  questions: z.array(z.string().min(5).max(220)).max(4).default([]),
  suggestions: z.array(z.string().min(5).max(220)).max(4).default([]),
});

export type FollowUps = z.infer<typeof FollowUpsSchema>;
