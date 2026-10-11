"""Promotion must never substitute historical evidence or partially switch channels."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import distribution
import homedesk_downloads

spec = importlib.util.spec_from_file_location("nestlink_promotion", Path(__file__).with_name("promote-nestlink.py"))
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)


def fixture():
    dist = distribution.load()
    candidate = dist["channels"]["candidate"]
    candidate.update(version="14.0.0", downloads_published=True, promotion_status="not_promoted")
    sources = {name: str(index) * 40 for index, name in enumerate(promotion.COMPONENTS, 1)}
    records = {}
    for name in promotion.COMPONENTS:
        item = candidate["components"][name]
        item.update(source_sha=sources[name], published=True, artifacts=[{"filename": name + ".fixture", "sha256": "a" * 64}])
        acceptance = {"status": "passed_reproducible", "version": "14.0.0", "component": name,
            "source_revision": sources[name], "scope": "Isolated installed fixture exercised the recorded scenarios.",
            "unverified": sorted(promotion.UNVERIFIED), "scenarios": [{"name": case, "status": "passed",
                "evidence": {"fixture_sources": copy.deepcopy(sources), "execution": {"command": "execute actual fixture scenario", "exit_code": 0},
                    "observation": "Original fixture recorded the successful observed behavior.",
                    "files": [{"path": "result.json", "kind": "result", "sha256": "c" * 64, "size_bytes": 100}]}}
                for case in sorted(promotion.release_policy.REQUIRED_SCENARIOS[name])]}
        records[name] = {"revision": sources[name], "payload_source_revision": sources[name], "assets": copy.deepcopy(item["artifacts"]),
            "source_manifest_verified": True, "sigstore_verified": True, "reproducible_acceptance_verified": True, "acceptance": acceptance}
    records["server"]["acceptance"]["images"] = {service: {"image": "ghcr.io/zhanry/home-tunnel-" + service,
        "digest": "sha256:" + "b" * 64, "revision": sources["server"]} for service in ("control-center", "traffic-gateway")}
    return dist, records


class PromotionTests(unittest.TestCase):
    def test_static_download_versions_follow_stable_before_and_after_promotion(self):
        for promoted in (False, True):
            with self.subTest(promoted=promoted), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                dist = copy.deepcopy(distribution.load())
                # Start both cases from the actual historical channel so the
                # fixture remains independent of this checkout's promotion.
                dist["channels"]["stable"] = json.loads(
                    (distribution.ROOT / "docs/release/stable-13.0.0.json").read_text(encoding="utf8"))
                version = "14.0.0" if promoted else "13.0.0"
                stable = dist["channels"]["stable"]
                stable["version"] = version
                dist["channels"]["candidate"]["promotion_status"] = "promoted" if promoted else "not_promoted"
                for component in stable["components"].values():
                    component["version"] = version
                    component["release_url"] = component["release_url"].replace("13.0.0", version)
                    for item in component.get("downloads", []):
                        item["filename"] = item["filename"].replace("13.0.0", version)
                        item["url"] = item["url"].replace("13.0.0", version)
                for relative in ("docs/site/downloads.html", "docs/site/en/downloads.html", "docs/DOWNLOADS.md"):
                    target = root / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(distribution.ROOT / relative, target)
                homedesk_downloads.project_stable_entry_points(dist, root=root)
                for relative, status in (("docs/site/downloads.html", "正式版"),
                                         ("docs/site/en/downloads.html", "stable release")):
                    html = (root / relative).read_text(encoding="utf8")
                    self.assertIn(f'<span class="eyebrow">DOWNLOAD / {version}</span>', html)
                    self.assertIn(f'id="download-status" role="status" aria-live="polite">{version} · {status}</p>', html)
                    self.assertIn(f'data-stable-version="{version}"', html)
                    self.assertIn(f'/releases/download/v{version}/NestLink-Setup-{version}-x64.exe', html)
                    if promoted:
                        self.assertNotIn("DOWNLOAD / 13.0.0", html)
                homedesk_downloads.project_stable_entry_points(dist, root=root, check=True)
                path = root / "docs/site/en/downloads.html"
                path.write_text(path.read_text(encoding="utf8").replace(f"DOWNLOAD / {version}", "DOWNLOAD / 0.0.0"), encoding="utf8")
                with self.assertRaises(ValueError):
                    homedesk_downloads.project_stable_entry_points(dist, root=root, check=True)

    def test_projection_uses_only_current_verified_sources_scope_and_images(self):
        dist, records = fixture()
        before = copy.deepcopy(dist)
        promoted = promotion.promoted_distribution(dist, records, "2026-10-10T08:00:00+00:00")
        self.assertEqual(dist, before)
        stable, candidate = promoted["channels"]["stable"], promoted["channels"]["candidate"]
        self.assertEqual(stable["version"], "14.0.0")
        self.assertEqual(stable["minimum_server"], "14.0.0")
        self.assertEqual(candidate["tested_combination"], {name: "14.0.0" for name in ("server", "client", "android", "agent")})
        self.assertEqual(candidate["component_verification"]["version"], "14.0.0")
        self.assertNotIn("run_id", candidate["component_verification"])
        self.assertNotIn("13.0.0", stable["tested_combination_scope"])
        self.assertEqual(stable["images"]["control"]["digest"], "sha256:" + "b" * 64)
        self.assertIsNone(candidate["components"]["hub"]["source_sha"])

    def test_missing_component_and_false_verification_fail_closed(self):
        for mutate in (lambda records: records.pop("android"),
                       lambda records: records["server"].update(sigstore_verified=False),
                       lambda records: records["client"].update(source_manifest_verified=False),
                       lambda records: records["android"].update(reproducible_acceptance_verified=False)):
            with self.subTest(mutate=mutate):
                dist, records = fixture()
                mutate(records)
                with self.assertRaises(ValueError):
                    promotion.promoted_distribution(dist, records, "now")

    def test_historical_or_other_source_acceptance_is_rejected(self):
        for fields in ({"version": "13.0.0"}, {"source_revision": "f" * 40}, {"status": "pending"}, {"component": "server"}):
            with self.subTest(fields=fields):
                dist, records = fixture()
                records["android"]["acceptance"].update(fields)
                with self.assertRaises(ValueError):
                    promotion.promoted_distribution(dist, records, "now")

    def test_scenario_peer_combination_and_outstanding_scope_are_checked(self):
        for mutate in (lambda acceptance: acceptance["scenarios"][0]["evidence"]["fixture_sources"].update(client="f" * 40),
                       lambda acceptance: acceptance.update(scenarios=[]),
                       lambda acceptance: acceptance["scenarios"].pop(),
                       lambda acceptance: acceptance["scenarios"].append(copy.deepcopy(acceptance["scenarios"][0])),
                       lambda acceptance: acceptance["scenarios"][0].update(status="not_run"),
                       lambda acceptance: acceptance["scenarios"][0]["evidence"].update(files=[]),
                       lambda acceptance: acceptance["scenarios"][0]["evidence"]["execution"].update(exit_code=1),
                       lambda acceptance: acceptance.update(unverified=[]),
                       lambda acceptance: acceptance.update(scope="passed")):
            with self.subTest(mutate=mutate):
                dist, records = fixture()
                mutate(records["server"]["acceptance"])
                with self.assertRaises(ValueError):
                    promotion.promoted_distribution(dist, records, "now")

    def test_accepted_image_identity_must_match_current_payload(self):
        for fields in ({"revision": "f" * 40}, {"digest": "tag:latest"}, {"image": "ghcr.io/other/server"}):
            with self.subTest(fields=fields):
                dist, records = fixture()
                records["server"]["acceptance"]["images"]["control-center"].update(fields)
                with self.assertRaises(ValueError):
                    promotion.promoted_distribution(dist, records, "now")

    def test_pending_candidate_cannot_reuse_historical_component_proof(self):
        dist = distribution.load()
        dist["channels"]["candidate"]["component_verification"] = {"version": "13.0.0", "run_id": 37975082230}
        self.assertTrue(any("historical record" in error for error in distribution.validate_distribution(dist)))

    def test_write_failure_restores_existing_channels_and_removes_new_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "stable.json").write_bytes(b"original13")
            original_write = Path.write_bytes
            def failing_write(path, contents):
                if path.name == "new.json.promotion-tmp":
                    raise OSError("fixture write failure")
                return original_write(path, contents)
            with patch.object(Path, "write_bytes", failing_write):
                with self.assertRaises(OSError):
                    promotion.apply_files(root, {Path("stable.json"): b"new14", Path("new.json"): b"new"})
            self.assertEqual((root / "stable.json").read_bytes(), b"original13")
            self.assertFalse((root / "new.json").exists())
            self.assertEqual(list(root.glob("*.promotion-tmp")), [])


if __name__ == "__main__":
    unittest.main()
