import { describe, expect, it } from "vitest";
import {
  beginSearchBrowserProgress,
  finishSearchBrowserProgress,
  publishSearchBrowserProgress,
  readSearchBrowserProgress,
  type StreamedLead,
} from "../search-browser-progress.server";

const lead = (n: number): StreamedLead => ({ key: `browser:${n}`, entity_id: `browser:${n}`, kind: "person", title: `Founder ${n}`, url: null,
  website_url: `https://company${n}.test`, profile_url: null, email: null, phone: null, location: null, why_match: null });

describe("progress stream retention", () => {
  it("keeps every streamed lead when activity overflows the event cap", () => {
    beginSearchBrowserProgress("run-retain", "owner");
    for (let n = 0; n < 5; n++) publishSearchBrowserProgress("run-retain", "owner", { action: "Lead verified", row: lead(n) });
    for (let n = 0; n < 300; n++) publishSearchBrowserProgress("run-retain", "owner", { action: "Read page", source: `site${n}.test` });
    const { events } = readSearchBrowserProgress("run-retain", "owner", 0);
    expect(events.filter((event) => event.row).map((event) => event.row!.title)).toEqual(["Founder 0", "Founder 1", "Founder 2", "Founder 3", "Founder 4"]);
    expect(events.filter((event) => !event.row)).toHaveLength(80);
    // Ids stay strictly increasing, so cursor reads never skip or repeat.
    const ids = events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    const after = readSearchBrowserProgress("run-retain", "owner", ids.at(-2)!);
    expect(after.events).toHaveLength(1);
  });

  it("is owner-scoped and stops accepting events once finished", () => {
    beginSearchBrowserProgress("run-owned", "owner");
    publishSearchBrowserProgress("run-owned", "someone-else", { action: "Lead verified", row: lead(9) });
    expect(readSearchBrowserProgress("run-owned", "owner", 0).events).toEqual([]);
    expect(readSearchBrowserProgress("run-owned", "someone-else", 0).events).toEqual([]);
    finishSearchBrowserProgress("run-owned", "owner");
    publishSearchBrowserProgress("run-owned", "owner", { action: "Late event" });
    expect(readSearchBrowserProgress("run-owned", "owner", 0)).toEqual({ events: [], done: true });
  });
});
