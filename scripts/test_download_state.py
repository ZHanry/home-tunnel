import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DownloadStateTests(unittest.TestCase):
    def test_disconnect_reconnect_ignores_stale_manifest_results(self):
        script = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const state = require('./docs/site/assets/download-state.js');
const status = { dataset: {}, textContent: '' };
const listeners = {};
const requests = [];
const navigator = { onLine: true };
const timers = new Set();
const context = {
  URLSearchParams, AbortController, location: { search: '' }, navigator,
  HomeTunnelDownloadState: state,
  window: { addEventListener(name, callback) { listeners[name] = callback; } },
  document: {
    querySelector() { return null; },
    getElementById(id) { return id === 'download-status' ? status : null; },
    documentElement: { lang: 'en' },
    body: { getAttribute(name) { return name === 'data-stable-version' ? '9.0.0' : ''; } },
  },
  // A response whose parsing already started can outlive AbortController. Keep
  // these controllable promises alive to exercise the generation check itself.
  fetch(url) { return new Promise((resolve, reject) => requests.push({ url, resolve, reject })); },
  setTimeout(callback) { timers.add(callback); return callback; },
  clearTimeout(callback) { timers.delete(callback); },
};
const stable = { version: '9.0.0', stage: 'stable' };
const candidate = { version: '10.0.0', promotion_status: 'not_promoted', downloads_published: false, acceptance_status: 'pending' };
const finish = (offset) => [stable, candidate].forEach((value, index) => requests[offset + index].resolve({ ok: true, json: async () => value }));
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  vm.runInNewContext(fs.readFileSync('./docs/site/assets/site.js', 'utf8'), context);
  assert.equal(status.dataset.tone, 'loading');
  navigator.onLine = false; listeners.offline();
  assert.equal(status.dataset.tone, 'offline');
  navigator.onLine = true; listeners.online();
  assert.equal(status.dataset.tone, 'loading');
  finish(0); await flush();
  assert.equal(status.dataset.tone, 'loading', 'old reply must not override the new request');
  finish(2); await flush();
  assert.equal(status.dataset.tone, 'ready');
  assert.match(status.textContent, /Stable downloads are 9.0.0/);
  listeners.online(); requests[4].reject(new Error('network failure')); await flush();
  assert.equal(status.dataset.tone, 'error');
  assert.equal(timers.size, 0);
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
        completed = subprocess.run([os.environ.get("HOME_TUNNEL_NODE", "node"), "--input-type=commonjs", "-e", script],
                                   cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)

    def test_manifest_states(self):
        node = os.environ.get("HOME_TUNNEL_NODE", "node")
        script = r"""
const state = require('./docs/site/assets/download-state.js');
const stable = { version: '9.0.0', stage: 'stable' };
const candidate = { version: '10.0.0', promotion_status: 'not_promoted', downloads_published: false, acceptance_status: 'pending' };
const ready = state.view({ transport: 'ok', stable, candidate, fallbackStable: '9.0.0' });
if (ready.tone !== 'ready') process.exit(1);
if (!ready.zh.includes('验收尚未完成') || !ready.en.includes('acceptance is pending')) process.exit(2);
const offline = state.view({ transport: 'offline', fallbackStable: '9.0.0' });
if (offline.tone !== 'offline' || !offline.zh.includes('9.0.0')) process.exit(3);
const broken = state.view({ transport: 'error', fallbackStable: '9.0.0' });
if (broken.tone !== 'error' || !broken.en.includes('stable 9.0.0')) process.exit(4);
const loading = state.view({ transport: 'loading', fallbackStable: '9.0.0' });
if (loading.tone !== 'loading' || !loading.zh.includes('正在读取') || !loading.en.includes('stable version, 9.0.0')) process.exit(7);
for (const transport of ['loading', 'offline', 'error']) {
  const released = state.view({ transport, fallbackStable: '10.0.0' });
  if (released.en.includes('acceptance is pending') || released.en.includes('no stable packages') || !released.en.includes('10.0.0')) process.exit(8);
}
const conflict = state.view({
  transport: 'ok',
  stable,
  candidate: Object.assign({}, candidate, { downloads_published: true }),
  fallbackStable: '9.0.0'
});
if (conflict.tone !== 'error') process.exit(5);
const promoted = state.view({
  transport: 'ok',
  stable: { version: '10.0.0', stage: 'stable' },
  candidate: { version: '10.0.0', promotion_status: 'promoted', downloads_published: true, acceptance_status: 'accepted' },
  fallbackStable: '9.0.0'
});
if (promoted.tone !== 'ready' || !promoted.en.includes('10.0.0')) process.exit(6);
"""
        completed = subprocess.run([node, "--input-type=commonjs", "-e", script], cwd=ROOT, capture_output=True, text=True)
        if completed.returncode != 0:
            self.fail(completed.stderr or completed.stdout or f"node exit {completed.returncode}")


if __name__ == "__main__":
    unittest.main()
