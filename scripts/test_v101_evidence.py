import copy
import json
import sys
import tempfile
import subprocess
from unittest.mock import patch
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_v10_evidence
import v10_evidence
import v101_provenance

ROOT = Path(__file__).resolve().parents[1]


def record():
    value = test_v10_evidence.valid_record()
    value['version'] = '10.1.0'
    value['contract'].update(ref='api-v1.5.0', **v10_evidence.V101_CONTRACT)
    value['source_frozen_at'] = '2026-09-27T02:00:00Z'
    for name, source in value['sources'].items():
        source['frozen_at'] = '2026-09-27T02:00:00Z' if name == 'hub' else '2026-09-27T00:00:00Z'
        value['components'][name]['version'] = v10_evidence.component_versions('10.1.0')[name]
    for gate in value['gates'].values():
        gate['source_components'] = ['client', 'server']
    value['gates']['migration_9_to_10']['to_version'] = '10.1.0'
    return value


class MixedVersionEvidenceTests(unittest.TestCase):
    def test_exact_mixed_combination_retains_android_10(self):
        value = record()
        self.assertEqual(v10_evidence.evaluate(value), [])
        value['components']['android']['version'] = '10.1.0'
        self.assertTrue(any('android version' in e for e in v10_evidence.evaluate(value)))

    def test_unknown_release_and_contract_relabel_fail(self):
        for field, change in [('version', '10.2.0'), ('contract', {'ref': 'api-v1.4.0', 'immutable': True})]:
            value = record()
            value[field] = change
            self.assertTrue(v10_evidence.evaluate(value))
        value = record()
        value['contract']['sha256'] = test_v10_evidence.digest('different contract')
        self.assertTrue(any('frozen api-v1.5.0' in e for e in v10_evidence.evaluate(value)))

    def test_documentation_freeze_does_not_retime_runtime_sources(self):
        value = record()
        self.assertEqual(v10_evidence.evaluate(value), [])
        value['sources']['server']['frozen_at'] = '2026-09-27T03:00:00Z'
        self.assertTrue(any('stale' in e for e in v10_evidence.evaluate(value)))
        value = record()
        value['gates']['active_2h']['source_components'] = ['client']
        # Generic evaluator checks syntax; byte/scope verifier requires both exact runtime sources.
        self.assertTrue(v101_provenance.evaluate(value, ROOT))

    def test_invalid_numeric_measurements_fail_closed(self):
        for bad in (True, float('inf'), float('nan'), -1, '7200'):
            value = record()
            value['gates']['active_2h']['duration_seconds'] = bad
            self.assertTrue(any('active_2h' in e for e in v10_evidence.evaluate(value)))
        value = record()
        value['gates']['active_2h']['duration_seconds'] = 7202.463167000001
        value['gates']['input_release_2s']['release_ms'] = 1539.1
        self.assertEqual(v10_evidence.evaluate(value), [])

    def test_missing_byte_provenance_is_not_acceptance(self):
        errors = v101_provenance.evaluate(record(), ROOT)
        self.assertTrue(any('provenance is missing' in e for e in errors))
        self.assertTrue(any('requires its own 10.1 runtime evidence' in e for e in errors))

    def test_original_native_byte_chain_and_scope_are_bound(self):
        value = json.loads((ROOT / 'docs/release/v10.1-evidence.json').read_text())
        def documentation(args, **kwargs):
            path = args[-1].split(':', 1)[1]
            return subprocess.CompletedProcess(args, 0, (ROOT / path).read_bytes(), b'')
        with patch.object(v101_provenance.subprocess, 'run', side_effect=documentation):
            self.assertEqual(v101_provenance.evaluate(value, ROOT), [])
            for mutation, expected in (
                (lambda r: r['provenance']['native_report'].update(sha256='f'*64), 'digest'),
                (lambda r: r['components']['hub']['artifacts'].pop(), 'complete'),
                (lambda r: r['components']['client']['artifacts'].pop(), 'complete'),
                (lambda r: r['components']['server']['artifacts'].pop(), 'complete'),
                (lambda r: r['components']['android']['artifacts'].pop(), 'historical'),
                (lambda r: r['gates']['repeat_30'].update(artifact_filename='home-tunnel-linux-10.1.0-amd64.tar.gz',
                    artifact_sha256=r['components']['client']['artifacts'][2]['sha256']), 'Windows ZIP'),
                (lambda r: r.update(ui_coverage={'status':'passed'}), 'UI review'),
                (lambda r: r['provenance']['worker_provenance'].update(path='../outside.json'), 'outside'),
                (lambda r: r['components']['client']['artifacts'][0].update(size_bytes=1), 'package'),
                (lambda r: r['gates']['active_2h'].update(duration_seconds=86400), 'measured'),
                (lambda r: r['gates']['repeat_30'].update(scope='full-installed-application'), 'scope'),
                (lambda r: r['gates']['repeat_30'].update(source_components=['client']), 'scope'),
                (lambda r: r['gates']['input_release_2s'].update(observed_at='2026-10-02T00:00:00Z'), 'timestamp'),
            ):
                changed = copy.deepcopy(value)
                mutation(changed)
                self.assertTrue(any(expected in error for error in v101_provenance.evaluate(changed, ROOT)))

    def test_status_cannot_claim_different_record_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'docs/release').mkdir(parents=True)
            (root / 'record.json').write_text(json.dumps(record()))
            (root / 'docs/release/acceptance-status.json').write_text(json.dumps({
                'schema_version': 1, 'version': '10.0.0', 'status': 'passed', 'evidence_file': 'record.json'}))
            with patch.object(v101_provenance, 'evaluate', return_value=[]):
                errors = v10_evidence.load_status(root)[1]
            self.assertIn('acceptance status version must match the evidence record version', errors)


if __name__ == '__main__':
    unittest.main()
