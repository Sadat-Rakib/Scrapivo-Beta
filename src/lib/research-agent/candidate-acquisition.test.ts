import { describe, expect, it, vi } from "vitest";
import {
  fetchStaticPage,
  registrableDomainOf,
  researchConcurrency,
  requiresRendering,
  runCandidateTasks,
  staticPageToSnapshot,
} from "./candidate-acquisition.server";

const HTML_PAGE = `<!doctype html><html><head><title>Acme Plumbing</title>
<script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme"}</script></head>
<body><h1>Acme Plumbing</h1><p>We are currently operating and serving the area.</p>
<a href="/contact">Contact</a><a href="https://other.test/x">Other</a>
<p>Email us at sales@acmeplumbing.test or call +1 512 555 0100.</p></body></html>`;

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

describe("researchConcurrency", () => {
  it("defaults to 3 and clamps 1-6", () => {
    expect(researchConcurrency({})).toBe(3);
    expect(researchConcurrency({ SCRAPIVO_RESEARCH_CONCURRENCY: "4" })).toBe(4);
    expect(researchConcurrency({ SCRAPIVO_RESEARCH_CONCURRENCY: "0" })).toBe(3);
    expect(researchConcurrency({ SCRAPIVO_RESEARCH_CONCURRENCY: "-2" })).toBe(3);
    expect(researchConcurrency({ SCRAPIVO_RESEARCH_CONCURRENCY: "1" })).toBe(1);
    expect(researchConcurrency({ SCRAPIVO_RESEARCH_CONCURRENCY: "99" })).toBe(6);
    expect(researchConcurrency({ SCRAPIVO_RESEARCH_CONCURRENCY: "2.7" })).toBe(2);
  });
});

describe("registrableDomainOf", () => {
  it("reduces hosts to the registrable domain", () => {
    expect(registrableDomainOf("https://www.acme.test/contact")).toBe("acme.test");
    expect(registrableDomainOf("https://team.acme.test/about")).toBe("acme.test");
    expect(registrableDomainOf("https://shop.acme.co.uk/x")).toBe("acme.co.uk");
    expect(registrableDomainOf("https://acme.test")).toBe("acme.test");
    expect(registrableDomainOf("not a url")).toBeNull();
  });
});

describe("runCandidateTasks", () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it("runs at most `concurrency` tasks in flight", async () => {
    const gates = Array.from({ length: 4 }, () => deferred());
    let inFlight = 0;
    let peak = 0;
    const tasks = gates.map((gate) => ({
      domain: `d${Math.random()}`,
      work: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
        return "done";
      },
    }));
    const run = runCandidateTasks(tasks, 2);
    await vi.waitFor(() => expect(peak).toBe(2));
    gates.forEach((gate) => gate.resolve());
    const result = await run;
    expect(peak).toBe(2);
    expect(result.results).toEqual(["done", "done", "done", "done"]);
  });

  it("never lets two tasks on the same domain overlap", async () => {
    const events: string[] = [];
    const makeTask = (name: string, domain: string) => ({
      domain,
      work: async () => {
        events.push(`enter:${name}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`exit:${name}`);
      },
    });
    const tasks = [
      makeTask("a1", "acme.test"),
      makeTask("a2", "acme.test"),
      makeTask("b1", "beta.test"),
      makeTask("a3", "acme.test"),
    ];
    const run = runCandidateTasks(tasks, 3);
    await new Promise((r) => setTimeout(r, 25));
    await run;
    // Track max concurrent acme entries: walk the event log.
    let acmeActive = 0;
    let acmePeak = 0;
    for (const event of events) {
      if (event.startsWith("enter:a")) acmeActive += 1;
      if (event.startsWith("exit:a")) acmeActive -= 1;
      acmePeak = Math.max(acmePeak, acmeActive);
    }
    expect(acmePeak).toBe(1);
    expect(events.filter((e) => e.startsWith("enter:"))).toHaveLength(4);
  });

  it("skips ahead when the next task's domain is busy", async () => {
    const release = deferred();
    const order: string[] = [];
    const run = runCandidateTasks([
      { domain: "blocked.test", work: async () => { await release.promise; order.push("blocked"); return 1; } },
      { domain: "free.test", work: async () => { order.push("free"); return 2; } },
    ], 2);
    await vi.waitFor(() => expect(order).toContain("free"));
    release.resolve();
    const result = await run;
    expect(result.results).toEqual([1, 2]);
  });

  it("stops starting new tasks after abort", async () => {
    const controller = new AbortController();
    let started = 0;
    const run = runCandidateTasks(Array.from({ length: 4 }, () => ({
      domain: null,
      work: async () => {
        started += 1;
        controller.abort();
        throw new Error("SEARCH_CANCELLED");
      },
    })), 2, controller.signal);
    const result = await run;
    expect(started).toBeLessThan(4);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.error).toMatchObject({ message: "SEARCH_CANCELLED" });
  });

  it("records per-task errors without losing other results", async () => {
    const result = await runCandidateTasks([
      { domain: "ok.test", work: async () => "fine" },
      { domain: "bad.test", work: async () => { throw new Error("boom"); } },
    ], 2);
    expect(result.results[0]).toBe("fine");
    expect(result.results[1]).toBeUndefined();
    expect(result.errors).toEqual([{ index: 1, error: expect.objectContaining({ message: "boom" }) }]);
  });
});

describe("fetchStaticPage", () => {
  it("extracts title, text, contacts, links, and JSON-LD from a static page", async () => {
    const fetchPage = vi.fn(async () => htmlResponse(HTML_PAGE));
    const read = await fetchStaticPage("https://acmeplumbing.test/", { fetchPage });
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(read.decision).toBe("static_used");
    expect(read.staticUsable).toBe(true);
    expect(read.status).toBe(200);
    expect(read.title).toBe("Acme Plumbing");
    expect(read.text).toContain("currently operating");
    expect(read.emails).toEqual(["sales@acmeplumbing.test"]);
    expect(read.phones[0]).toContain("512");
    expect(read.links.map((l) => l.url)).toContain("https://acmeplumbing.test/contact");
    expect(read.jsonLdTypes).toEqual(["LocalBusiness"]);
  });

  it("marks non-OK responses as static_failed", async () => {
    const fetchPage = vi.fn(async () => htmlResponse("<html><body>gone</body></html>", 500));
    const read = await fetchStaticPage("https://acmeplumbing.test/", { fetchPage });
    expect(read.decision).toBe("static_failed");
    expect(read.staticUsable).toBe(false);
    expect(read.status).toBe(500);
  });

  it("marks fetch errors as static_failed", async () => {
    const read = await fetchStaticPage("https://acmeplumbing.test/", {
      fetchPage: async () => { throw new Error("ECONNREFUSED"); },
    });
    expect(read.decision).toBe("static_failed");
    expect(read.error).toBe("ECONNREFUSED");
  });

  it("marks tiny pages as static_insufficient", async () => {
    const read = await fetchStaticPage("https://acmeplumbing.test/", {
      fetchPage: async () => htmlResponse("<html><body><p>Hi</p></body></html>"),
    });
    expect(read.decision).toBe("static_insufficient");
    expect(read.staticUsable).toBe(false);
  });

  it("does not fetch pages that are known to require rendering", async () => {
    const fetchPage = vi.fn(async () => htmlResponse(HTML_PAGE));
    const read = await fetchStaticPage("https://www.linkedin.com/company/acme", { fetchPage });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(read.decision).toBe("rendering_required");
    expect(requiresRendering("https://x.com/acme")).toBe(true);
    expect(requiresRendering("https://acmeplumbing.test/team")).toBe(false);
  });
});

describe("staticPageToSnapshot", () => {
  it("maps a static read onto the browser snapshot contract", async () => {
    const read = await fetchStaticPage("https://acmeplumbing.test/", { fetchPage: async () => htmlResponse(HTML_PAGE) });
    const snapshot = staticPageToSnapshot(read);
    expect(snapshot.url).toBe("https://acmeplumbing.test/");
    expect(snapshot.title).toBe("Acme Plumbing");
    expect(snapshot.visibleRelevantText).toContain("sales@acmeplumbing.test");
    expect(snapshot.headings).toEqual(["Acme Plumbing"]);
    expect(snapshot.friction).toEqual([]);
    expect(snapshot.loadingState).toBe("complete");
    expect(snapshot.links[0]?.ref).toBe("l0");
  });
});
