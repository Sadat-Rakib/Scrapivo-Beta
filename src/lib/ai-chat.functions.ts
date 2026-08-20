import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

const Msg = z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() });
const Input = z.object({ messages: z.array(Msg).min(1).max(40) });

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY missing");

    const system = `You are Scrapy, Scrapivo's lead-hunting assistant. Energetic, brief, action-first.

When the user says what they want to find (role, skill, niche, buyers, companies, people):
1) Reply with ONLY a short confirmation — one of: "Roger that, boss.", "Got it, captain.", "On it, boss.", "Copy that — hunting now.", "Aye aye — searching."
2) Do NOT explain what to search. Do NOT propose alternatives. Do NOT lecture.
3) End with a machine line on its own:
SEARCH: <plain English query>

SEARCH rules:
- Plain English only (e.g. "web developer", "need a product designer", "marketing agencies in Austin")
- NEVER use boolean operators (AND, OR, NOT), parentheses, site:, after:, quotes stacks, or Google dorks
- Prefer the user's words; keep it short

If they only want ideas / chat (not a hunt), skip the SEARCH line and answer briefly.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "system", content: system }, ...data.messages],
        temperature: 0.6,
        max_tokens: 120,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq ${res.status}: ${txt.slice(0, 200)}`);
    }
    const j = await res.json();
    const content: string = j.choices?.[0]?.message?.content ?? "";
    const match = content.match(/SEARCH:\s*(.+?)\s*$/m);
    const rawQuery = match ? match[1].trim() : null;
    // Never let boolean dorks leak into the Discover search box / UI.
    const { toPlainSearchQuery } = await import("./display-query");
    const query = rawQuery ? toPlainSearchQuery(rawQuery) || rawQuery : null;
    return { content, query };
  });
