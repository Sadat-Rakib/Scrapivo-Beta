import { readFileSync } from "fs";

const data = JSON.parse(readFileSync("./data/investors_merged.json", "utf8"));

const locCounts = {};
data.investors.forEach((inv) => {
  const locs = inv.investment_locations || [];
  const key = locs.length === 0 ? "EMPTY" : locs.sort().join(", ");
  locCounts[key] = (locCounts[key] || 0) + 1;
});

const sorted = Object.entries(locCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30);
console.log("Top 30 investment_locations patterns:\n");
sorted.forEach(([locs, count]) => {
  console.log(`${count.toString().padStart(4)} investors: ${locs}`);
});

console.log(`\nTotal unique patterns: ${Object.keys(locCounts).length}`);
console.log(`Total investors: ${data.investors.length}`);
