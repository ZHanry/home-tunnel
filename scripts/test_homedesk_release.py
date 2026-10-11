"""Version-driven product publication keeps stable evidence and original payload bytes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("homedesk-release.py")
spec = importlib.util.spec_from_file_location("product_release_under_test", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ProductReleaseTests(unittest.TestCase):
    def record(self):
        return {"version": "14.0.0", "component": "client", "status": "passed_reproducible",
                "source_revision": "a" * 40,
                "scenarios": [{"name": name, "status": "passed", "evidence": {"record": "actual-build"}}
                              for name in release.REQUIRED_SCENARIOS["client"]],
                "unverified": ["physical-android-device", "carrier-network-nat", "long-duration-media"],
                "deliverables": {}}

    def test_stable_versions_and_rc_are_distinct(self):
        for value in ("13.0.0", "14.0.0", "15.2.1"):
            self.assertTrue(release.is_stable_release(value))
        for value in ("14.0.0-RC1", "14.0.0-rc.1", "v14.0.0", "14.0", "014.0.0"):
            self.assertFalse(release.is_stable_release(value))

    def test_fourteen_cannot_reuse_thirteen_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs/release").mkdir(parents=True)
            old = self.record(); old["version"] = "13.0.0"
            (root / "docs/release/acceptance-13.0.0.json").write_text(json.dumps(old))
            with patch.object(release, "ROOT", root), patch.object(release, "version", return_value="14.0.0"):
                with self.assertRaisesRegex(SystemExit, "14.0.0 requires recorded"):
                    release.validate_acceptance("client", "b" * 40)

    def test_acceptance_must_match_version_scenarios_and_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "docs/release").mkdir(parents=True)
            path = root / "docs/release/acceptance-14.0.0.json"
            payload = root / "NestLink-Setup-14.0.0-x64.exe"; payload.write_bytes(b"accepted-byte-regression")
            record = self.record(); record["deliverables"] = {payload.name: release.digest(payload)}
            path.write_text(json.dumps(record))
            with patch.object(release, "ROOT", root), patch.object(release, "version", return_value="14.0.0"), patch.object(release, "run", return_value=""):
                self.assertEqual(release.validate_acceptance("client", "b" * 40, [payload]), record)
                payload.write_bytes(b"changed-byte-regression")
                with self.assertRaisesRegex(SystemExit, "payload bytes differ"):
                    release.validate_acceptance("client", "b" * 40, [payload])
                record["version"] = "13.0.0"; path.write_text(json.dumps(record))
                with self.assertRaisesRegex(SystemExit, "identity or status"):
                    release.validate_acceptance("client", "b" * 40)

    def test_runtime_changes_after_acceptance_still_block_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "docs/release").mkdir(parents=True)
            (root / "docs/release/acceptance-14.0.0.json").write_text(json.dumps(self.record()))
            with patch.object(release, "ROOT", root), patch.object(release, "version", return_value="14.0.0"), patch.object(release, "run", side_effect=["", "client/src/changed.rs"]):
                with self.assertRaisesRegex(SystemExit, "Runtime source changed"):
                    release.validate_acceptance("client", "b" * 40)


if __name__ == "__main__":
    unittest.main()
