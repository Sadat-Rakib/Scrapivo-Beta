import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fromCrossJSON } from "seroval";

test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8082" });

const queries = process.env.V1_QUERY ? [process.env.V1_QUERY] : [
  "saas founders",
  "plumbers in Austin with no website",
  "find me local businesses who require websites in Canada",
  "investors backing pre-seed AI companies in Canada",
  "software engineering jobs in Edmonton",
];

for (const query of queries) test(`observe real query: ${query}`, async ({ page }) => {
  test.setTimeout(300_000);
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 90);
  const directory = `reports/v1-runtime-fix/${slug}`;
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  const requests: { url: string; status?: number; failure?: string }[] = [];
  const responses: { url: string; status: number; body: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/_serverFn/")) requests.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/_serverFn/")) return;
    requests.push({ url: response.url(), status: response.status() });
    const body = await response.text().catch(() => "");
    if (body.includes("search_run_id") && body.includes("rows")) {
      responses.push({ url: response.url(), status: response.status(), body });
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("scrapivo:onboarding-skipped", "1");
    localStorage.setItem("scrapivo:guided-tour-seen", "1");
  });
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "e2e.scrapivo.test.001@gmail.com");
  await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "E2eTest!2026-xyz");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/discover|home|\/$/, { timeout: 45_000 });
  await page.goto("/discover");
  const skip = page.getByText("Skip for now", { exact: true }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  const composer = page.locator("textarea").last();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(query);
  await composer.press("Enter");
  let responseObserved = false;
  let result: any = null;
  try {
    await expect.poll(() => responses.length, { timeout: 210_000, intervals: [1000] }).toBeGreaterThan(0);
    responseObserved = true;
    result = (fromCrossJSON(JSON.parse(responses.at(-1)!.body), { refs: new Map() }) as any).result;
    await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
  } finally {
    await page.screenshot({ path: `${directory}/page.png`, fullPage: true });
    const rendered = await page.locator("body").innerText();
    await writeFile(`${directory}/rendered.txt`, rendered);
    await writeFile(`${directory}/responses.json`, JSON.stringify({ query, responseObserved, errors, requests, responses }, null, 2));
    console.log(JSON.stringify({ query, responseObserved, errors, capturedResponses: responses.length, outcome: result?.outcome, returned: result?.rows?.length, rendered: rendered.split("Chat History")[0].slice(0, 2500) }));
  }

  expect(result?.outcome, `Expected ${query} to return qualified results`).toBe("QUALIFIED_RESULTS");
  expect(result?.rows?.length ?? 0, `Expected ${query} to return at least one row`).toBeGreaterThan(0);
  await expect(page.getByText(/^Results for/).first()).toContainText(`${result.rows.length} results`, { timeout: 15_000 });
});
