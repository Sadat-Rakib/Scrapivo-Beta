// Stack Exchange — people asking for help across crafts (Writing, Workplace, etc.).
import type { Lead } from "../scoring";
import { isRecent, type ExpandedQueries } from "./query-expander";

type SourceLead = Lead & { intentBoost?: number };

const SITE_MAP: Array<{ site: string; label: string; crafts: RegExp }> = [
  { site: "writers", label: "Writers SE", crafts: /writ|copy|content|blog|article|ghost/i },
  { site: "graphicdesign", label: "Graphic Design SE", crafts: /design|figma|logo|brand|ui|ux/i },
  {
    site: "webapps",
    label: "Web Apps SE",
    crafts: /web|saas|app|tool|product|invoice|client|crm|billing/i,
  },
  { site: "workplace", label: "Workplace SE", crafts: /sales|growth|marketing|hire|career/i },
  { site: "academia", label: "Academia SE", crafts: /tutor|teach|student|lesson|homework|educat/i },
  { site: "ell", label: "ELL SE", crafts: /tutor|teach|english|language|lesson|esl/i },
  { site: "math", label: "Mathematics SE", crafts: /tutor|math|algebra|calculus|homework/i },
  { site: "physics", label: "Physics SE", crafts: /tutor|physics|homework/i },
  {
    site: "softwarerecs",
    label: "Software Recs",
    crafts:
      /tool|saas|software|app|platform|crm|invoice|billing|client|freelance|product|recommend/i,
  },
  { site: "startups", label: "Startups SE", crafts: /invest|rais|fund|startup|seed|angel/i },
  {
    site: "stackoverflow",
    label: "Stack Overflow",
    crafts: /develop|engineer|react|python|code|program/i,
  },
];

function craftBlob(qx: ExpandedQueries): string {
  return [qx.skill, qx.role, qx.queryType, ...(qx.relatedSkills || [])].filter(Boolean).join(" ");
}

function isProductHunt(qx: ExpandedQueries): boolean {
  return (
    qx.queryType === "product" ||
    /invoice|billing|saas|tool|crm|client acquisition/i.test(craftBlob(qx))
  );
}

function isTutorHunt(qx: ExpandedQueries): boolean {
  return /tutor|teach|homework|lesson|student/i.test(craftBlob(qx));
}

/**
 * Unanswered / recent questions that look like unmet needs.
 * Free keyless API (300/day); polite single-site fan-out.
 */
export async function searchStackExchange(qx: ExpandedQueries): Promise<SourceLead[]> {
  const blob = craftBlob(qx);
  if (blob.length < 3) return [];

  let sites = SITE_MAP.filter((s) => s.crafts.test(blob)).slice(0, 4);
  if (isProductHunt(qx)) {
    const forced = SITE_MAP.filter((s) => s.site === "softwarerecs" || s.site === "webapps");
    sites = [...forced, ...sites.filter((s) => !forced.some((f) => f.site === s.site))].slice(0, 4);
  }
  if (isTutorHunt(qx)) {
    const forced = SITE_MAP.filter((s) => ["academia", "ell", "math", "physics"].includes(s.site));
    sites = [...forced, ...sites.filter((s) => !forced.some((f) => f.site === s.site))].slice(0, 4);
  }
  const picked =
    sites.length > 0 ? sites : [{ site: "softwarerecs", label: "Software Recs", crafts: /./ }];

  const terms = [qx.skill, qx.role, ...(qx.relatedSkills || [])]
    .filter(Boolean)
    .map((t) => t!.trim())
    .filter((t) => t.length >= 3 && t.length <= 32)
    .slice(0, 6);
  // One short keyword per request — complex OR/paren queries return empty on SE.
  const queryTerms = (
    isProductHunt(qx)
      ? [
          ...terms.filter((t) => /invoice|billing|bookkeep|crm|accounting/i.test(t)),
          ...terms.filter((t) => /freelance|client acquisition|saas|tool/i.test(t)),
        ]
      : isTutorHunt(qx)
        ? terms.filter((t) => /tutor|homework|math|english|lesson|sat|act|physics/i.test(t))
        : terms
  ).slice(0, 3);
  const fallbackTerms = (queryTerms.length ? queryTerms : terms.slice(0, 2)).filter(Boolean);
  if (!fallbackTerms.length && (qx.skill || qx.role)) fallbackTerms.push(qx.skill || qx.role);

  const out: SourceLead[] = [];
  const seen = new Set<string>();
  const maxAgeDays = isProductHunt(qx) || isTutorHunt(qx) ? 3650 : 14; // Softwarerecs is evergreen

  await Promise.all(
    picked.flatMap((s) =>
      fallbackTerms.map(async (term) => {
        try {
          const q = encodeURIComponent(term);
          const url =
            `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=activity` +
            `&q=${q}&site=${s.site}&pagesize=20&filter=default`;
          const res = await fetch(url, {
            headers: { Accept: "application/json", "User-Agent": "Scrapivo/1.0" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            items?: Array<{
              title?: string;
              link?: string;
              creation_date?: number;
              last_activity_date?: number;
              owner?: { display_name?: string; link?: string };
              is_answered?: boolean;
              tags?: string[];
            }>;
          };
          for (const item of data.items || []) {
            const link = item.link || "";
            if (!link || seen.has(link)) continue;
            const title = (item.title || "").toLowerCase();
            const seeker =
              /\b(looking for|need|recommend|recommendat|alternative|help with|struggling|best .+ for|which .+ should|tutor|homework|invoice|billing)\b/i.test(
                title,
              );
            const tagHit = (item.tags || []).some((t) =>
              terms.some((term2) => {
                const head = term2.toLowerCase().split(/\s+/)[0] || "";
                return head.length >= 3 && t.toLowerCase().includes(head);
              }),
            );
            const volumePersona = isProductHunt(qx) || isTutorHunt(qx);
            const titleTags = `${title} ${(item.tags || []).join(" ")}`;
            if (isProductHunt(qx)) {
              const productHit =
                seeker ||
                /invoice|billing|accounting|crm|freelance|client acquisition|bookkeep/i.test(
                  titleTags,
                );
              if (!productHit) continue;
            } else if (isTutorHunt(qx)) {
              const tutorHit =
                seeker ||
                /\b(homework|need (a )?tutor|looking for .{0,20}tutor|tutoring needed|struggling with)\b/i.test(
                  title,
                );
              // Academia meta ("what is a personal tutor") is not student demand.
              if (!tutorHit) continue;
              if (
                /\b(what is a|is it ethical|will tutoring|percent of the fee|phd|graduate)\b/i.test(
                  title,
                )
              ) {
                continue;
              }
            } else if (item.is_answered) {
              continue;
            }
            if (item.is_answered && volumePersona && !seeker && !tagHit) {
              // already gated by productHit/tutorHit above
            }
            const epoch = volumePersona
              ? item.last_activity_date || item.creation_date
              : item.creation_date;
            const posted = epoch ? new Date(epoch * 1000).toISOString() : undefined;
            if (posted && !isRecent(posted, maxAgeDays)) continue;
            seen.add(link);
            out.push({
              source: "stackexchange",
              platform: s.label,
              title: (item.title || "").slice(0, 200),
              snippet: `Q on ${s.label}. Tags: ${(item.tags || []).slice(0, 5).join(", ")}`,
              full_post_url: link,
              author: item.owner?.display_name,
              author_url: item.owner?.link,
              posted_at: posted,
              signal_type: "direct_intent",
              demand_verified: true,
              intentBoost: seeker ? 12 : 9,
              source_confidence: 64,
              match_reasons: [`${s.label} question`, seeker ? "Help-seeking title" : "Public Q&A"],
              why_match: `Someone asked for help on ${s.label}`,
            });
          }
        } catch {
          /* skip */
        }
      }),
    ),
  );

  return out.slice(0, isProductHunt(qx) || isTutorHunt(qx) ? 40 : 24);
}
