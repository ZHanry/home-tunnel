"""Candidate publication failures must not silently change the stable channel."""
import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("candidate", Path(__file__).with_name("check-candidate-release.py"))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


def fixture():
    value = {
        "schema_version": 1, "version": "8.0.0-rc.1", "stage": "prerelease", "latest": False,
        "contract": {"ref": "api-v1.2.0-rc.1", "revision": "b" * 40, "sha256": "c" * 64},
        "components": {},
        "verification": {"automated": "passed", "windows_browser_udp_session": "passed", "physical": "partial", "limitations": ["Fixture only; never published"], "reports": []},
    }
    for name, repository in candidate.REPOSITORIES.items():
        base = f"https://github.com/{repository}/releases/"
        value["components"][name] = {
            "repository": repository, "tag": "v8.0.0-rc.1", "revision": "a" * 40, "prerelease": True,
            "release_url": base + "tag/v8.0.0-rc.1",
            "assets": [{"filename": "verification.json", "url": base + "download/v8.0.0-rc.1/verification.json", "sha256": "d" * 64, "size_bytes": 123}],
        }
    asset = value["components"]["hub"]["assets"][0]
    value["verification"]["reports"] = [{"url": asset["url"], "sha256": asset["sha256"]}]
    return value


class CandidateTests(unittest.TestCase):
    def test_contract_revision_is_independent_of_component_revision(self):
        self.assertEqual(candidate.validate(fixture()), "8.0.0-rc.1")

    def test_stable_flags_missing_evidence_and_unsealed_reports_are_refused(self):
        changes = [
            lambda v: v.update(latest=True),
            lambda v: v.update(version="8.0.0"),
            lambda v: v["verification"].update(automated="failed"),
            lambda v: v["verification"].update(windows_browser_udp_session="not_verified"),
            lambda v: v["verification"].update(limitations=[]),
            lambda v: v["verification"]["reports"][0].update(sha256="f" * 64),
            lambda v: v["components"].pop("client"),
            lambda v: v["components"]["client"].update(repository="someone/else"),
            lambda v: v["components"]["client"]["assets"][0].update(filename="../outside"),
            lambda v: v["components"]["client"]["assets"][0].update(size_bytes=True),
            lambda v: v["components"]["client"]["assets"][0].update(url="https://example.test/latest"),
        ]
        for change in changes:
            with self.subTest(change=change):
                value = fixture()
                change(value)
                with self.assertRaises(ValueError):
                    candidate.validate(value)

    def test_duplicate_assets_are_refused(self):
        value = fixture()
        value["components"]["client"]["assets"].append(copy.deepcopy(value["components"]["client"]["assets"][0]))
        with self.assertRaises(ValueError):
            candidate.validate(value)

    def test_online_verification_checks_tag_commits_and_bytes(self):
        value = fixture()
        def api(path):
            if "/git/ref/" in path:
                return {"object": {"type": "commit", "sha": "b" * 40 if "api-v1.2" in path else "a" * 40}}
            component = next(item for item in value["components"].values() if path.startswith(f"repos/{item['repository']}/releases/"))
            return {"prerelease": True, "draft": False, "assets": [{"name": asset["filename"], "size": asset["size_bytes"], "browser_download_url": asset["url"]} for asset in component["assets"]]}
        with patch.object(candidate, "github", side_effect=api), patch.object(candidate, "download_hash", side_effect=lambda url, size=None: "c" * 64 if "raw.githubusercontent" in url else "d" * 64):
            candidate.verify_remote(value)
        with patch.object(candidate, "github", side_effect=api), patch.object(candidate, "download_hash", return_value="f" * 64):
            with self.assertRaises(ValueError):
                candidate.verify_remote(value)


if __name__ == "__main__":
    unittest.main()
