// Capture an actual production Web workbench with isolated example data.
// The calling environment supplies credentials; the manifest never stores them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'docs/site/assets/13.0.0');
const sha = process.env.NESTLINK_CAPTURE_SOURCE_SHA;
if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Exact server source SHA required');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
(async () => {
  fs.mkdirSync(target, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(process.env.NESTLINK_CAPTURE_ORIGIN + '/admin');
    await page.locator('#login-username').fill(process.env.NESTLINK_CAPTURE_USERNAME);
    await page.locator('#login-password').fill(process.env.NESTLINK_CAPTURE_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();
    await page.locator('#app-shell').waitFor({ state: 'visible' });
    await page.locator('.nav-item[data-view="remote"]').click();
    await page.locator('.remote-device').first().waitFor();
    if (!(await page.locator('#version-button').innerText()).includes('13.0.0')) throw new Error('Product version mismatch');
    if (!(await page.locator('.sidebar').innerText()).includes('nestlink')) throw new Error('Brand mismatch');
    if (!(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth === 'none'))) throw new Error('Visible scrollbar');
    const file = 'web-workbench.png';
    await page.screenshot({ path: path.join(target, file) });
    const manifest = { schema_version: 1, product_version: '13.0.0', repository: 'ZHanry/home-tunnel-server',
      source_sha: sha, captured_at: new Date().toISOString(), fixture_data: true, capture_kind: 'web-ui', installed_application: true,
      method: 'Playwright Chromium screenshot of the production Web application with isolated example devices',
      scope: 'UI pixels only; no remote session or media assertion',
      captures: [{ file, sha256: digest(fs.readFileSync(path.join(target, file))), width: 1280, height: 860 }] };
    fs.writeFileSync(path.join(target, 'web-capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('Captured real nestlink workbench and source/digest manifest');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
