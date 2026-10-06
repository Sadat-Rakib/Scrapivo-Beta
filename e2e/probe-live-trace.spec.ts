import { expect, test } from "@playwright/test";
import { fromJSON, fromCrossJSON } from "seroval";
import { writeFileSync, mkdirSync } from "node:fs";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";
const QUERIES = (process.env.PROBE_QUERIES ?? "freight forwarders in Tbilisi").split("|");

type RunRequest = { query: string; force?: boolean; search_run_id?: string };

test("live trace probe", async ({ page }) => {
  test.setTimeout(1_500_000);
  mkdirSync("reports/probe", { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("scrapivo:onboarding-skipped", "1");
    localStorage.setItem("scrapivo:guided-tour-seen", "1");
  });
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/discover|home|\/$/, { timeout: 60_000 });

  for (const q of QUERIES) {
    const event: { request?: RunRequest; result?: unknown; raw?: string; failure?: string } = {};
    let request: import("@playwright/test").Request | undefined;
    let response: import("@playwright/test").Response | undefined;
    let resolveResponse!: () => void;
    const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
    const onRequest = (candidate: import("@playwright/test").Request) => {
      try {
        if (candidate.method() !== "POST") return;
        const body = candidate.postData() ?? "";
        if (!body.includes("search_run_id") || !body.includes("query")) return;
        if (!body.includes(JSON.stringify(q)) && !body.includes(q)) return;
        const payload = fromJSON(JSON.parse(body), { plugins: [] }) as { data?: RunRequest };
        if (payload.data?.query !== q) return;
        if (request) return;
        request = candidate;
        event.request = payload.data;
      } catch { /* ignore */ }
    };
    const onResponse = (candidate: import("@playwright/test").Response) => {
      if (candidate.request() !== request) return;
      response = candidate;
      void candidate.finished().then(() => resolveResponse());
    };
    page.on("request", onRequest);
    page.on("response", onResponse);
    try {
      await page.goto("/discover");
      const skip = page.locator("text=Skip for now").first();
      if (await skip.isVisible({ timeout: 10_000 }).catch(() => false)) await skip.click();
      const box = page.getByRole("textbox").first();
      await expect(box).toBeVisible({ timeout: 60_000 });
      await box.fill(q);
      await box.press("Enter");
      // Settle: card, zero, or rows — same waits as the acceptance harness.
      await Promise.race([completed, page.waitForTimeout(600_000)]);
      if (response) {
        const raw = await response.text();
        event.raw = raw.slice(0, 200_000);
        try {
          const wire = JSON.parse(raw);
          const envelope = (typeof wire.t === "number" ? fromCrossJSON(wire, { plugins: [] }) : wire) as { result?: unknown };
          event.result = envelope.result ?? envelope;
          const r = event.result as { rows?: unknown[]; stage?: string } | undefined;
          if (r && Array.isArray(r.rows) && r.rows.length === 0) {
            const force = page.getByRole("button", { name: /Search with defaults|Confirm & search/ }).first();
            if (await force.isVisible().catch(() => false)) {
              request = undefined; response = undefined; event.request = undefined; event.result = undefined;
              await force.click();
              await Promise.race([completed, page.waitForTimeout(600_000)]);
              if (response) {
                const raw2 = await response.text();
                event.raw = raw2.slice(0, 200_000);
                const wire2 = JSON.parse(raw2);
                const env2 = (typeof wire2.t === "number" ? fromCrossJSON(wire2, { plugins: [] }) : wire2) as { result?: unknown };
                event.result = env2.result ?? env2;
              }
            }
          }
        } catch (e) { event.failure = `decode: ${String(e)}`; }
      } else event.failure = "no runSpecSearch response";
    } catch (e) { event.failure = String(e); }
    page.off("request", onRequest);
    page.off("response", onResponse);
    const out = event.result as { retrievalTrace?: unknown; candidateLedger?: unknown; diagnostics?: unknown; outcome?: unknown; rows?: unknown[] } | undefined;
    console.log("PROBE:", JSON.stringify({
      q,
      stage: out && (out as { stage?: string }).stage,
      rows: out && Array.isArray(out.rows) ? out.rows.length : undefined,
      outcome: out && (out as { outcome?: { status?: string } }).outcome,
      reason: out && (out as { retrievalTrace?: { reason?: string } }).retrievalTrace?.reason,
      accounting: out && (out as { candidateLedger?: { accounting?: unknown } }).candidateLedger?.accounting,
      failure: event.failure,
    }));
    writeFileSync(`reports/probe/trace-${q.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.json`, JSON.stringify(event, null, 1));
  }
});
