import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(".env", "utf8");
const get = (k) => { const m = new RegExp(`^${k}="?([^"\n]*)"?,?$`, "m").exec(env); return m?.[1]?.trim(); };
const pw = get("DB_PASSWORD");
const host = "2600:1f11:a1d:9201:5218:3341:dd62:6f24";
const client = new pg.Client({
  host, port: 5432, user: "postgres", password: pw, database: "postgres",
  ssl: { rejectUnauthorized: false, servername: "db.fxcrmybvfokyrvcuhcgh.supabase.co" },
  connectionTimeoutMillis: 20000,
});
await client.connect();
console.log("CONNECTED");
for (const file of ["supabase/migrations/20260904000000_attachments.sql", "supabase/migrations/20261004000000_attachment_registry.sql"]) {
  const sql = readFileSync(file, "utf8");
  await client.query(sql);
  console.log("APPLIED:", file);
}
const { rows } = await client.query("select tablename from pg_tables where tablename in ('attachments_registry')");
console.log("TABLES:", rows.map(r => r.tablename).join(","));
const pol = await client.query("select policyname from pg_policies where tablename='objects' and policyname ilike '%attachment%'");
console.log("STORAGE POLICIES:", pol.rows.map(r => r.policyname).join(","));
await client.end();
