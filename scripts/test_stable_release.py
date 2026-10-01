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
            package = {'filename': name + '.zip', 'url': base + 'download/v8.0.0/' + name + '.zip', 'sha256': 'b' * 64, 'size_bytes': 3}
            self.value['components'][name] = {'repository': repository, 'version': '8.0.0', 'tag': 'v8.0.0',
                'prerelease': False, 'release_url': base + 'tag/v8.0.0', 'release_revision': 'c' * 40, 'downloads': [package]}
            self.releases[repository] = {'prerelease': False, 'draft': False, 'html_url': base + 'tag/v8.0.0',
                'assets': [{'name': name + '.zip', 'browser_download_url': package['url'], 'size': 3}]}

    def run_verify(self, value=None, tag=None, digest=None, **kwargs):
        with patch.object(module.checks, 'tag_revision', side_effect=tag or (lambda repo, ref: 'a' * 40 if ref.startswith('api-') else 'c' * 40)), \
             patch.object(module.checks, 'download_hash', side_effect=digest or (lambda *args: 'b' * 64)), \
             patch.object(module.checks, 'github', side_effect=lambda path: copy.deepcopy(self.releases['/'.join(path.split('/')[1:3])])):
            return module.verify(value or self.value, **kwargs)

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

    def test_manifest_asset_size_is_verified(self):
        self.value['components']['client']['downloads'][0]['size_bytes'] = 4
        with self.assertRaises(ValueError): self.run_verify()

    def mixed_release(self):
        self.value['version'] = '10.1.0'
        for name, component in self.value['components'].items():
            version = '10.0.0' if name == 'android' else '10.1.0'
            component['version'] = version
            component['tag'] = 'v' + version
            component['release_url'] = component['release_url'].replace('8.0.0', version)
            component['downloads'][0]['url'] = component['downloads'][0]['url'].replace('8.0.0', version)
            release = self.releases[component['repository']]
            release['html_url'] = component['release_url']
            release['assets'][0]['browser_download_url'] = component['downloads'][0]['url']
            if name != 'hub':
                component['downloads'] = [{'filename': filename,
                    'url': f'https://github.com/{component["repository"]}/releases/download/v{version}/{filename}',
                    'sha256':'b'*64, 'size_bytes':3} for filename in sorted(module.V101_ARTIFACT_NAMES[name])]
                release['assets'] = [{'name':item['filename'], 'browser_download_url':item['url'], 'size':3}
                                     for item in component['downloads']]

    def test_components_only_scope_does_not_query_or_claim_hub(self):
        self.mixed_release()
        del self.releases['ZHanry/home-tunnel']
        result = self.run_verify(components_only=True)
        self.assertEqual(set(result['components']), {'server', 'client', 'android'})
        self.assertIn('hub publication not verified', result['scope'])
        self.assertEqual(result['components']['android']['tag'], 'v10.0.0')

    def test_mixed_release_does_not_allow_android_relabel(self):
        self.mixed_release()
        self.value['components']['android'].update(version='10.1.0', tag='v10.1.0')
        with self.assertRaises(ValueError): self.run_verify(components_only=True)

    def test_full_10_1_requires_hub_document_byte_evidence(self):
        self.mixed_release()
        with self.assertRaisesRegex(ValueError, 'sealed hub document'):
            self.run_verify(expected_hub_revision='c'*40)

    def test_full_10_1_binds_final_hub_tag_separately_from_docs_source(self):
        self.mixed_release()
        artifacts = [{'filename':name, 'url':f'https://github.com/ZHanry/home-tunnel/releases/download/v10.1.0/{name}',
                      'sha256':'b'*64, 'size_bytes':3} for name in ('DOWNLOADS.md','RELEASE_NOTES.md')]
        self.releases['ZHanry/home-tunnel']['assets'] = [
            {'name':item['filename'], 'browser_download_url':item['url'], 'size':3} for item in artifacts]
        with self.assertRaisesRegex(ValueError, 'reviewed final hub revision'):
            self.run_verify(hub_artifacts=artifacts)
        result = self.run_verify(hub_artifacts=artifacts, expected_hub_revision='c'*40)
        self.assertEqual(result['components']['hub']['revision'], 'c'*40)
        with self.assertRaisesRegex(ValueError, 'Product tag revision differs: hub'):
            self.run_verify(hub_artifacts=artifacts, expected_hub_revision='d'*40)

    def test_candidate_version_is_rejected_before_network(self):
        self.value['version'] = '8.0.0-rc.1'
        with self.assertRaises(ValueError): self.run_verify()


if __name__ == '__main__': unittest.main()
