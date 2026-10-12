"""Offline copy/version regressions; these fixtures are never release evidence."""
import copy
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from test_nestlink_promotion import fixture, promotion
import homedesk_downloads


def waived_fixture(version="14.0.1"):
    """Offline data only, never a statement about an actual runtime execution."""
    dist, records = fixture(version)
    policies = {name: hashlib.sha256(name.encode()).hexdigest() for name in promotion.release_policy.OWNER_WAIVER_POLICY_FILES}
    for name, record in records.items():
        source, run = promotion.release_policy.OWNER_WAIVER_BUILDS[name]
        dist["channels"]["candidate"]["components"][name]["source_sha"] = source
        record.update(revision=source, payload_source_revision=source)
        accepted = record["acceptance"]
        accepted.update(status="accepted_with_waivers", source_revision=source, build_run=run, build_attempt=1, deliverables={})
        if name == "android": accepted["client_core_revision"] = promotion.release_policy.OWNER_WAIVER_BUILDS["client"][0]
        for item in accepted["scenarios"]:
            item.clear()
        accepted["scenarios"] = [{"name": scene, "status": "not_run", "evidence": [], "owner_waiver": {
            "approved_by": "owner", "approved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "authorization": promotion.release_policy.OWNER_WAIVER_AUTHORIZATION,
            "reason": "Offline refusal/structure fixture; no runtime test was executed.", "disclosed_in": "docs/RELEASE_NOTES.md",
            "version": version, "component": name, "source_revision": source, "build_run": run, "build_attempt": 1,
            "deliverables": {}, "policy_file_sha256": policies}}
            for scene in sorted(promotion.release_policy.REQUIRED_SCENARIOS[name])]
        accepted["unverified"] += [item["name"] for item in accepted["scenarios"]]
        if name == "server":
            for image in accepted["images"].values(): image["revision"] = source
    return dist, records


class MaintenancePromotionTests(unittest.TestCase):
    def test_waived_site_projection_never_claims_integration_pass_and_keeps_capture_version(self):
        dist, records = waived_fixture()
        for name, record in records.items():
            for asset in record['assets']: asset.update(url='https://example.invalid/' + asset['filename'], size_bytes=10)
            dist['channels']['candidate']['components'][name]['artifacts'] = copy.deepcopy(record['assets'])
        promoted = promotion.promoted_distribution(dist, records, "offline-test-timestamp")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for relative in ("docs/site/index.html", "docs/site/en/index.html", "docs/site/preview.html", "docs/site/en/preview.html", "docs/DOWNLOADS.md"):
                target = root / relative; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((homedesk_downloads.distribution.ROOT / relative).read_bytes())
            homedesk_downloads.project_stable_entry_points(promoted, root=root)
            homedesk_downloads.project_stable_entry_points(promoted, root=root, check=True)
            for relative in ("index.html", "en/index.html", "preview.html", "en/preview.html"):
                text = (root / "docs/site" / relative).read_text(encoding="utf8")
                self.assertIn("14.0.0", text); self.assertIn("14.0.1", text); self.assertIn("not_run", text)
                self.assertNotIn("联调已通过", text); self.assertNotIn("reproducible integration passed", text)
                self.assertIn("assets/14.0.0/", text)

    def test_owner_waiver_projection_retains_not_run_without_claiming_pass(self):
        dist, records = waived_fixture()
        original = copy.deepcopy(records)
        result = promotion.promoted_distribution(dist, records, "offline-test-timestamp")
        self.assertEqual(records, original)
        self.assertEqual(result["channels"]["candidate"]["acceptance_status"], "accepted_with_waivers")
        self.assertIn("runtime scenarios remain not_run", result["channels"]["stable"]["verification_note"])
        self.assertIn("native-remote-control", result["channels"]["stable"]["not_verified"])

    def test_waiver_cannot_bypass_source_signature_scope_or_scenario_requirements(self):
        changes = [lambda records: records["client"].update(sigstore_verified=False),
                   lambda records: records["client"]["acceptance"]["scenarios"][0]["owner_waiver"].update(source_revision="f" * 40),
                   lambda records: records["android"]["acceptance"].update(client_core_revision="e" * 40),
                   lambda records: records["server"]["acceptance"]["scenarios"][0].update(status="failed"),
                   lambda records: records["client"]["acceptance"]["scenarios"][0].update(execution={"exit_code": 0}),
                   lambda records: records["android"]["acceptance"]["scenarios"].pop(),
                   lambda records: records["client"]["acceptance"].update(unverified=[])]
        for change in changes:
            dist, records = waived_fixture(); change(records)
            with self.subTest(change=change), self.assertRaises((ValueError, SystemExit)):
                promotion.promoted_distribution(dist, records, "offline-test-timestamp")
        for value in ("14.0.0", "14.0.2"):
            dist, records = waived_fixture(value)
            with self.subTest(version=value), self.assertRaises((ValueError, SystemExit)):
                promotion.promoted_distribution(dist, records, "offline-test-timestamp")

    def test_signed_source_waiver_context_checks_policy_notes_and_exact_record(self):
        _dist, records = waived_fixture()
        accepted = records["client"]["acceptance"]
        source_files = {"source/" + name: name.encode() for name in promotion.release_policy.OWNER_WAIVER_POLICY_FILES}
        source_files["source/docs/RELEASE_NOTES.md"] = ("accepted_with_waivers " + promotion.release_policy.OWNER_WAIVER_AUTHORIZATION + " " + " ".join(item["name"] for item in accepted["scenarios"])).encode()
        source_files["source/docs/release/acceptance-14.0.1.json"] = json.dumps(accepted).encode()
        for mutation in (None, "policy", "notes", "record"):
            files = dict(source_files)
            if mutation == "policy": files["source/scripts/homedesk-release.py"] = b"changed"
            if mutation == "notes": files["source/docs/RELEASE_NOTES.md"] = b"missing disclosure"
            if mutation == "record": files["source/docs/release/acceptance-14.0.1.json"] = b"{}"
            source = io.BytesIO()
            with zipfile.ZipFile(source, "w") as archive:
                for name, raw in files.items(): archive.writestr(name, raw)
            bundle = io.BytesIO()
            with zipfile.ZipFile(bundle, "w") as archive: archive.writestr("corresponding-source.zip", source.getvalue())
            bundle.seek(0)
            with self.subTest(mutation=mutation), zipfile.ZipFile(bundle) as archive:
                if mutation is None: promotion.verifier.signed_owner_waiver(archive, accepted, "client")
                else:
                    with self.assertRaises(SystemExit): promotion.verifier.signed_owner_waiver(archive, accepted, "client")

    def test_owner_waiver_copy_discloses_authorization_and_each_untested_scenario(self):
        _dist, records = waived_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.copy_fixture(root)
            promotion.final_copy(root, records)
            text = (root / "docs/RELEASE_NOTES.md").read_text(encoding="utf8")
            self.assertIn("accepted_with_waivers", text)
            self.assertIn(promotion.release_policy.OWNER_WAIVER_AUTHORIZATION, text)
            self.assertIn("14.0.0来源", text)
            for record in records.values():
                for item in record["acceptance"]["scenarios"]: self.assertIn(item["name"] + ": not_run", text)

    def test_verified_maintenance_projection_uses_selected_version_and_retains_limits(self):
        dist, records = fixture("14.0.1")
        records["client"]["acceptance"]["unverified"].append("windows-maintenance-local-gui-not-run")
        before = copy.deepcopy(dist)
        promoted = promotion.promoted_distribution(dist, records, "offline-test-timestamp")
        self.assertEqual(dist, before)
        for channel in ("stable", "candidate"):
            value = promoted["channels"][channel]
            self.assertEqual(value["version"], "14.0.1")
            self.assertEqual(value["tested_combination"], {name: "14.0.1" for name in ("server", "client", "android", "agent")})
            self.assertIn("windows-maintenance-local-gui-not-run", value["not_verified"])
        self.assertEqual(promoted["channels"]["stable"]["images"]["control"]["digest"], "sha256:" + "b" * 64)

    def test_other_version_or_unknown_predecessor_cannot_promote(self):
        dist, records = fixture("14.0.1")
        records["android"]["acceptance"]["version"] = "14.0.0"
        with self.assertRaises(ValueError):
            promotion.promoted_distribution(dist, records, "offline-test-timestamp")
        dist, records = fixture("14.0.2")
        with self.assertRaises(ValueError):
            promotion.promoted_distribution(dist, records, "offline-test-timestamp")

    def copy_fixture(self, root):
        # Independent pending inputs remain valid after the real checkout is promoted.
        marker = "目前仅为维护源码准备，新的 CI、安装包、镜像、APK、真实界面及隔离联调验收仍在进行。"
        notes = ("# NestLink 14.0.1 维护版\n\nLinux 版本入口维护。\n\n" + marker
                 + "14.0.0 的验收不替代本版，尚无公开 14.0.1 下载。\n\n"
                 "实体 Android、Windows 新版 GUI 与依赖风险仍须按真实范围记录。\n\n"
                 "## NestLink 14.0.0 历史发行\n\n历史全文：" + marker + "\n\nCurrent build and integration acceptance is pending.\n")
        inputs = {
            "VERSION": "14.0.1\n",
            "README.md": "# NestLink\n\n品牌。\n\n**14.0.1 维护版正在构建与验收。** 当前继续提供已发布的 14.0.0 下载。\n\n历史 14.0.0 的范围保持原样。\n",
            "README.en.md": "# NestLink\n\nBrand.\n\n**14.0.1 maintenance work is in progress.** Actual 14.0.0 downloads remain available.\n\nHistorical 14.0.0 scope remains unchanged.\n",
            "docs/RELEASE_NOTES.md": notes,
            "docs/HOMEDESK_RELEASE.md": notes,
        }
        for relative, contents in inputs.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(contents, encoding="utf8")

    def test_current_maintenance_copy_keeps_entire_historical_notes_and_readme(self):
        _dist, records = fixture("14.0.1")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.copy_fixture(root)
            originals = {p: (root / p).read_text(encoding="utf8") for p in ("README.md", "README.en.md", "docs/RELEASE_NOTES.md", "docs/HOMEDESK_RELEASE.md")}
            promotion.final_copy(root, records)
            for relative, original in originals.items():
                result = (root / relative).read_text(encoding="utf8")
                if relative.startswith("docs/"):
                    self.assertEqual(result.partition("\n## ")[2], original.partition("\n## ")[2])
                    self.assertIn("本版 14.0.1 三个组件", result)
                    self.assertIn("`physical-android-device`", result)
                    self.assertNotIn("尚无公开 14.0.1 下载", result.partition("\n## ")[0])
                else:
                    old_lines, new_lines = original.splitlines(), result.splitlines()
                    changed = [i for i, pair in enumerate(zip(old_lines, new_lines)) if pair[0] != pair[1]]
                    self.assertEqual(changed, [4])
                    self.assertNotIn("in progress", new_lines[4])
                    self.assertNotIn("正在构建", new_lines[4])
                self.assertNotIn(b"\r\n", (root / relative).read_bytes())

    def test_missing_current_marker_refuses_before_any_copy_write(self):
        _dist, records = fixture("14.0.1")
        for relative, before, after in (
            ("README.en.md", "**14.0.1 maintenance work", "**14.0.0 maintenance work"),
            ("docs/HOMEDESK_RELEASE.md", "目前仅为维护源码准备，", "已移除当前待验收标记，"),
        ):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.copy_fixture(root)
                target = root / relative
                target.write_text(target.read_text(encoding="utf8").replace(before, after, 1), encoding="utf8")
                originals = {p: (root / p).read_bytes() for p in ("README.md", "README.en.md", "docs/RELEASE_NOTES.md", "docs/HOMEDESK_RELEASE.md")}
                with self.assertRaises(ValueError):
                    promotion.final_copy(root, records)
                self.assertTrue(all((root / p).read_bytes() == raw for p, raw in originals.items()))

    def test_historical_marker_cannot_substitute_current_pending_paragraph(self):
        _dist, records = fixture("14.0.1")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.copy_fixture(root)
            for relative in ("docs/RELEASE_NOTES.md", "docs/HOMEDESK_RELEASE.md"):
                target = root / relative
                original = target.read_text(encoding="utf8")
                marker = "目前仅为维护源码准备，新的 CI、安装包、镜像、APK、真实界面及隔离联调验收仍在进行。"
                target.write_text(original.replace(marker, "当前正文无待验收段落。", 1) + "\n\n" + marker, encoding="utf8")
            with self.assertRaises(ValueError):
                promotion.final_copy(root, records)

    def test_legacy_14_copy_still_promotes_from_13_without_reusing_maintenance_copy(self):
        _dist, records = fixture("14.0.0")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs = {
                "VERSION": "14.0.0\n",
                "README.md": "# NestLink\n\n目前正在构建和验收。已发布的 13.0.0 下载保留至新版实际产物完成校验\n",
                "README.en.md": "# NestLink\n\nBuilds and acceptance are in progress; verified 13.0.0 downloads remain available until the new product bytes are published.\n",
                "docs/RELEASE_NOTES.md": "# NestLink 14.0.0\n\n本版最终构建、安装和联调正在验收。\n\nCurrent build and integration acceptance is pending.\n",
                "docs/HOMEDESK_RELEASE.md": "# NestLink 14.0.0\n\n本版最终构建、安装和联调正在验收。\n\n历史限制保留。\n",
            }
            for relative, contents in inputs.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(contents, encoding="utf8")
            promotion.final_copy(root, records)
            notes = (root / "docs/RELEASE_NOTES.md").read_text(encoding="utf8")
            self.assertIn("本版 14.0.0 三个组件", notes)
            self.assertIn("13.0.0 原始记录", notes)
            self.assertNotIn("Current build and integration acceptance is pending.", notes)


if __name__ == "__main__":
    unittest.main()
