import { describe, expect, it } from "vitest";
import { ALL_JOB_SOURCE_IDS } from "../types";
import { ensureFreehireSourceRegistered } from "../freehire-source";
import { listJobSources } from "../registry";

/**
 * Regression: the Jobs page never queried the 3.3M-posting freehire
 * catalogue because (a) runJobSearch didn't register the source and
 * (b) "freehire" wasn't in ALL_JOB_SOURCE_IDS so the registry filtered it.
 */
describe("freehire source wiring", () => {
  it("freehire is a selectable source id", () => {
    expect(ALL_JOB_SOURCE_IDS).toContain("freehire");
  });

  it("registration exposes the adapter to the registry", () => {
    ensureFreehireSourceRegistered();
    const ids = listJobSources().map((s) => s.id);
    expect(ids).toContain("source-freehire");
  });
});
