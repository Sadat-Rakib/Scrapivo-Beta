const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function main() {
  // Remotive raw
  const r = await fetch("https://remotive.com/api/remote-jobs?search=senior%20designer&limit=10", { headers: { "user-agent": UA } });
  const j = await r.json();
  console.log("remotive search 'senior designer':", r.status, "jobs:", j.jobs?.length);
  console.log("  first titles:", (j.jobs ?? []).slice(0, 5).map((x: unknown) => (x as { title: string }).title));
  const r2 = await fetch("https://remotive.com/api/remote-jobs?search=designer&limit=10", { headers: { "user-agent": UA } });
  const j2 = await r2.json();
  console.log("remotive search 'designer':", r2.status, "jobs:", j2.jobs?.length, (j2.jobs ?? []).slice(0, 3).map((x: unknown) => (x as { title: string }).title));

  // WWR with Accept header
  const w = await fetch("https://weworkremotely.com/remote-jobs/search.rss?term=designer", {
    headers: { "user-agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
  });
  console.log("wwr with accept:", w.status, (await w.text()).slice(0, 120).replace(/\n/g, " "));
}

main().catch((e) => console.error(e));
