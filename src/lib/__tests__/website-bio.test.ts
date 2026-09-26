/** Phase 2c: website-bio battery. Extractive only, cached, bounded. */
import { describe, expect, it, vi } from "vitest";
import {
  clearWebsiteBioCache,
  extractBlurb,
  fetchWebsiteBio,
} from "@/lib/search/website-bio.server";

describe("extractBlurb", () => {
  it("picks substance, skips nav boilerplate", () => {
    const blurb = extractBlurb("Smile Dental", [
      "Menu Home About Contact",
      "Cookie policy: we use cookies.",
      "Smile Dental has served Pune families with gentle, affordable dental care for over fifteen years.",
      "Book your visit today for a brighter smile!",
    ].join("\n"));
    expect(blurb).toContain("Smile Dental");
    expect(blurb).toContain("fifteen years");
    expect(blurb).not.toContain("Cookie policy");
    expect(blurb!.length).toBeLessThanOrEqual(280);
  });
  it("thin pages → null (no filler invented)", () => {
    expect(extractBlurb("", "Hi\nOK")).toBeNull();
    expect(extractBlurb("", "")).toBeNull();
  });
});

describe("fetchWebsiteBio", () => {
  it("caches: second call never refetches", async () => {
    clearWebsiteBioCache();
    const fetchPage = vi.fn(async () => ({
      title: "Smile Dental",
      text: "Smile Dental has served Pune families with gentle, affordable dental care for over fifteen years.",
      markdown: "",
    }));
    const a = await fetchWebsiteBio("https://smile.example", { fetchPage });
    const b = await fetchWebsiteBio("https://smile.example", { fetchPage });
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("bad URL and failed fetch → null (honest, cached negative)", async () => {
    clearWebsiteBioCache();
    expect(await fetchWebsiteBio("not a url")).toBeNull();
    const fetchPage = vi.fn(async () => null);
    expect(await fetchWebsiteBio("https://down.example", { fetchPage })).toBeNull();
    expect(await fetchWebsiteBio("https://down.example", { fetchPage })).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
