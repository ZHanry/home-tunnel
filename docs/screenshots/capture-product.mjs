/** Capture the current Web UI with its unchanged first-party preview data. */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import shared from '../../scripts/capture-nestlink-views.cjs';

const { captureViews, digest } = shared;
const candidate = JSON.parse(await readFile(new URL('../../distribution.json', import.meta.url), 'utf8')).channels.candidate;
const sourceSha = process.env.CAPTURE_SOURCE_SHA || candidate.components.server.source_sha;
const productVersion = process.env.CAPTURE_PRODUCT_VERSION || candidate.version;
if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('An exact selected server source is required');
const server = resolve(process.argv[2] || '../home-tunnel-server');
const out = resolve(process.argv[3] || 'product-captures');
const port = Number(process.env.UI_PREVIEW_PORT || 4175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const git = (...args) => execFileSync('git', ['-C', server, ...args], { encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== sourceSha) throw new Error('Use the selected exact server source');
if (git('status', '--porcelain', '--', 'control-center/public', 'control-center/scripts/ui-preview.mjs'))
  throw new Error('The UI and preview fixture must be unmodified');
const center = join(server, 'control-center');
if (JSON.parse(await readFile(join(center, 'package.json'), 'utf8')).version !== productVersion)
  throw new Error('Selected source has a different product version');
const require = createRequire(join(center, 'package.json'));
const { chromium } = require('@playwright/test');
const base = `http://127.0.0.1:${port}`;
let logs = '';
const preview = spawn(process.execPath, ['scripts/ui-preview.mjs'], {
  cwd: center, env: { ...process.env, UI_PREVIEW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
preview.stdout.on('data', chunk => { logs += chunk; });
preview.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  await new Promise((accept, reject) => {
    const stop = (error) => { clearTimeout(deadline); clearInterval(poll); error ? reject(error) : accept(); };
    const deadline = setTimeout(() => stop(new Error('Preview failed to start')), 10000);
    const poll = setInterval(() => {
      if (logs.includes(`NestLink UI preview: ${base}`)) stop();
      else if (preview.exitCode !== null) stop(new Error('Preview exited before becoming ready'));
    }, 100);
    preview.once('error', () => stop(new Error('Preview could not be started')));
  });
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${base}/admin`);
  if (await page.locator('#login-username').isVisible()) {
    await page.locator('#login-username').fill('admin');
    await page.locator('#login-password').fill('preview-fixture');
    await page.locator('#login-form button[type="submit"]').click();
  }
  const captures = await captureViews({ page, target: out, version: productVersion,
    fixtureDescription: 'unchanged first-party local preview example data; no installed application or session assertion' });
  await writeFile(join(out, 'manifest.json'), JSON.stringify({
    schema_version: 1, product_version: productVersion, source_repository: 'https://github.com/ZHanry/home-tunnel-server',
    source_sha: sourceSha, source_ref: sourceSha,
    fixture_sha256: digest(execFileSync('git', ['-C', server, 'show', `${sourceSha}:control-center/scripts/ui-preview.mjs`])),
    lockfile_sha256: digest(execFileSync('git', ['-C', server, 'show', `${sourceSha}:control-center/pnpm-lock.yaml`])),
    capture_script_sha256: digest(await readFile(fileURLToPath(import.meta.url))),
    capture_views_sha256: digest(await readFile(new URL('../../scripts/capture-nestlink-views.cjs', import.meta.url))),
    captured_at: new Date().toISOString(), browser: await browser.version(), initial_viewport: [1440, 960],
    viewports: [[1440, 960], [390, 844], [320, 720]], viewport_and_full_page_recorded_per_capture: true,
    locale: 'zh-CN', fixture: 'Unmodified control-center/scripts/ui-preview.mjs; no API interception or UI rewriting',
    actual_product_ui: true, capture_kind: 'web-ui', fixture_data: true, installed_application: false, synthetic_data: true,
    ui_source_modified: false, remote_session_verified: false, windows_capture: false, capture_status: 'captured-awaiting-visual-review',
    ci: process.env.GITHUB_ACTIONS === 'true' ? { repository: process.env.GITHUB_REPOSITORY, run_id: process.env.GITHUB_RUN_ID,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT, workflow_sha: process.env.GITHUB_SHA } : null, captures,
  }, null, 2) + '\n');
  console.log(`Captured ${captures.length} actual Web UI screenshots in ${out}. Inspect originals before publication.`);
} finally {
  try { await browser?.close(); } finally { preview.kill('SIGTERM'); }
}
