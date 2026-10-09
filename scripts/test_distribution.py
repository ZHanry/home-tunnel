import copy
import json
import sys
import unittest
import tempfile
import shutil
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import distribution
import v10_evidence

ROOT = Path(__file__).resolve().parents[1]


def unpromoted_distribution():
    """Keep the pre-promotion safety regression independent of the live channel."""
    dist = distribution.load(ROOT)
    version = "10.1.0"
    dist["product"] = "Home Tunnel"
    dist["development_line"] = version
    stable = json.loads((ROOT / "docs/release/stable-9.0.0.json").read_text(encoding="utf-8"))
    dist["channels"] = {
        "stable": stable,
        "candidate": {
            "version": version, "stage": "development", "promotion_status": "not_promoted",
            "downloads_published": False, "acceptance_status": "pending", "prerelease": False,
            "tag": None, "frp": "0.70.1",
            "contract": {"current_stable_ref": "api-v1.3.0", "planned_ref": "api-v1.4.0", "frozen": False},
            "components": {name: {"repository": item["repository"], "version": v10_evidence.component_versions(version)[name], "source_sha": None, "artifacts": []}
                           for name, item in stable["components"].items()},
            "not_verified": sorted(distribution.REQUIRED_UNVERIFIED), "signing": copy.deepcopy(stable["signing"]),
        },
    }
    return dist


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "docs/release").mkdir(parents=True)
        (self.root / "VERSION").write_text("10.1.0\n")
        for name in ("stable-9.0.0.json", "stable-10.0.0.json"):
            shutil.copyfile(ROOT / "docs/release" / name, self.root / "docs/release" / name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_unpromoted_channel_matches_published_9_0_0(self):
        dist = unpromoted_distribution()
        self.assertEqual(distribution.validate_distribution(dist, root=self.root), [])
        self.assertEqual(dist["channels"]["stable"]["version"], "9.0.0")
        self.assertFalse(dist["channels"]["candidate"]["downloads_published"])
        self.assertEqual(dist["development_line"], "10.1.0")

    def test_current_channel_matches_the_published_waived_release(self):
        dist = distribution.load(ROOT)
        status, errors, record = v10_evidence.load_status(ROOT)
        self.assertEqual(errors, [])
        self.assertEqual(status["status"], "accepted_with_waivers")
        self.assertEqual(distribution.validate_distribution(dist, root=ROOT, evidence_errors=errors, evidence_record=record), [])
        self.assertEqual(distribution.projection_errors(dist, root=ROOT), [])
        self.assertEqual(dist["channels"]["stable"]["version"], "13.0.0" if dist["channels"]["candidate"]["promotion_status"] == "promoted" else "10.1.0")
        self.assertIn(dist["channels"]["candidate"]["acceptance_status"], ("pending", "passed_reproducible"))
        self.assertIn(dist["channels"]["candidate"]["promotion_status"], ("not_promoted", "promoted"))
        self.assertIs(dist["channels"]["candidate"]["prerelease"], False)

    def test_projection_is_idempotent(self):
        before = (ROOT / "releases.json").read_text(encoding="utf-8")
        distribution.project(ROOT)
        self.assertEqual((ROOT / "releases.json").read_text(encoding="utf-8"), before)
        self.assertEqual(
            json.loads((ROOT / "docs" / "site" / "candidate.json").read_text(encoding="utf-8")),
            distribution.load(ROOT)["channels"]["candidate"],
        )

    def test_promotion_and_invented_downloads_fail_closed(self):
        dist = unpromoted_distribution()
        promoted = copy.deepcopy(dist)
        promoted["channels"]["candidate"]["promotion_status"] = "promoted"
        self.assertTrue(distribution.validate_distribution(promoted, root=self.root))
        published = copy.deepcopy(dist)
        published["channels"]["candidate"]["downloads_published"] = True
        self.assertTrue(distribution.validate_distribution(published, root=self.root))
        drifted = copy.deepcopy(dist)
        drifted["channels"]["stable"]["version"] = "10.0.0"
        self.assertTrue(any("snapshot" in item for item in distribution.validate_distribution(drifted, root=self.root)))

    def test_candidate_cannot_promote_stable_relay_or_historical_acceptance(self):
        original = distribution.load(ROOT)
        original["channels"]["stable"] = json.loads((ROOT/"docs/release/stable-10.1.0.json").read_text())
        target=original["channels"]["candidate"]
        target.update(promotion_status="not_promoted",stage="development",acceptance_status="pending",tested_combination=None)
        for field, invalid in (("promotion_status", "promoted"), ("acceptance_status", "accepted"),
                               ("remote_policy", "allow_relay"), ("relay_enabled", True)):
            value = copy.deepcopy(original)
            value["channels"]["candidate"][field] = invalid
            self.assertTrue(distribution.validate_distribution(value, root=ROOT), field)
        value = copy.deepcopy(original)
        value["channels"]["stable"]["version"] = "11.0.0"
        self.assertTrue(distribution.validate_distribution(value, root=ROOT))

    def test_promotion_binds_waived_evidence_downloads_and_revisions(self):
        import tempfile

        import test_v10_evidence
        import v10_evidence

        waiver = {"approved_by": "owner", "approved_at": "2026-09-29T00:40:00Z",
                  "reason": "not run for this release", "disclosed_in": "docs/RELEASE_NOTES.md"}
        record = test_v10_evidence.valid_record()
        record["status"] = "accepted_with_waivers"
        record["gates"]["online_24h"] = {"status": "waived", "waiver": dict(waiver)}
        frozen = json.loads((ROOT / "docs" / "release" / "stable-9.0.0.json").read_text(encoding="utf-8"))
        stable = copy.deepcopy(frozen)
        stable["version"] = "10.0.0"
        stable.update(contract_ref=record["contract"]["ref"], contract_revision=record["contract"]["revision"],
                      contract_sha256=record["contract"]["sha256"])
        stable["tested_combination"] = {name: "10.0.0" for name in ("server", "client", "android", "agent")}
        for name, component in stable["components"].items():
            component.update(version="10.0.0", tag="v10.0.0", prerelease=False,
                             release_url=f"https://github.com/{component['repository']}/releases/tag/v10.0.0")
            artifact = record["components"][name]["artifacts"][0]
            component["downloads"] = [] if name == "hub" else [{"filename": artifact["filename"], "sha256": artifact["sha256"], "size_bytes": artifact["size_bytes"],
                                "url": f"https://github.com/{component['repository']}/releases/download/v10.0.0/{artifact['filename']}"}]
            if name != "hub":
                component["release_revision"] = record["sources"][name]["sha"]
        candidate = {"version": "10.0.0", "stage": "stable", "promotion_status": "promoted", "downloads_published": True,
                     "acceptance_status": "accepted_with_waivers", "prerelease": False, "tag": "v10.0.0", "frp": "0.70.1",
                     "waived": ["online_24h"],
                     "components": {name: {"repository": v10_evidence.REPOSITORIES[name], **copy.deepcopy(value)}
                                    for name, value in record["components"].items()}}
        dist = {"schema_version": 1, "product": "Home Tunnel", "source_of_truth": "distribution.json",
                "development_line": "10.0.0", "channels": {"stable": stable, "candidate": candidate}}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs" / "release").mkdir(parents=True)
            (root / "VERSION").write_text("10.0.0\n", encoding="utf-8")
            (root / "docs" / "release" / "stable-9.0.0.json").write_text(json.dumps(frozen), encoding="utf-8")
            (root / "evidence.json").write_text(json.dumps(record), encoding="utf-8")
            status = {"schema_version": 1, "version": "10.0.0", "status": "accepted_with_waivers",
                      "evidence_file": "evidence.json", "reason": "owner waivers are disclosed"}
            (root / "docs" / "release" / "acceptance-status.json").write_text(json.dumps(status), encoding="utf-8")
            _, errors, loaded = v10_evidence.load_status(root)
            self.assertEqual(errors, [])
            self.assertEqual(distribution.validate_distribution(dist, root=root, evidence_errors=errors, evidence_record=loaded), [])
            self.assertTrue(distribution.validate_distribution(dist, root=root))
            hidden = copy.deepcopy(dist)
            hidden["channels"]["candidate"]["waived"] = []
            self.assertTrue(any("waived" in e for e in distribution.validate_distribution(hidden, root=root, evidence_errors=[], evidence_record=loaded)))
            passed = copy.deepcopy(dist)
            passed["channels"]["candidate"]["acceptance_status"] = "accepted"
            self.assertTrue(distribution.validate_distribution(passed, root=root, evidence_errors=[], evidence_record=loaded))
            swapped = copy.deepcopy(dist)
            swapped["channels"]["stable"]["components"]["client"]["downloads"][0]["sha256"] = "b" * 64
            self.assertTrue(any("client download" in e for e in distribution.validate_distribution(swapped, root=root, evidence_errors=[], evidence_record=loaded)))
            moved = copy.deepcopy(dist)
            moved["channels"]["stable"]["components"]["server"]["release_revision"] = "c" * 40
            self.assertTrue(any("server revision" in e for e in distribution.validate_distribution(moved, root=root, evidence_errors=[], evidence_record=loaded)))
            status["status"] = "passed"
            (root / "docs" / "release" / "acceptance-status.json").write_text(json.dumps(status), encoding="utf-8")
            self.assertTrue(v10_evidence.load_status(root)[1])


if __name__ == "__main__":
    unittest.main()
