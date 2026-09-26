import { describe, expect, it } from "vitest";
import { elementsToLeads } from "../osm-local-businesses.server";

describe("OSM website absence research seeds", () => {
  it("preserves the OSM record and marks a missing website as unverified absence", () => {
    const [lead] = elementsToLeads([{
      type: "node",
      id: 123,
      tags: { name: "Clearwater Plumbing", craft: "plumber", phone: "+1-512-555-0199" },
    }], "Austin", "plumber", 10);
    expect(lead.full_post_url).toBeUndefined();
    expect((lead as typeof lead & { structured_website_absent?: boolean }).structured_website_absent).toBe(true);
    expect((lead as typeof lead & { source_record_url?: string }).source_record_url).toBe("https://www.openstreetmap.org/node/123");
  });

  it("does not mistake a public directory profile for an official website", () => {
    const [lead] = elementsToLeads([{
      type: "way",
      id: 456,
      tags: { name: "Clearwater Plumbing", craft: "plumber", website: "https://www.yelp.com/biz/clearwater-plumbing" },
    }], "Austin", "plumber", 10);
    expect(lead.full_post_url).toBeUndefined();
    expect((lead as typeof lead & { structured_website_absent?: boolean }).structured_website_absent).toBe(true);
  });
});
