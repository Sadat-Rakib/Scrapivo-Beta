// QA-only auth E2E (demo account). Never prints credentials or tokens.
// Credentials: QA_EMAIL/QA_PASSWORD env, else the demo literals in e2e/ship-it.spec.ts.
// Saves the final signed-in state to .auth/qa-demo.json (gitignored).
//   npx tsx reports/full-e2e-validation/tools/qa-auth.mts [login-only]
import { chromium, type Page } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = "reports/full-e2e-validation";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const STATE = ".auth/qa-demo.json";
const loginOnly = process.argv[2] === "login-only";
mkdirSync(`${ROOT}/ui`, { recursive: true });
mkdirSync(`${ROOT}/evidence`, { recursive: true });
mkdirSync(".auth", { recursive: true });

const spec = readFileSync("e2e/ship-it.spec.ts", "utf8");
const literal = (name: string) => (spec.match(new RegExp(`${name}\\s*\\?\\?\\s*["'\`]([^"'\`]+)["'\`]`)) ?? [])[1] ?? "";
const email = process.env.QA_EMAIL ?? literal("E2E_EMAIL");
const password = process.env.QA_PASSWORD ?? literal("E2E_PASSWORD");
if (!email || !password) { console.log("NO_DEMO_CREDENTIALS"); process.exit(2); }
const scrub = (text: string) => text.split(email).join("<demo-email>").split(password).join("<redacted>");

const out: Record<string, unknown> = { startedAt: new Date().toISOString(), base: BASE };
const steps: Array<{ step: string; ok: boolean; detail?: string; ms?: number }> = [];
const record = (step: string, ok: boolean, detail?: string, ms?: number) => { steps.push({ step, ok, detail: detail ? scrub(detail).slice(0, 300) : undefined, ms }); console.log(JSON.stringify({ step, ok })); };
const browser = await chromium.launch({ headless: true });
const desktop = { viewport: { width: 1366, height: 900 } };
// Screenshots mask the email field and any element showing the account email.
const shot = (page: Page, name: string) => page.screenshot({ path: `${ROOT}/ui/auth-${name}.jpg`, type: "jpeg", quality: 55,
  mask: [page.locator("#email"), page.getByText(email)] }).catch(() => undefined);
const toastText = async (page: Page, waitMs: number) => {
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const text = (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ").trim();
    if (text) return text;
    await page.waitForTimeout(300);
  }
  return "";
};
const authenticatedAt = async (page: Page, path: string) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3_000);
  return !/\/auth(?:$|[/?#])/.test(new URL(page.url()).pathname + "/");
};
async function signIn(page: Page, pass: string) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator("#email").waitFor({ timeout: 60_000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(pass);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  return t0;
}

try {
  // 1. Valid demo login.
  let context = await browser.newContext(desktop);
  let page = await context.newPage();
  let t0 = await signIn(page, password);
  const reached = await page.waitForURL(/\/discover/, { timeout: 60_000 }).then(() => true).catch(() => false);
  const loginToast = reached ? "" : await toastText(page, 5_000);
  record("valid demo login reaches /discover", reached, loginToast || page.url().replace(BASE, ""), Date.now() - t0);
  if (!reached) throw new Error("DEMO_LOGIN_FAILED");
  // The URL changes before the (dev-compiled) Discover route renders: wait for the shell itself.
  const shell = await page.locator("textarea").first().waitFor({ state: "visible", timeout: 90_000 }).then(() => true).catch(() => false);
  out.loginToShellMs = Date.now() - t0;
  await page.waitForTimeout(1_500);
  await shot(page, "1-after-login");
  const nav = await Promise.all(["Home", "Projects", "Watches", "Saved", "Guides", "Help"].map(async (label) => [label, await page.getByRole("link", { name: label, exact: true }).first().isVisible().catch(() => false)] as const));
  record("authenticated shell (composer + nav)", shell && nav.every(([, v]) => v), JSON.stringify(Object.fromEntries(nav)));
  const identity = await page.locator(`button[title="${email}"], button:has-text("${email}")`).count().catch(() => 0);
  record("profile identity shows the demo account", identity > 0);
  await context.storageState({ path: STATE });
  if (loginOnly) { writeFileSync(`${ROOT}/evidence/auth-login-only.json`, JSON.stringify({ ...out, steps }, null, 2)); process.exit(0); }

  // 2. Session survives refresh and in-app navigation.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);
  record("refresh keeps the session", !/\/auth/.test(page.url()) && await page.locator("textarea").first().isVisible().catch(() => false));
  for (const path of ["/saved", "/projects", "/watches", "/profile", "/discover"]) record(`navigate ${path} while signed in`, await authenticatedAt(page, path), page.url().replace(BASE, ""));
  // 3. Second tab, same browser profile.
  const tab = await context.newPage();
  record("second tab is signed in", await authenticatedAt(tab, "/discover"));
  await tab.close();
  // 4. Session restoration in a fresh browser context from the saved state.
  const restored = await browser.newContext({ ...desktop, storageState: STATE });
  const restoredPage = await restored.newPage();
  record("fresh context restores the session", await authenticatedAt(restoredPage, "/discover"));

  // 5. Logout, then protected routes redirect to /auth.
  await page.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
  await page.locator(`button[title="${email}"], button:has-text("${email}")`).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  const loggedOut = await page.waitForURL(/\/auth/, { timeout: 30_000 }).then(() => true).catch(() => false);
  await shot(page, "2-after-logout");
  record("Sign out returns to /auth", loggedOut);
  for (const path of ["/discover", "/saved", "/profile"]) record(`signed out: ${path} redirects to /auth`, !(await authenticatedAt(page, path)), page.url().replace(BASE, ""));
  // Informational: another context's cached session after a (global) sign-out.
  await restoredPage.reload({ waitUntil: "domcontentloaded" });
  await restoredPage.waitForTimeout(4_000);
  out.otherContextAfterSignOut = /\/auth/.test(restoredPage.url()) ? "redirected to /auth" : "still shows the app (cached session)";
  await restored.close();

  // 6. One intentionally wrong password: useful error, no internals.
  t0 = await signIn(page, `E2E_QA_wrong_${Date.now()}`);
  const wrong = await toastText(page, 30_000);
  await shot(page, "3-wrong-password");
  const stayed = /\/auth/.test(page.url());
  const leaks = /AuthApiError|supabase|stack|at \w+ \(|status(?:Code)? \d{3}|\b4\d\d\b|jwt|service.?role|postgres/i.test(wrong);
  record("wrong password stays on /auth with a clear message", stayed && !!wrong && !leaks, wrong, Date.now() - t0);
  out.wrongPasswordMessage = scrub(wrong);
  out.wrongPasswordLeaksInternals = leaks;

  // 7. Log in again and keep that state for the rest of the pass.
  await context.close();
  context = await browser.newContext(desktop);
  page = await context.newPage();
  t0 = await signIn(page, password);
  const again = await page.waitForURL(/\/discover/, { timeout: 60_000 }).then(() => true).catch(() => false);
  record("log in again after logout", again, undefined, Date.now() - t0);
  await page.waitForTimeout(2_000);
  if (again) await context.storageState({ path: STATE });
} catch (error) {
  out.fatal = scrub(error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  out.steps = steps;
  out.finishedAt = new Date().toISOString();
  writeFileSync(`${ROOT}/evidence/auth.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ passed: steps.filter((s) => s.ok).length, total: steps.length, fatal: out.fatal ?? null }));
  await browser.close();
}
