import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stable_checks', Path(__file__).with_name('verify-stable-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StableReleaseTests(unittest.TestCase):
    def setUp(self):
        self.value = {'version': '8.0.0', 'stage': 'stable', 'contract_ref': 'api-v1.2.0',
                      'contract_revision': 'a' * 40, 'contract_sha256': 'b' * 64, 'components': {}}
        self.releases = {}
        for name, repository in module.checks.REPOSITORIES.items():
            base = f'https://github.com/{repository}/releases/'
            package = {'filename': name + '.zip', 'url': base + 'download/v8.0.0/' + name + '.zip', 'sha256': 'b' * 64}
            self.value['components'][name] = {'repository': repository, 'version': '8.0.0', 'tag': 'v8.0.0',
                'prerelease': False, 'release_url': base + 'tag/v8.0.0', 'release_revision': 'c' * 40, 'downloads': [package]}
            self.releases[repository] = {'prerelease': False, 'draft': False, 'html_url': base + 'tag/v8.0.0',
                'assets': [{'name': name + '.zip', 'browser_download_url': package['url'], 'size': 3}]}

    def run_verify(self, value=None, tag=None, digest=None):
        with patch.object(module.checks, 'tag_revision', side_effect=tag or (lambda repo, ref: 'a' * 40 if ref.startswith('api-') else 'c' * 40)), \
             patch.object(module.checks, 'download_hash', side_effect=digest or (lambda *args: 'b' * 64)), \
             patch.object(module.checks, 'github', side_effect=lambda path: copy.deepcopy(self.releases['/'.join(path.split('/')[1:3])])):
            module.verify(value or self.value)

    def test_contract_can_be_frozen_before_product_revision(self):
        self.run_verify()

    def test_candidate_or_draft_cannot_be_called_stable(self):
        for field in ('prerelease', 'draft'):
            with self.subTest(field=field):
                self.releases['ZHanry/home-tunnel-client'][field] = True
                with self.assertRaises(ValueError): self.run_verify()
                self.releases['ZHanry/home-tunnel-client'][field] = False

    def test_moved_product_tag_is_rejected(self):
        with self.assertRaises(ValueError):
            self.run_verify(tag=lambda repo, ref: 'a' * 40 if ref.startswith('api-') else 'd' * 40)

    def test_changed_download_is_rejected(self):
        with self.assertRaises(ValueError):
            self.run_verify(digest=lambda url, *args: 'b' * 64 if 'raw.githubusercontent.com' in url else 'd' * 64)

    def test_missing_asset_is_rejected(self):
        self.releases['ZHanry/home-tunnel-android']['assets'] = []
        with self.assertRaises(ValueError): self.run_verify()

    def test_candidate_version_is_rejected_before_network(self):
        self.value['version'] = '8.0.0-rc.1'
        with self.assertRaises(ValueError): self.run_verify()


if __name__ == '__main__': unittest.main()
