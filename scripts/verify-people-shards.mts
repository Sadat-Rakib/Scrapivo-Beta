import { searchPeopleDB } from "@/lib/canonical/people.server";

for (const country of ["USA", "India", "Atlantis"]) {
  const t0 = Date.now();
  const r = await searchPeopleDB({ role: "founder", country, limit: 5 });
  console.log(
    JSON.stringify({
      country,
      rows: r.rows.length,
      parts: r.meta.partitionsRead,
      ms: Date.now() - t0,
    }),
  );
}
