/** Profile the S3 dentist-in-Dhaka scan stage by stage. */
import { searchBusinessesDB } from "@/lib/canonical/businesses.server";

const t = (label: string, t0: number) =>
  console.log(label, Date.now() - t0 + "ms");

let t0 = Date.now();
const r = await searchBusinessesDB({ category: "dentists", location: "Dhaka", limit: 26 });
t("total", t0);
console.log(
  JSON.stringify({
    rows: r.rows.length,
    rowsScanned: r.meta.rowsScanned,
    partitions: r.meta.partitionsRead,
  }),
);
