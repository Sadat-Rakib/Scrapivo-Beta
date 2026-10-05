import { describe, it } from "vitest";
import { extractFrameDeterministic } from "./fallback";
import { validateFrame } from "./validate";
import { frameToSearchSpec } from "./to-search-spec";
import { classifyHead } from "./lexicon";
import { decideSpecClarification } from "@/lib/stage1/stage1-adapter";

const show = (q: string) => {
  const { frame } = validateFrame(extractFrameDeterministic(q));
  const spec = frameToSearchSpec(frame);
  console.log("=== ", q);
  console.log("entity:", frame.target.entity_type.value, "| role:", frame.target.role?.value ?? null, "| category:", frame.target.category?.value ?? null, "| industry:", frame.target.industry?.value ?? null);
  console.log("relation:", frame.relation.type.value, frame.relation.object?.value ?? null, "| clar:", JSON.stringify(frame.clarification));
  console.log("criteria:", spec.criteria.map((c) => `${c.field}=${c.value}`).join(", "));
  console.log("missing:", spec.missing, "| decide:", decideSpecClarification(spec)?.id ?? null);
};

describe("probe2", () => {
  it("micro", () => {
    for (const h of ["anyone", "solar", "marketing", "installation", "solar installation", "well", "folks", "someone"]) {
      const c = classifyHead(h);
      console.log("head", JSON.stringify(h), "->", c.kind, "head:", c.head, "guessed:", (c as unknown as { guessed?: boolean }).guessed ?? false);
    }
  });

  it("controls", () => {
    show("anyone in Kraków hiring Go devs");
    show("who around Porto needs SEO");
    show("companies doing marketing in Madrid");
    show("companies that do well");
    show("startups doing AI");
    show("solar installers in Windhoek");
    show("agencies doing branding work in Leeds");
  });
});
