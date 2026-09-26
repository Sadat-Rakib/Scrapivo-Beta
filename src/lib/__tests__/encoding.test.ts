import { describe, expect, it } from "vitest";
import { fixMojibake } from "../encoding";

/** Phase 4: mojibake repair. */
describe("fixMojibake", () => {
  it("repairs cp1252 double-encoding", () => {
    expect(fixMojibake("itself â€” highest trust")).toBe("itself — highest trust");
    expect(fixMojibake("Acme Â· acme.com")).toBe("Acme · acme.com");
  });

  it("leaves clean text untouched", () => {
    expect(fixMojibake("plain ascii")).toBe("plain ascii");
    expect(fixMojibake("already — clean · text")).toBe("already — clean · text");
    expect(fixMojibake("")).toBe("");
  });

  it("never throws on non-strings", () => {
    expect(fixMojibake(null)).toBe("");
    expect(fixMojibake(undefined)).toBe("");
    expect(fixMojibake(42)).toBe("");
  });
});
