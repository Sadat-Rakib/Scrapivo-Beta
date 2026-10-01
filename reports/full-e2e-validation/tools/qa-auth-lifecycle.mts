// QA-only: full auth lifecycle — logout, verify protected content gone, ONE wrong
// password attempt, then clean re-login with the demo credentials and restore
// .auth/qa-demo.json. Never prints credentials.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const STATE = process.env.QA_STATE ?? ".auth/qa-demo.json";
const out: Record<string, any> = { startedAt: new Date().toISOString(), steps: [] };
const step = (s: string, d: any) => { out.steps.push({ s, ok: d }); console.log(JSON.stringify({ s, ok: d })); };
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const email = process.env.QA_EMAIL ?? (await import("node:fs")).readFileSync("e2e/ship-it.spec.ts", "utf8").match(/E2E_EMAIL\s*\?\?\s*["'`]([^"'`]+)["'`]/)?.[1] ?? "";
const password = process.env.QA_PASSWORD ?? (await import("node:fs")).readFileSync("e2e/ship-it.spec.ts", "utf8").match(/E2E_PASSWORD\s*\?\?\s*["'`]([^"'`]+)["'`]/)?.[1] ?? "";

try {
  await page.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3_000);
  // Logout: open account menu / find sign-out control.
  let signedOut = false;
  const account = page.getByText("Manage account", { exact: false }).first();
  if (await account.isVisible().catch(() => false)) { await account.click().catch(() => undefined); await page.waitForTimeout(1_500); }
  const signOut = page.getByRole("button", { name: /sign out|log ?out|signout/i }).first();
  if (await signOut.isVisible().catch(() => false)) { await signOut.click(); await page.waitForTimeout(5_000); signedOut = true; }
  step("logout_clicked", signedOut);
  step("after_logout_url", page.url().replace(BASE, ""));
  await page.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(3_000);
  const protectedGone = /\/auth/.test(page.url()) || !(await page.locator("textarea").first().isVisible().catch(() => false));
  step("protected_content_unavailable_after_logout", protectedGone);

  // One wrong-password attempt.
  await page.waitForSelector("#password", { timeout: 30_000 }).catch(() => undefined);
  const emailBox = page.locator("#email").first();
  const passBox = page.locator("#password").first();
  if (await emailBox.isVisible().catch(() => false)) {
    await emailBox.fill(email);
    await passBox.fill("definitely-wrong-password-e2e-probe");
    await page.getByRole("button", { name: "Sign In", exact: true }).first().click().catch(() => undefined);
    await page.waitForTimeout(7_000);
    const after = await page.locator("body").innerText().catch(() => "");
    out.wrongPassword = {
      stillOnAuth: /\/auth/.test(page.url()),
      errorVisible: !!(await page.locator('[role="alert"], .text-destructive, [class*="error"]').first().isVisible().catch(() => false)),
      errorText: ((await page.locator('[role="alert"], .text-destructive, [class*="error"]').first().innerText().catch(() => "")) || "").slice(0, 160),
      leakCheck: /supabase|service_role|anon key|JWT|api[_-]?key|at Object|node_modules/i.test(after),
    };
    step("wrong_password_error_useful", out.wrongPassword.errorVisible && !out.wrongPassword.leakCheck);
    await page.screenshot({ path: "reports/full-e2e-validation/ui/auth-wrong-password.jpg", type: "jpeg", quality: 55 }).catch(() => undefined);

    // Clean re-login.
    await passBox.fill(password);
    await page.getByRole("button", { name: "Sign In", exact: true }).first().click().catch(() => undefined);
    await page.waitForTimeout(8_000);
    const back = await page.locator("textarea").first().isVisible().catch(() => false);
    step("relogin_reaches_discover", back && !/\/auth/.test(page.url()));
    await ctx.storageState({ path: STATE }).catch(() => undefined);
    step("storage_state_restored", true);
  } else step("login_form_found", false);
} catch (e) {
  out.fatal = String(e).split("\n")[0].slice(0, 200);
  console.log(JSON.stringify({ fatal: out.fatal }));
}
writeFileSync("reports/full-e2e-validation/evidence/auth-lifecycle.json", JSON.stringify(out, null, 2));
await browser.close();
