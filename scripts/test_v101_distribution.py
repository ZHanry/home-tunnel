import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import distribution
import v10_evidence

ROOT = Path(__file__).resolve().parents[1]


def draft():
    record = json.loads((ROOT / 'docs/release/v10.1-evidence.json').read_text())
    stable = json.loads((ROOT / 'docs/release/stable-10.0.0.json').read_text())
    version = '10.1.0'
    stable.update(version=version, contract_ref=record['contract']['ref'],
                  contract_revision=record['contract']['revision'], contract_sha256=record['contract']['sha256'],
                  tested_combination={'server':version, 'client':version, 'android':'10.0.0', 'agent':version})
    for name, component in stable['components'].items():
        component_version = record['components'][name]['version']
        component.update(version=component_version, tag='v'+component_version,
                         release_url=f"https://github.com/{component['repository']}/releases/tag/v{component_version}")
        if name != 'hub':
            component.update(release_revision=record['sources'][name]['sha'],
                             downloads=copy.deepcopy(record['components'][name]['artifacts']))
    candidate = {'version': version, 'stage':'stable', 'promotion_status':'promoted',
                 'acceptance_status':record['status'], 'downloads_published':True,
                 'tag':'v'+version, 'prerelease':False, 'frp':'0.70.1',
                 'waived':sorted(name for name,_ in v10_evidence.waived_items(record)),
                 'components':{name:{'repository':record['sources'][name]['repository'], **copy.deepcopy(value)}
                               for name,value in record['components'].items()}}
    return {'schema_version':1, 'product':'Home Tunnel', 'source_of_truth':'distribution.json',
            'development_line':version, 'channels':{'stable':stable,'candidate':candidate}}, record


class MixedDistributionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'docs/release').mkdir(parents=True)
        (self.root / 'VERSION').write_text('10.1.0\n')
        for filename in ('stable-9.0.0.json', 'stable-10.0.0.json'):
            shutil.copyfile(ROOT / 'docs/release' / filename, self.root / 'docs/release' / filename)
        self.dist, self.record = draft()

    def tearDown(self):
        self.tmp.cleanup()

    def errors(self):
        return distribution.validate_distribution(self.dist, root=self.root, evidence_errors=[], evidence_record=self.record)

    def test_exact_mixed_distribution_shape_passes(self):
        self.assertEqual(self.errors(), [])
        self.assertTrue(distribution.validate_distribution(self.dist, root=self.root))

    def test_stable_download_sets_cannot_be_partial_or_duplicated(self):
        original = copy.deepcopy(self.dist)
        for name in ('server', 'client', 'android'):
            for duplicate in (False, True):
                self.dist = copy.deepcopy(original)
                items = self.dist['channels']['stable']['components'][name]['downloads']
                if duplicate:
                    items.append(copy.deepcopy(items[0]))
                else:
                    items.pop()
                self.assertTrue(any('complete accepted download set' in error for error in self.errors()))

    def test_android_cannot_be_relabelled(self):
        self.dist['channels']['stable']['components']['android'].update(version='10.1.0',tag='v10.1.0')
        self.assertTrue(any('android' in e for e in self.errors()))

    def test_download_url_size_hash_and_revision_cannot_drift(self):
        original = copy.deepcopy(self.dist)
        for field, bad in [('sha256','f'*64), ('size_bytes',1), ('url','https://example.invalid/package')]:
            with self.subTest(field=field):
                self.dist = copy.deepcopy(original)
                self.dist['channels']['stable']['components']['client']['downloads'][0][field] = bad
                self.assertTrue(any('client download' in e for e in self.errors()))
        self.dist = original
        self.dist['channels']['stable']['components']['client']['release_revision'] = 'e'*40
        self.assertTrue(any('client revision' in e for e in self.errors()))

    def test_candidate_seal_and_contract_cannot_drift(self):
        self.dist['channels']['candidate']['components']['server']['source_sha'] = 'f'*40
        self.assertTrue(any('candidate server' in e for e in self.errors()))
        self.dist, self.record = draft()
        self.dist['channels']['stable']['contract_ref'] = 'api-v1.4.0'
        self.assertTrue(any('contract' in e for e in self.errors()))

    def test_historical_10_snapshot_is_byte_immutable(self):
        snapshot = self.root / 'docs/release/stable-10.0.0.json'
        snapshot.write_text(snapshot.read_text()+'\n')
        self.assertTrue(any('snapshot bytes changed' in e for e in self.errors()))
        snapshot.unlink()
        self.assertTrue(any('snapshot is missing' in e for e in self.errors()))


if __name__ == '__main__':
    unittest.main()
