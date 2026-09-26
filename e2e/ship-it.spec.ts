import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fromCrossJSON } from 'seroval';

test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8082' });
const queries = process.env.V1_QUERY ? [process.env.V1_QUERY] : [
  'Find SaaS founders globally who may need help with AI automation.',
  'Find HVAC companies in the Greater Toronto Area that could need a better website or automation.',
  'Find copywriters in New York who talk about AI content or AI slop.',
  'Find remote AI automation jobs in Canada.',
];

for (const query of queries) test(`real pipeline: ${query}`, async ({ page }) => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  console.log(JSON.stringify({ query, startedAt, stage: 'start' }));
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
  const directory = `reports/ship-it/${slug}`;
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  const calls: { url: string; status?: number; failure?: string; body?: string }[] = [];
  let stage = 'open auth';
  let result: any;
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => calls.push({ url: request.url().split('?')[0], failure: request.failure()?.errorText }));
  page.on('response', async response => {
    if (!response.url().includes('/_serverFn/')) return;
    const body = await response.text().catch(() => '');
    calls.push({ url: response.url(), status: response.status(), body });
    if (body.includes('search_run_id') && body.includes('rows')) {
      const decoded = (fromCrossJSON(JSON.parse(body), { refs: new Map() }) as any).result;
      if (decoded && !Array.isArray(decoded) && typeof decoded.search_run_id === 'string' && Array.isArray(decoded.rows)) {
        result = decoded;
        await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
      }
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('scrapivo:onboarding-skipped', '1');
    localStorage.setItem('scrapivo:guided-tour-seen', '1');
  });
  try {
    await page.goto('/auth', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    stage = 'sign in';
    console.log(JSON.stringify({ query, stage }));
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? 'e2e.scrapivo.test.001@gmail.com');
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? 'E2eTest!2026-xyz');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL(/discover|home|\/$/, { timeout: 45_000, waitUntil: 'domcontentloaded' });
    stage = 'open discover';
    await page.goto('/discover', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const skip = page.getByText('Skip for now', { exact: true }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    const composer = page.locator('textarea').last();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    stage = 'search';
    console.log(JSON.stringify({ query, stage }));
    await composer.fill(query);
    await composer.press('Enter');
    await expect.poll(() => Boolean(result), { timeout: 210_000, intervals: [1000] }).toBe(true);
    stage = 'result assertions';
    expect(result.outcome).toBe('QUALIFIED_RESULTS');
    expect(result.rows.length).toBeGreaterThan(0);
    await expect(page.locator('body')).toContainText(`${result.rows.length} results`, { timeout: 15_000 });
    await expect(page.getByText(result.rows[0].title, { exact: true }).first()).toBeVisible();
    stage = 'complete';
  } finally {
    await page.screenshot({ path: `${directory}/page.png`, fullPage: true }).catch(() => {});
    await writeFile(`${directory}/rendered.txt`, await page.locator('body').innerText().catch(() => ''));
    const elapsedMs = Date.now() - startedMs;
    await writeFile(`${directory}/runtime.json`, JSON.stringify({ query, startedAt, elapsedMs, stage, errors, calls }, null, 2));
    console.log(JSON.stringify({ query, startedAt, elapsedMs, stage, outcome: result?.outcome, returned: result?.rows?.length, errors }));
  }
});
