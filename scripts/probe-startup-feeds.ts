import { classifyQuery } from "../src/lib/search/query-classifier";
import { expandFromClassified } from "../src/lib/search/query-expander";
import { searchDealroomJustFounded } from "../src/lib/search/dealroom-sources.server";
import { searchNeuronFeedStartups } from "../src/lib/search/neuronfeed-sources.server";

const q = process.argv[2] || "I'm an investor looking for startups who are raising";
const c = classifyQuery(q);
console.log("classified", {
  core: c.coreSkill,
  type: c.type,
  signal: c.signalMode,
  family: c.signalFamily,
});
const x = expandFromClassified(c);
console.log("expanded", { skill: x.skill, related: x.relatedSkills.slice(0, 5) });
const [d, n] = await Promise.all([searchDealroomJustFounded(x), searchNeuronFeedStartups(x)]);
console.log("dealroom", d.length, d.slice(0, 3).map((l) => l.title));
console.log("neuronfeed", n.length, n.slice(0, 3).map((l) => l.title));
