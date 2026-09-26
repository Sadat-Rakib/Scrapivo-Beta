import { expect, test } from "@playwright/test";

test(" probe console errors", async ({ page }) => {
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 300)));
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill("e2e.scrapivo.test.001@gmail.com");
  await page.getByLabel(/password/i).fill("E2eTest!2026-xyz");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForTimeout(8000);
  console.log("URL:", page.url());
  console.log("ERRORS:", JSON.stringify(errs.slice(0, 10), null, 1));
  await expect(true).toBe(true);
});
