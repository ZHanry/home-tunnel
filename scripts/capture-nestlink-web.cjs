// Capture the actual isolated production application. Never print account values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { captureViews, digest } = require('./capture-nestlink-views.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const version = process.env.NESTLINK_CAPTURE_VERSION || fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const sha = process.env.NESTLINK_CAPTURE_SOURCE_SHA;
  const target = process.env.NESTLINK_CAPTURE_OUTPUT;
  const server = process.env.NESTLINK_CAPTURE_SERVER;
  const credentialFile = process.env.NESTLINK_CAPTURE_CREDENTIALS_FILE;
  if (!/^[1-9][0-9]*\.[0-9]+\.[0-9]+$/.test(version) || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Exact version and source required');
  if (!target || !server || !credentialFile) throw new Error('Explicit staging output, server checkout and private fixture account file required');
  const output = path.resolve(target);
  const site = path.resolve(root, 'docs/site');
  if (output === site || output.startsWith(site + path.sep)) throw new Error('Use staging output outside current site assets');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Use an empty original capture output directory');
  const origin = new URL(process.env.NESTLINK_CAPTURE_ORIGIN);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Clean fixture origin required');
  const octets = origin.hostname.split('.').map(Number);
  const ipv4 = octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255);
  const privateHost = origin.hostname === 'localhost' || (ipv4 && (octets[0] === 127 || octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)));
  if (!privateHost || process.env.NESTLINK_CAPTURE_ISOLATED_FIXTURE !== 'true') throw new Error('Explicit isolated private fixture required');
  const git = (...args) => execFileSync('git', ['-C', server, ...args], { encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== sha || git('status', '--porcelain', '--', 'control-center/public')) throw new Error('Exact clean server UI checkout required');
  const center = path.join(server, 'control-center');
  if (JSON.parse(fs.readFileSync(path.join(center, 'package.json'), 'utf8')).version !== version) throw new Error('Source version mismatch');
  const requireServer = createRequire(path.resolve(center, 'package.json'));
  const { chromium } = process.env.PLAYWRIGHT_PACKAGE ? require(process.env.PLAYWRIGHT_PACKAGE) : requireServer('@playwright/test');
  const privateAccounts = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  const account = privateAccounts.admin || privateAccounts.accounts?.admin || privateAccounts.accounts?.find?.(item => item.role === 'admin');
  if (!account || typeof account.username !== 'string' || typeof account.password !== 'string') throw new Error('Private fixture administrator account required');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce', ignoreHTTPSErrors: true });
    const verifiedAssets = [];
    // Git blob bytes are independent of Windows checkout line-ending conversion.
    const files = git('ls-files', 'control-center/public').split('\n').filter(file => /\.(js|css|svg|html)$/.test(file));
    for (const file of files) {
      const relative = file.substring('control-center/public/'.length);
      const route = relative === 'index.html' ? '/admin' : '/' + relative;
      const response = await context.request.get(new URL(route, origin).href);
      const bytes = await response.body();
      const expected = execFileSync('git', ['-C', server, 'show', `${sha}:${file}`]);
      if (!response.ok() || digest(bytes) !== digest(expected)) throw new Error('Served static UI bytes differ from committed selected source');
      verifiedAssets.push({ path: relative, sha256: digest(bytes), size_bytes: bytes.length });
    }
    const page = await context.newPage();
    await page.goto(new URL('/admin', origin).href);
    await page.locator('#login-username').fill(account.username);
    await page.locator('#login-password').fill(account.password);
    await page.locator('#login-form button[type="submit"]').click();
    const captures = await captureViews({ page, target: output, version, fixtureDescription: 'isolated installed server with disposable example accounts and devices' });
    const manifest = { schema_version: 1, product_version: version, repository: 'ZHanry/home-tunnel-server',
      source_repository: 'https://github.com/ZHanry/home-tunnel-server', source_sha: sha, source_ref: sha,
      captured_at: new Date().toISOString(), browser: await browser.version(), initial_viewport: [1440, 960],
      viewports: [[1440, 960], [390, 844], [320, 720]], viewport_and_full_page_recorded_per_capture: true,
      locale: 'zh-CN', fixture_data: true, synthetic_data: false, capture_kind: 'web-ui', installed_application: true,
      actual_product_ui: true, ui_source_modified: false, static_ui_source_verified: true, verified_static_assets: verifiedAssets,
      remote_session_verified: false, capture_status: 'captured-awaiting-visual-review',
      capture_script_sha256: digest(fs.readFileSync(__filename)), capture_views_sha256: digest(fs.readFileSync(path.join(__dirname, 'capture-nestlink-views.cjs'))),
      method: 'Playwright Chromium screenshots of installed production Web UI; verified against exact Git blob bytes',
      scope: 'UI pixels only; no remote-session, media, physical-device or network-coverage assertion', captures };
    fs.writeFileSync(path.join(output, 'web-capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Captured ${captures.length} original Web UI screenshots and a source/digest manifest. Visual review required.`);
  } finally { await browser.close(); }
}
main().catch(() => { console.error('Web capture failed; inspect selected source, fixture readiness and selectors. Private account values and browser call logs are suppressed.'); process.exitCode = 1; });
