import { describe, expect, it } from "vitest";
import {
  readScrapyBrowserState,
  scrapySessionChallenge,
  scrapySessionControl,
  scrapySessionStarted,
} from "../scrapy-browser.server";

describe("scrapy browser challenge state (Workstream F)", () => {
  it("flags a challenge from page friction and clears it on a clean page", () => {
    scrapySessionStarted({ sessionId: "s-chal-1", runId: "r1", ownerId: "o", adapter: "worker" });
    scrapySessionChallenge("s-chal-1", ["CAPTCHA"]);
    let state = readScrapyBrowserState("r1", "o");
    expect(state?.challenge).toBe("CAPTCHA");
    expect(state?.challengeAt).not.toBeNull();

    scrapySessionChallenge("s-chal-1", []);
    state = readScrapyBrowserState("r1", "o");
    expect(state?.challenge).toBeNull();
    // Clean page after a challenge = research resumed under agent control.
    expect(state?.resumedAt).not.toBeNull();
  });

  it("maps login walls, blocks and rate limits to their challenge kinds", () => {
    scrapySessionStarted({ sessionId: "s-chal-2", runId: "r2", ownerId: "o", adapter: "worker" });
    scrapySessionChallenge("s-chal-2", ["LOGIN_WALL"]);
    expect(readScrapyBrowserState("r2", "o")?.challenge).toBe("LOGIN_WALL");
    scrapySessionChallenge("s-chal-2", ["ACCESS_BLOCK"]);
    expect(readScrapyBrowserState("r2", "o")?.challenge).toBe("ACCESS_BLOCK");
    scrapySessionChallenge("s-chal-2", ["RATE_LIMIT"]);
    expect(readScrapyBrowserState("r2", "o")?.challenge).toBe("RATE_LIMIT");
  });

  it("records resume when the human gives control back", () => {
    scrapySessionStarted({ sessionId: "s-chal-3", runId: "r3", ownerId: "o", adapter: "worker" });
    scrapySessionControl("s-chal-3", { controller: "human" });
    expect(readScrapyBrowserState("r3", "o")?.controller).toBe("human");
    expect(readScrapyBrowserState("r3", "o")?.resumedAt).toBeNull();

    scrapySessionControl("s-chal-3", { controller: "agent" });
    const state = readScrapyBrowserState("r3", "o");
    expect(state?.controller).toBe("agent");
    expect(state?.resumedAt).not.toBeNull();
  });

  it("is owner-scoped on read", () => {
    scrapySessionStarted({ sessionId: "s-chal-4", runId: "r4", ownerId: "o", adapter: "worker" });
    scrapySessionChallenge("s-chal-4", ["CAPTCHA"]);
    expect(readScrapyBrowserState("r4", "someone-else")).toBeNull();
    expect(readScrapyBrowserState("r4", "o")?.challenge).toBe("CAPTCHA");
  });
});
