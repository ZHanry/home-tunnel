import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DownloadStateTests(unittest.TestCase):
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
if (broken.tone !== 'error' || !broken.en.includes('development branch')) process.exit(4);
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
