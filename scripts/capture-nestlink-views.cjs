// Shared UI-only capture routine for the real server and its unmodified preview.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const visible = locator => locator.waitFor({ state: 'visible' });

async function waitForPaint(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const duration = animation.effect?.getComputedTiming().activeDuration;
    return !Number.isFinite(duration) || animation.playState === 'finished' || animation.playState === 'idle';
  }), undefined, { timeout: 5000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function captureViews({ page, target, version, fixtureDescription }) {
  const captures = [], errors = [];
  page.on('pageerror', () => errors.push('browser page error'));
  await fs.mkdir(target, { recursive: true });
  const settled = async () => {
    await visible(page.locator('#app-shell'));
    await page.waitForFunction(() => document.querySelector('#view-content')?.getAttribute('aria-busy') === 'false');
  };
  const view = async name => {
    const primary = page.locator(`.nav-item[data-view="${name}"]`);
    if (await primary.count()) await primary.click();
    else await page.locator(`.administration-links [data-view="${name}"]`).click();
    await settled();
  };
  const capture = async (file, description, fullPage = true) => {
    if (errors.length) throw new Error('Browser page errors during capture');
    if ((await page.locator('#current-version').textContent()).trim() !== version) throw new Error('Product version mismatch');
    if ((await page.locator('.product-brand').innerText()).trim() !== 'NestLink') throw new Error('Product brand mismatch');
    await page.waitForFunction(() => !document.querySelector('.toast'));
    await waitForPaint(page);
    const geometry = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      const nav = document.querySelector('.sidebar');
      return { viewport: { width: innerWidth, height: innerHeight }, scroll_position: { x: scrollX, y: scrollY },
        document_size: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        horizontal_overflow_pixels: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        theme: document.documentElement.dataset.theme, navigation_bounds: rect(nav),
        navigation_items: [...nav.querySelectorAll('[data-view]')].map(element => ({ view: element.dataset.view, ...rect(element) })) };
    });
    await page.screenshot({ path: path.join(target, file), fullPage, animations: 'disabled' });
    const bytes = await fs.readFile(path.join(target, file));
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Capture is not a PNG');
    captures.push({ file, description: `${version} ${description}; ${fixtureDescription}`, sha256: digest(bytes),
      bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), full_page: fullPage,
      paint_stabilization: 'fonts ready; two animation frames; finite CSS animations/transitions completed; two final frames; screenshot animations disabled', ...geometry });
  };
  const theme = async value => {
    if (await page.locator('html').getAttribute('data-theme') !== value) await page.locator('.product-bar [data-theme-toggle]').click();
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, value);
  };
  const closeModal = async () => {
    await page.locator('#modal').press('Escape');
    await page.locator('#modal').waitFor({ state: 'hidden' });
  };
  await settled();
  await view('devices');
  await visible(page.locator('#device-search-form'));
  await theme('light');
  await capture('devices-light.png', 'Web device management, light theme');
  await theme('dark');
  await capture('devices-dark.png', 'Web device management, dark theme');
  await theme('light');
  const details = page.locator('[data-action="device-info"]').first();
  if (await details.count()) {
    await details.click();
    await visible(page.locator('#modal .device-info'));
    await capture('device-details.png', 'Web device details');
    await closeModal();
  }
  await view('remote');
  await visible(page.locator('#remote-connect-form'));
  await capture('remote-entry.png', 'Web remote assistance entry; no session or media assertion');
  await view('account');
  await visible(page.locator('.account-panel').first());
  await capture('account-settings.png', 'Web account and settings');
  if (await page.locator('.administration-panel').count()) {
    await view('dashboard');
    await capture('admin-console.png', 'Web system overview reached through account and settings');
    await view('account');
    await view('admin-devices');
    await visible(page.locator('#device-search-form'));
    await capture('admin-devices.png', 'Web administrative device management');
    if (!captures.some(item => item.file === 'device-details.png') && await page.locator('[data-action="device-info"]').count()) {
      await page.locator('[data-action="device-info"]').first().click();
      await visible(page.locator('#modal .device-info'));
      await capture('device-details.png', 'Web administrative device details');
      await closeModal();
    }
    await view('account');
    await view('users');
    await capture('admin-users.png', 'Web user management');
  } else await capture('admin-console.png', 'Web account settings; no administrator capability');
  await view('connections');
  await capture('tunnel-list.png', 'Web tunnel management');
  await page.locator('[data-action="create-connection"]').click();
  await visible(page.locator('#modal [data-step="0"]'));
  if (!(await page.locator('#modal-device_id option').count())) throw new Error('An actual example device is required');
  await page.locator('#modal-client-preset').selectOption('home-assistant');
  await page.locator('#modal-name').fill('Home Assistant 示例');
  await capture('tunnel-wizard.png', 'Web tunnel wizard, device and template step; nothing published');
  await page.locator('#modal-footer button[type="submit"]').click();
  await visible(page.locator('#modal [data-step="1"]'));
  if (await page.locator('#modal-local_port').inputValue() !== '8123') throw new Error('Service template port mismatch');
  await capture('tunnel-target.png', 'Web tunnel wizard, local target step; nothing published');
  await page.locator('#modal-footer button[type="submit"]').click();
  await visible(page.locator('#modal [data-step="2"]'));
  await capture('tunnel-access.png', 'Web tunnel wizard, access step; no secret entered and nothing published');
  await closeModal();
  // Actual viewport screenshots preserve the fixed bottom navigation and clipped
  // viewport boundary. Full-page shots alone cannot establish that behavior.
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const scheme of ['light', 'dark']) {
      await theme(scheme);
      for (const name of ['devices', 'remote', 'connections']) {
        await view(name);
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        await capture(`web-${name}-${viewport.width}-${scheme}-top.png`, `Web ${name}, ${viewport.width}px ${scheme} viewport at top`, false);
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' }));
        await capture(`web-${name}-${viewport.width}-${scheme}-bottom.png`, `Web ${name}, ${viewport.width}px ${scheme} viewport after actual scroll to bottom`, false);
      }
    }
  }
  if (errors.length) throw new Error('Browser page errors during capture');
  return captures;
}
module.exports = { captureViews, digest, waitForPaint };
