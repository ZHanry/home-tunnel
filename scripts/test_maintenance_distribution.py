"""A pending maintenance release must retain the actual published stable downloads."""
import copy
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import distribution

ROOT = Path(__file__).resolve().parents[1]


class MaintenanceDistributionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'docs/release').mkdir(parents=True)
        shutil.copytree(ROOT / 'contracts', self.root / 'contracts')
        for version in ('10.1.0', '13.0.0', '14.0.0'):
            shutil.copyfile(ROOT / f'docs/release/stable-{version}.json', self.root / f'docs/release/stable-{version}.json')
        self.stable = json.loads((ROOT / 'docs/release/stable-14.0.0.json').read_text(encoding='utf8'))
        self.candidate = {
            'version': '14.0.1', 'tag': 'v14.0.1', 'prerelease': False,
            'stage': 'development', 'promotion_status': 'not_promoted',
            'downloads_published': False, 'acceptance_status': 'pending', 'tested_combination': None,
            'remote_policy': 'require_direct', 'relay_enabled': False, 'frp': '0.70.1', 'agent_version': '14.0.1',
            'not_verified': ['physical-android-device', 'carrier-network-nat', 'long-duration-media'],
            'signing': copy.deepcopy(self.stable['signing']),
            'contract': {'ref': 'api-v2.0.0', 'frozen': True, 'revision': '2242354fc10c6681ec0ccf33e91ab96611e60791', 'openapi_sha256': hashlib.sha256((self.root / 'contracts/openapi.v2.json').read_bytes()).hexdigest()},
            'components': {name: {'repository': item['repository'], 'version': '14.0.1', 'tag': 'v14.0.1', 'prerelease': False, 'source_sha': None, 'published': False, 'artifacts': []} for name, item in self.stable['components'].items()},
        }

    def audit(self, stable=None):
        return distribution.validate_nestlink(self.candidate, self.stable if stable is None else stable, root=self.root)

    def test_pending_maintenance_retains_published_14_downloads(self):
        original_downloads = copy.deepcopy(self.stable['components'])
        self.assertEqual(self.audit(), [])
        self.assertEqual(self.stable['components'], original_downloads)

    def test_pending_maintenance_cannot_revert_downloads_to_13(self):
        older = json.loads((self.root / 'docs/release/stable-13.0.0.json').read_text(encoding='utf8'))
        self.assertTrue(any('Stable channel changed' in error for error in self.audit(older)))

    def test_corrupted_published_snapshot_is_rejected(self):
        with (self.root / 'docs/release/stable-14.0.0.json').open('ab') as output:
            output.write(b' ')
        self.assertTrue(any('snapshot bytes' in error for error in self.audit()))

    def test_pending_source_cannot_claim_new_artifact_acceptance(self):
        self.candidate['acceptance_status'] = 'passed_reproducible'
        self.assertTrue(any('Unverified target' in error for error in self.audit()))

    def test_mixed_component_versions_are_rejected(self):
        self.candidate['components']['android']['version'] = '14.0.0'
        self.assertTrue(any('identity drifted: android' in error for error in self.audit()))

    def test_new_release_requires_its_actual_previous_snapshot(self):
        self.candidate['version'] = '14.0.2'
        self.assertTrue(any('No immutable previous stable snapshot' in error for error in self.audit()))


if __name__ == '__main__':
    unittest.main()
