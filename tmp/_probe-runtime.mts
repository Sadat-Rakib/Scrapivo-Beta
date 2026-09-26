import "../scripts/_env.mts";

async function main() {
  const u = process.env.SEARXNG_URL ?? "";
  console.log("SEARXNG_URL", u || "ABSENT");
  if (u) {
    try {
      const r = await fetch(`${u.replace(/\/$/, "")}/search?q=test&format=json`, {
        signal: AbortSignal.timeout(4000),
      });
      console.log("searx_status", r.status);
    } catch (e) {
      console.log("searx_err", e instanceof Error ? e.message : e);
    }
  }
  const interesting = [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MY_SUPABASE_SERVICE_ROLE_KEY",
    "SERPAPI_KEY",
    "SERPER_API_KEY",
    "USE_PAID_SOURCES",
  ];
  for (const k of interesting) {
    const v = process.env[k];
    console.log(k, v ? `SET len=${v.length}` : "ABSENT");
  }
}
main();
