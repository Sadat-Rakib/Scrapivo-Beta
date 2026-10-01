// Summarize JSON-LD blocks on public pages (Task 4 evidence). Read-only GETs.
const urls = process.argv.slice(2);
for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ScrapivoResearch/1.0)", accept: "text/html" }, signal: AbortSignal.timeout(12_000) });
    const html = await res.text();
    const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const types: string[] = [];
    let items = 0;
    const walk = (node: unknown, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
      const o = node as Record<string, unknown>;
      if (o["@type"]) types.push(String(o["@type"]));
      if (Array.isArray(o.itemListElement)) items += o.itemListElement.length;
      for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, depth + 1);
    };
    for (const b of blocks) { try { walk(JSON.parse(b.trim())); } catch { types.push("<unparseable>"); } }
    const counts = types.reduce<Record<string, number>>((acc, t) => { acc[t] = (acc[t] ?? 0) + 1; return acc; }, {});
    console.log(JSON.stringify({ url, status: res.status, bytes: html.length, blocks: blocks.length, itemListElements: items, types: counts }));
  } catch (error) {
    console.log(JSON.stringify({ url, error: String(error).slice(0, 160) }));
  }
}
