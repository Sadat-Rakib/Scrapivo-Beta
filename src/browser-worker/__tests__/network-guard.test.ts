import { describe, expect, it } from "vitest";
import { createUrlGuard, isPublicIp } from "../network-guard";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("browser network guard", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "100.64.0.1", "224.0.0.1", "192.0.2.10", "198.51.100.7", "203.0.113.9", "::1", "fe80::1", "fc00::1",
    "fd12:3456::1", "::ffff:127.0.0.1", "2001:db8::1", "::",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it.each([
    "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/", "chrome://settings",
    "http://user:pass@example.com/", "https://example.com:8443/", "http://localhost/", "http://intranet.corp/",
    "http://metadata.google.internal/computeMetadata/v1/", "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/", "http://10.0.0.5/", "not a url",
  ])("blocks unsafe destination %s", async (url) => {
    const guard = createUrlGuard({ resolve: publicResolver });
    await expect(guard(url)).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("rejects a host when ANY resolved address is private (split horizon / rebinding)", async () => {
    const guard = createUrlGuard({ resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.8", family: 4 }] });
    await expect(guard("https://example.com/")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("pins the validated address so a later DNS answer cannot rebind the host", async () => {
    const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
    const guard = createUrlGuard({ resolve: async () => answers.shift() ?? [], cacheMs: 60_000 });
    expect((await guard("https://example.com/a")).address).toBe("93.184.216.34");
    // Second lookup would return loopback; the pinned public address is used.
    expect((await guard("https://example.com/b")).address).toBe("93.184.216.34");
  });

  it("re-validates after the pin expires and blocks a rebound private answer", async () => {
    const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
    const guard = createUrlGuard({ resolve: async () => answers.shift() ?? [], cacheMs: 0 });
    await guard("https://example.com/a");
    await expect(guard("https://example.com/b")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("reports resolution failure distinctly", async () => {
    const guard = createUrlGuard({ resolve: async () => { throw new Error("ENOTFOUND"); } });
    await expect(guard("https://no-such-host.example/")).rejects.toMatchObject({ code: "DNS_UNAVAILABLE" });
  });

  it("allows loopback only for exact test-injected authorities", async () => {
    const guard = createUrlGuard({ resolve: publicResolver, testAllow: new Set(["127.0.0.1:4555"]) });
    await expect(guard("http://127.0.0.1:4555/page")).resolves.toMatchObject({ address: "127.0.0.1" });
    await expect(guard("http://127.0.0.1:4556/page")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(guard("http://u:p@127.0.0.1:4555/")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });
});
