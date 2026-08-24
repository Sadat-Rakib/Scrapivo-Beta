import { fetchRemotiveJobs, fetchWwrJobs, fetchTheMuseJobs, fetchWorkingNomadsJobs, fetchHimalayasJobs } from "../src/lib/jobs/remote-fetchers.server";

async function main() {
  const r = await fetchRemotiveJobs("senior designer");
  console.log("remotive:", r.length, r[0]?.title);
  const w = await fetchWwrJobs("senior designer");
  console.log("wwr:", w.length, w[0]?.title);
  const m = await fetchTheMuseJobs("senior designer");
  console.log("muse:", m.length, m[0]?.title);
  const wn = await fetchWorkingNomadsJobs("senior designer");
  console.log("workingnomads:", wn.length, wn[0]?.title);
  const h = await fetchHimalayasJobs("designer");
  console.log("himalayas(designer):", h.length, h[0]?.title);

  // Raw body probes for the zero-yield APIs
  const muse = await fetch("https://www.themuse.com/api/public/jobs?category=Design&page=0").then((r) => r.json());
  console.log("muse raw:", muse.results?.length ?? "no results field", muse.results?.[0]?.name);
  const wnRaw = await fetch("https://www.workingnomads.com/api/exposed_jobs/").then((r) => r.json());
  console.log("wn raw type:", Array.isArray(wnRaw), "len:", wnRaw?.length, JSON.stringify(wnRaw?.[0]).slice(0, 300));
}

main().catch((e) => console.error(e));
