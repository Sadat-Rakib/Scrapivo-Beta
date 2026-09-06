import { describe, expect, it } from "vitest";
import { detectSearchVertical, buildClarifyingQuestions, shouldClarify } from "../clarifier";
import { classifyQuery } from "../query-classifier";
import { resolveSearchVertical } from "../vertical";
import { decideSource } from "../source-router";

describe("detectSearchVertical — investor hunts", () => {
  it("routes informal investor asks with filler between verb and noun", () => {
    expect(detectSearchVertical("yo find me investors rn")).toBe("investors");
    expect(detectSearchVertical("find me investors")).toBe("investors");
    expect(detectSearchVertical("need some investors")).toBe("investors");
    expect(detectSearchVertical("help me find investors")).toBe("investors");
    expect(detectSearchVertical("get me investors for my ai startup")).toBe("investors");
  });
  it("keeps the original adjacency matches working", () => {
    expect(detectSearchVertical("find investors")).toBe("investors");
    expect(detectSearchVertical("need investors")).toBe("investors");
    expect(detectSearchVertical("looking for vcs")).toBe("investors");
    expect(detectSearchVertical("investors backing pre-seed AI startups")).toBe("investors");
    expect(detectSearchVertical("raising a seed round for my startup")).toBe("investors");
  });
  it("tokenizer noun fallback catches verbless investor asks", () => {
    expect(detectSearchVertical("investors for my ai startup")).toBe("investors");
    expect(detectSearchVertical("angel investors in europe")).toBe("investors");
  });
  it("never misroutes ambiguous finance verbs or deal-flow", () => {
    expect(detectSearchVertical("companies raising prices")).toBeUndefined();
    expect(detectSearchVertical("need funding for marketing school")).toBeUndefined();
  });
});

describe("detectSearchVertical — other verticals", () => {
  it("routes local business hunts", () => {
    expect(detectSearchVertical("plumbers in Austin")).toBe("local");
    expect(detectSearchVertical("dentists near me")).toBe("local");
  });
  it("leaves job queries undefined (regex layer)", () => {
    expect(detectSearchVertical("companies hiring engineers this q")).toBeUndefined();
  });
  it("keeps the hardcoded demo-city local routing (pre-existing)", () => {
    expect(detectSearchVertical("best marketing agencies in London")).toBe("local");
  });
});

describe("resolveSearchVertical — canonical client+server verdict", () => {
  it("agrees with the pipeline on investors", () => {
    expect(resolveSearchVertical("yo find me investors rn")).toBe("investors");
    expect(resolveSearchVertical("find me investors")).toBe("investors");
  });
  it("maps job and business tokenizer categories", () => {
    expect(resolveSearchVertical("companies hiring engineers this q")).toBe("jobs");
    expect(resolveSearchVertical("plumbers in Austin")).toBe("local");
  });
  it("falls back to general", () => {
    expect(resolveSearchVertical("need a logo designer for my brand")).toBe("general");
  });
});

describe("decideSource — DB-first for investor queries", () => {
  it("returns local when the investor DB satisfies the request", () => {
    const classified = classifyQuery("yo find me investors rn");
    expect(decideSource(classified, 40, 12)).toBe("local");
  });
  it("returns blend/live when the DB is thin", () => {
    const classified = classifyQuery("yo find me investors rn");
    expect(decideSource(classified, 2, 12)).toBe("blend");
    expect(decideSource(classified, 0, 12)).toBe("live");
  });
  it("keeps jobs live", () => {
    const classified = classifyQuery("companies hiring engineers this q");
    expect(decideSource(classified, 40, 12)).toBe("live");
  });
});

describe("buildClarifyingQuestions — vertical-first, input-tailored", () => {
  it("asks investor questions (never YoE / ideal buyer) for investor queries", () => {
    const classified = classifyQuery("yo find me investors rn");
    const questions = buildClarifyingQuestions(classified, { hasLocation: false });
    expect(questions.length).toBeGreaterThan(0);
    const ids = questions.map((q) => q.id);
    expect(ids).toContain("investor_stage");
    expect(ids).not.toContain("experience");
    expect(ids).not.toContain("buyer_type");
  });
  it("skips slots the user already stated", () => {
    const classified = classifyQuery("investors backing pre-seed AI startups");
    const questions = buildClarifyingQuestions(classified, {
      hasLocation: false,
      known: { stage: "pre-seed", sector: "ai" },
    });
    const ids = questions.map((q) => q.id);
    expect(ids).not.toContain("investor_stage");
    expect(ids).not.toContain("investor_sector");
  });
  it("skips geography when the tokenizer resolved a place", () => {
    const classified = classifyQuery("find me investors in Austin");
    const questions = buildClarifyingQuestions(classified, {
      hasLocation: false,
      known: { stage: null, sector: null, geo: "austin" },
    });
    const ids = questions.map((q) => q.id);
    expect(ids).not.toContain("geography");
  });
  it("still asks local questions for local hunts", () => {
    const classified = classifyQuery("plumbers in Austin");
    const questions = buildClarifyingQuestions(classified, { hasLocation: true });
    expect(questions.map((q) => q.id)).toContain("local_opportunity");
  });
  it("shouldClarify agrees for investor queries", () => {
    expect(shouldClarify(classifyQuery("yo find me investors rn"))).toBe(true);
  });
});
