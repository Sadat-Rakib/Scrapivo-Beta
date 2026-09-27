import { describe, expect, it } from "vitest";
import {
  applyVerdictToPageBudget,
  classifyPageRelevance,
  hostOfUrl,
  newCandidatePageBudget,
} from "../page-relevance";

const ENTITY_TEXT =
  "Acme is a software company based in Toronto. Our team builds logistics tools. Contact us at hello@acme.test or call +1 416 555 0100. We are hiring across engineering.";

describe("classifyPageRelevance", () => {
  it("marks known-irrelevant furniture pages (microsoft support, privacy, cookie, legal) as IRRELEVANT", () => {
    const pages = [
      { url: "https://microsoft.com/support/contact-us", title: "Support - Microsoft", text: `Contact Microsoft support. ${ENTITY_TEXT}` },
      { url: "https://acme.test/privacy-policy", title: "Privacy Policy", text: `We respect your privacy. ${ENTITY_TEXT}` },
      { url: "https://acme.test/cookies", title: "Cookie Policy", text: `About cookies. ${ENTITY_TEXT}` },
      { url: "https://acme.test/terms", title: "Terms of Service", text: `Terms of use. ${ENTITY_TEXT}` },
      { url: "https://acme.test/legal/disclaimer", title: "Legal", text: `Legal notices. ${ENTITY_TEXT}` },
      { url: "https://consent.test/", title: "We value your privacy — manage cookies", text: ENTITY_TEXT },
    ];
    for (const page of pages) {
      const result = classifyPageRelevance({ ...page, entityName: "Acme", goal: "contacts" });
      expect(result.verdict, page.url).toBe("IRRELEVANT");
      expect(result.keepExtracting, page.url).toBe(false);
    }
  });

  it("marks a company team/contact page mentioning the entity and goal as RELEVANT", () => {
    const result = classifyPageRelevance({
      url: "https://acme.test/contact",
      title: "Contact Acme",
      text: ENTITY_TEXT,
      entityName: "Acme",
      goal: "contacts",
    });
    expect(result.verdict).toBe("RELEVANT");
    expect(result.keepExtracting).toBe(true);
  });

  it("marks a short empty page as THIN", () => {
    const result = classifyPageRelevance({
      url: "https://acme.test/",
      title: "Acme",
      text: "Acme.",
      entityName: "Acme",
    });
    expect(result.verdict).toBe("THIN");
    expect(result.keepExtracting).toBe(false);
  });

  it("maps friction markers to CHALLENGE / LOGIN_REQUIRED / RATE_LIMITED / BLOCKED", () => {
    const cases: Array<[string[], unknown]> = [
      [["CAPTCHA"], "CHALLENGE"],
      [["challenge"], "CHALLENGE"],
      [["LOGIN_WALL"], "LOGIN_REQUIRED"],
      [["RATE_LIMIT"], "RATE_LIMITED"],
      [["ACCESS_BLOCK"], "BLOCKED"],
    ];
    for (const [friction, verdict] of cases) {
      const result = classifyPageRelevance({ url: "https://x.test/a", title: "X", text: ENTITY_TEXT, friction: friction as string[] });
      expect(result.verdict).toBe(verdict);
      expect(result.keepExtracting).toBe(false);
    }
  });

  it("ignores benign friction overlays (MODAL, COOKIE_BANNER)", () => {
    const result = classifyPageRelevance({
      url: "https://acme.test/contact",
      title: "Contact Acme",
      text: ENTITY_TEXT,
      entityName: "Acme",
      goal: "contacts",
      friction: ["MODAL", "COOKIE_BANNER"],
    });
    expect(result.verdict).toBe("RELEVANT");
    expect(result.keepExtracting).toBe(true);
  });

  it("maps http errors to ERROR and never extracts from them", () => {
    const result = classifyPageRelevance({ url: "https://acme.test/", title: "Acme", text: ENTITY_TEXT, httpStatus: 500 });
    expect(result.verdict).toBe("ERROR");
    expect(result.keepExtracting).toBe(false);
  });

  it("marks a page about something else as WRONG_ENTITY", () => {
    const result = classifyPageRelevance({
      url: "https://othercompany.test/about",
      title: "Other Company — About Us",
      text: "Other Company builds accounting software for restaurants. Contact sales@othercompany.test.".repeat(4),
      entityName: "Acme",
      entityHost: "acme.test",
      goal: "contacts",
    });
    expect(result.verdict).toBe("WRONG_ENTITY");
    expect(result.keepExtracting).toBe(false);
  });

  it("does not flag WRONG_ENTITY when the page is on the entity's own host", () => {
    const result = classifyPageRelevance({
      url: "https://acme.test/contact",
      title: "Contact us",
      text: "Get in touch with our team at hello@acme.test or +1 416 555 0100. We are here to help.".repeat(3),
      entityName: "Acme",
      entityHost: "acme.test",
      goal: "contacts",
    });
    expect(result.keepExtracting).toBe(true);
  });

  it("keeps an entity page that is mostly navigation as PARTIALLY_RELEVANT", () => {
    const result = classifyPageRelevance({
      url: "https://acme.test/",
      title: "Acme",
      text: "Acme. Home Menu About us Contact us Sign in Subscribe Read more Privacy Terms Copyright. Follow our newsletter.",
      entityName: "Acme",
      goal: "research",
    });
    expect(result.verdict).toBe("PARTIALLY_RELEVANT");
    expect(result.keepExtracting).toBe(true);
  });

  it("keeps reading when there is no entity context and the page is substantial", () => {
    const result = classifyPageRelevance({
      url: "https://publisher.test/saas-founders",
      title: "Top SaaS founders",
      text: `${ENTITY_TEXT} ${ENTITY_TEXT}`,
    });
    expect(result.keepExtracting).toBe(true);
  });
});

describe("per-candidate page budget", () => {
  it("skips stop-verdict pages and counts them as wasted visits", () => {
    let budget = newCandidatePageBudget();
    let applied = applyVerdictToPageBudget(budget, "IRRELEVANT");
    budget = applied.budget;
    expect(applied.skipPage).toBe(true);
    expect(applied.abandonCandidate).toBe(false);
    expect(budget).toEqual({ visitedPages: 1, irrelevantPages: 1, abandoned: false });
  });

  it("abandons the candidate once more than half the visited pages are irrelevant", () => {
    let budget = newCandidatePageBudget();
    // First page irrelevant: 1/1 is over 50% but one stray page never kills a candidate.
    ({ budget } = applyVerdictToPageBudget(budget, "WRONG_ENTITY"));
    expect(budget.abandoned).toBe(false);
    // Second page relevant: 1/2 is not >50%.
    ({ budget } = applyVerdictToPageBudget(budget, "RELEVANT"));
    expect(budget.abandoned).toBe(false);
    // Third page irrelevant: 2/3 > 50% → abandon.
    const applied = applyVerdictToPageBudget(budget, "THIN");
    expect(applied.abandonCandidate).toBe(true);
    expect(applied.budget.abandoned).toBe(true);
  });

  it("does not count host-level faults toward the waste guard", () => {
    let budget = newCandidatePageBudget();
    for (const verdict of ["CHALLENGE", "RATE_LIMITED", "BLOCKED", "LOGIN_REQUIRED", "ERROR"] as const) {
      ({ budget } = applyVerdictToPageBudget(budget, verdict));
    }
    expect(budget.visitedPages).toBe(5);
    expect(budget.irrelevantPages).toBe(0);
    expect(budget.abandoned).toBe(false);
  });

  it("never abandons twice and stays pure on the input budget", () => {
    const original = { visitedPages: 2, irrelevantPages: 2, abandoned: false };
    const applied = applyVerdictToPageBudget(original, "IRRELEVANT");
    expect(applied.abandonCandidate).toBe(true);
    const again = applyVerdictToPageBudget(applied.budget, "RELEVANT");
    expect(again.abandonCandidate).toBe(false);
    expect(again.budget.abandoned).toBe(true);
    expect(original).toEqual({ visitedPages: 2, irrelevantPages: 2, abandoned: false });
  });
});

describe("hostOfUrl", () => {
  it("extracts a normalized host", () => {
    expect(hostOfUrl("https://www.Acme.test/contact")).toBe("acme.test");
    expect(hostOfUrl("not a url")).toBe("");
  });
});
