import { describe, expect, it, vi } from "vitest";
import { attributableEmail, attributablePhone } from "../contact-attribution";

describe("contact attribution", () => {
  it("gives a person only an address that names them", () => {
    expect(attributableEmail({ kind: "person", title: "Henrik Grim" }, ["anna@mimohq.com", "privacy@mimohq.com", "henrik@mimohq.com"])).toBe("henrik@mimohq.com");
    expect(attributableEmail({ kind: "person", title: "Andrew Breen" }, ["andrew.breen@outshine.com"])).toBe("andrew.breen@outshine.com");
    expect(attributableEmail({ kind: "person", title: "Jennifer Dulski" }, ["jdulski@risingteam.com"])).toBe("jdulski@risingteam.com");
    expect(attributableEmail({ kind: "person", title: "Pranjal Daga" }, ["yutong@withaccend.com"])).toBeNull();
    expect(attributableEmail({ kind: "person", title: "Alex Circei" }, ["contact@waydev.co"])).toBeNull();
    expect(attributableEmail({ kind: "person", title: "Mark Corbett" }, ["jobs@thrustcarbon.com"])).toBeNull();
  });

  it("never attaches a site phone to a person lead", () => {
    expect(attributablePhone({ kind: "person", title: "Alex Circei" }, ["+16502760560"])).toBeNull();
    expect(attributablePhone({ kind: "business", title: "Model Milk" }, ["+1 403-555-0100"])).toBe("+1 403-555-0100");
  });

  it("site enrichment attaches only observed, attributable contacts", async () => {
    vi.resetModules();
    vi.doMock("@/lib/contact/discover-contacts.server", () => ({
      discoverContacts: async () => ({
        emails: [
          { email: "anna@mimohq.com", origin: "harvested", verification: { tier: "unverified" } },
          { email: "henrik.grim@mimohq.com", origin: "derived", verification: { tier: "unverified" } },
        ],
        phones: [{ e164: "+15550100", phone: "+1 555 0100" }],
      }),
    }));
    const { enrichSpecRowFromSite } = await import("../enrich-incomplete");
    const person = await enrichSpecRowFromSite({ kind: "person", title: "Henrik Grim", website_url: "https://mimohq.com", url: "https://mimohq.com", source_url: "https://mimohq.com" } as never);
    expect(person.email ?? null).toBeNull();
    expect(person.phone ?? null).toBeNull();
    vi.doUnmock("@/lib/contact/discover-contacts.server");
  });

  it("gives a business its public inbox but never legal, privacy, careers or no-reply addresses", () => {
    expect(attributableEmail({ kind: "business", title: "Model Milk" }, ["privacy@modelmilk.ca", "info@modelmilk.ca"])).toBe("info@modelmilk.ca");
    expect(attributableEmail({ kind: "company", title: "Postal" }, ["privacy@postal.com", "noreply@postal.com", "jobs@postal.com"])).toBeNull();
    expect(attributableEmail({ kind: "company", title: "Waydev" }, ["contact@waydev.co"])).toBe("contact@waydev.co");
  });
});
