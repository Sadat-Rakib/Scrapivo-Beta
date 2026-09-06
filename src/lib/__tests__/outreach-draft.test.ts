import { describe, expect, it } from "vitest";
import { buildEmailDraft, buildMessageDraft } from "../outreach-draft";

const lead = {
  name: "Maria Cirino",
  firm: ".406 Ventures",
  role: "Founding Managing Partner",
  location: "Boston, USA",
  sector: "AI",
  whyMatch: "Investor at .406 Ventures — backs pre-seed rounds, invests in AI.",
};

describe("buildEmailDraft", () => {
  it("personalizes with real row values only", () => {
    const { subject, body } = buildEmailDraft(lead, { name: "Mir", service: "web apps" });
    expect(subject).toContain("Maria");
    expect(subject).toContain(".406 Ventures");
    expect(body).toContain("Hi Maria,");
    expect(body).toContain("backs pre-seed rounds");
    expect(body).toContain("Mir (web apps)");
  });
  it("falls back cleanly without why/sector", () => {
    const { body } = buildEmailDraft({ name: "X Y", firm: "Z" }, {});
    expect(body).toContain("Hi X,");
    expect(body).not.toContain("undefined");
  });
});

describe("buildMessageDraft", () => {
  it("is short and personalized", () => {
    const m = buildMessageDraft(lead, { name: "Mir" });
    expect(m).toContain("Hi Maria");
    expect(m).toContain(".406 Ventures");
    expect(m.length).toBeLessThan(400);
  });
});
