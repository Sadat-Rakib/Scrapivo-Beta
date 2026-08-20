import type { Lead, SearchQuery } from "../types.ts";
import { isWithin14Days } from "../intent-filter.ts";
import { buildLead, safe, ok } from "../utils.ts";

export async function searchRemoteOK(query: SearchQuery): Promise<Lead[]> {
  const out: Lead[] = [];
  const tag = query.skill.replace(/\s+/g, "-").toLowerCase();
  try {
    const url = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`;
    const data = await safe(
      fetch(url, { headers: { "user-agent": "Scrapivo Job Aggregator" } }).then((r) =>
        ok<unknown[]>(r),
      ),
      [] as unknown[],
    );
    const jobs = Array.isArray(data) ? data.slice(1) : [];
    for (const j of jobs.slice(0, 25) as Array<Record<string, unknown>>) {
      if (!j.url || !j.position) continue;
      const date = j.date
        ? new Date(
            typeof j.date === "number" ? (j.date as number) * 1000 : String(j.date),
          ).toISOString()
        : null;
      if (!date || !isWithin14Days(date)) continue;
      const snippet = [
        `REMOTE JOB: ${j.position}`,
        j.company ? `Company: ${j.company}` : "",
        j.salary ? `Salary: ${j.salary}` : "",
        String(j.description || "")
          .replace(/<[^>]+>/g, " ")
          .slice(0, 300),
      ]
        .filter(Boolean)
        .join("\n");

      const lead = buildLead({
        id: `remoteok-${String(j.id || j.url)}`,
        platform: "remoteok",
        platform_label: "RemoteOK",
        post_url: String(j.url),
        post_title: `${j.position} @ ${j.company || "Company"}`,
        post_body_snippet: snippet,
        query,
        posted_at: date,
        author_handle: String(j.company || ""),
        author_url: String(j.company_url || ""),
        author_name: String(j.company || ""),
        source_confidence: 90,
        is_decision_maker: true,
      });
      if (lead) out.push(lead);
    }
  } catch {
    /* silent */
  }
  return out;
}
