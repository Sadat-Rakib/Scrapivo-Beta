import { readFileSync } from "fs";
import { spawnSync } from "child_process";

const map = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const keys = [
  "USE_PAID_SOURCES",
  "SERPER_API_KEY",
  "SCRAPINGDOG_API_KEY",
  "SERPAPI_KEY",
  "SERPAPI_MAX_CALLS_PER_RUN",
];

for (const key of keys) {
  const val = map[key];
  if (!val) {
    console.log("skip", key);
    continue;
  }
  for (const target of ["production", "preview", "development"]) {
    const r = spawnSync("vercel", ["env", "add", key, target, "--force", "--yes"], {
      input: val + "\n",
      encoding: "utf8",
      shell: true,
    });
    const out = ((r.stdout || "") + (r.stderr || ""))
      .split(/\n/)
      .filter((l) => /Overrode|Created|Error|✓/i.test(l))
      .slice(0, 2)
      .join(" | ");
    console.log(key, "→", target, r.status === 0 ? "OK" : "FAIL", out.slice(0, 140));
  }
}
