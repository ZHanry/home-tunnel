"""Version-driven product publication keeps stable evidence and original payload bytes."""
import copy
import importlib.util
import subprocess
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


class OwnerWaiverReleaseTests(unittest.TestCase):
    """Synthetic local vectors only; never attest an installed product or a release."""

    def fixture(self, root, component="client"):
        (root / "docs/release").mkdir(parents=True)
        (root / "scripts").mkdir()
        for name in release.OWNER_WAIVER_POLICY_FILES:
            (root / name).write_bytes(("synthetic-policy-" + name).encode())
        source, run_id = release.OWNER_WAIVER_BUILDS.get(component, ("c" * 40, 900002))
        record = {"schema_version": 1, "version": "14.0.1", "component": component,
                  "status": "accepted_with_waivers", "source_revision": source,
                  "build_run": run_id, "build_attempt": 1, "deliverables": {},
                  "unverified": ["physical-android-device", "carrier-network-nat", "long-duration-media"],
                  "scenarios": []}
        if component == "android":
            record["client_core_revision"] = release.OWNER_WAIVER_BUILDS["client"][0]
        for name in sorted(release.REQUIRED_SCENARIOS[component]):
            if component == "hub" and name == "component-bytes-signatures":
                record["scenarios"].append({"name": name, "status": "passed", "evidence": {"synthetic_only": True}})
                continue
            waiver = {key: copy.deepcopy(record[key]) for key in
                      ("version", "component", "source_revision", "build_run", "build_attempt", "deliverables")}
            waiver.update(approved_by="owner", approved_at="2026-01-01T00:00:00+00:00",
                          authorization=release.OWNER_WAIVER_AUTHORIZATION,
                          reason="Synthetic scope-reduction vector; no runtime test was performed.",
                          disclosed_in="docs/RELEASE_NOTES.md",
                          policy_file_sha256={name: release.digest(root / name) for name in release.OWNER_WAIVER_POLICY_FILES})
            record["scenarios"].append({"name": name, "status": "not_run", "evidence": [], "owner_waiver": waiver})
            record["unverified"].append(name)
        notes = "accepted_with_waivers\n" + release.OWNER_WAIVER_AUTHORIZATION + "\n"
        notes += "\n".join(item["name"] for item in record["scenarios"])
        (root / "docs/RELEASE_NOTES.md").write_text(notes, encoding="utf8")
        return record

    def check(self, root, record, changes="", payload=None, selected_version="14.0.1"):
        path = root / ("docs/release/acceptance-" + selected_version + ".json")
        path.write_text(json.dumps(record), encoding="utf8")
        with patch.object(release, "ROOT", root), patch.object(release, "version", return_value=selected_version), \
             patch.object(release, "run", side_effect=["", changes]):
            return release.validate_acceptance(record["component"], "d" * 40, payload)

    def test_only_authorized_scope_reduction_keeps_all_four_component_identities(self):
        for component in release.REQUIRED_SCENARIOS:
            with self.subTest(component=component), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                record = self.fixture(root, component)
                changes = "\n".join(sorted(release.OWNER_WAIVER_POLICY_FILES))
                self.assertEqual(self.check(root, record, changes), record)
                self.assertEqual(record["status"], "accepted_with_waivers")

    def test_missing_duplicate_and_failed_scenarios_are_never_waived(self):
        for mutation in ("missing", "duplicate", "failed", "unknown"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                if mutation == "missing":
                    record["scenarios"].pop()
                elif mutation == "duplicate":
                    record["scenarios"].append(copy.deepcopy(record["scenarios"][0]))
                else:
                    record["scenarios"][0]["status"] = mutation
                with self.assertRaises(SystemExit):
                    self.check(root, record)

    def test_waiver_binding_cannot_change_source_build_or_product(self):
        for key, value in (("version", "14.0.0"), ("component", "android"), ("source_revision", "a" * 40),
                           ("build_run", 900003), ("build_attempt", 2), ("deliverables", {"wrong.apk": "a" * 64})):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                record["scenarios"][0]["owner_waiver"][key] = value
                with self.assertRaisesRegex(SystemExit, "exact source, build and payload"):
                    self.check(root, record)

    def test_actual_c_identity_cannot_be_relabelled_from_an_earlier_build(self):
        for key, value in (("source_revision", "a" * 40), ("build_run", 38135375094), ("build_attempt", 2)):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                record[key] = value
                for item in record["scenarios"]:
                    item["owner_waiver"][key] = value
                with self.assertRaisesRegex(SystemExit, "earlier A/B source or build"):
                    self.check(root, record)

    def test_owner_identity_quote_and_approval_time_are_required(self):
        for key, value in (("approved_by", "assistant"), ("authorization", "skip"),
                           ("approved_at", "2999-01-01T00:00:00Z"), ("approved_at", "2026-01-01T00:00:00"),
                           ("approved_at", "2026-01-01T08:00:00+08:00"), ("approved_at", None),
                           ("reason", ""), ("disclosed_in", "other.md")):
            with self.subTest(key=key, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                record["scenarios"][0]["owner_waiver"][key] = value
                with self.assertRaises(SystemExit):
                    self.check(root, record)

    def test_missing_owner_waiver_or_unknown_override_field_is_rejected(self):
        for mutation in ("missing", "override"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                if mutation == "missing":
                    record["scenarios"][0].pop("owner_waiver")
                else:
                    record["scenarios"][0]["owner_waiver"]["allow_runtime_changes"] = True
                with self.assertRaisesRegex(SystemExit, "exact owner waiver schema"):
                    self.check(root, record)

    def test_policy_bytes_and_exact_policy_file_set_are_sealed(self):
        for mutation in ("changed_file", "missing_file", "bad_hash", "extra_file"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                policies = record["scenarios"][0]["owner_waiver"]["policy_file_sha256"]
                if mutation == "changed_file":
                    (root / "scripts/homedesk-release.py").write_bytes(b"changed")
                elif mutation == "missing_file":
                    policies.pop("scripts/test_homedesk_release.py")
                elif mutation == "bad_hash":
                    policies["scripts/homedesk-release.py"] = "b" * 64
                else:
                    policies["client/src/changed.rs"] = "b" * 64
                with self.assertRaises(SystemExit):
                    self.check(root, record)

    def test_runtime_and_workflow_changes_still_block_publication(self):
        for name in ("client/src/changed.rs", "contracts/home-tunnel.v2.json", "compatibility.json",
                     "homedesk-core", ".github/workflows/release.yml", "scripts/release.py"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                with self.assertRaisesRegex(SystemExit, "Runtime source changed"):
                    self.check(root, record, name)

    def test_waiver_does_not_expand_historical_or_future_version_policy(self):
        for version in ("13.0.0", "14.0.0", "14.0.2", "15.0.0"):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                record["version"] = version
                with self.assertRaisesRegex(SystemExit, "identity or status"):
                    self.check(root, record, selected_version=version)

    def test_not_run_never_carries_execution_or_pass_evidence(self):
        for key, value in (("execution", {"exit_code": 0}), ("measured_result", "passed"),
                           ("observed_at", "2026-01-01T00:00:00Z"), ("evidence", {"result": "passed"})):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                record["scenarios"][0][key] = value
                with self.assertRaisesRegex(SystemExit, "cannot carry an execution"):
                    self.check(root, record)

    def test_waived_scope_is_explicit_in_notes_and_unverified(self):
        for mutation in ("missing_notes", "missing_quote", "missing_status", "missing_name", "missing_unverified"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                path = root / "docs/RELEASE_NOTES.md"
                if mutation == "missing_notes":
                    path.unlink()
                elif mutation == "missing_unverified":
                    record["unverified"].remove(record["scenarios"][0]["name"])
                else:
                    target = {"missing_quote": release.OWNER_WAIVER_AUTHORIZATION,
                              "missing_status": "accepted_with_waivers",
                              "missing_name": record["scenarios"][0]["name"]}[mutation]
                    path.write_text(path.read_text(encoding="utf8").replace(target, ""), encoding="utf8")
                with self.assertRaises(SystemExit):
                    self.check(root, record)

    def test_passed_scenario_still_needs_evidence_and_cannot_carry_waiver(self):
        for mutation in ("missing_evidence", "waiver"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                item = record["scenarios"][0]; item["status"] = "passed"
                if mutation == "missing_evidence":
                    item.pop("owner_waiver")
                else:
                    item["evidence"] = {"synthetic_only": True}
                with self.assertRaisesRegex(SystemExit, "passed scenario needs actual evidence"):
                    self.check(root, record)

    def test_waivers_never_become_passed_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root)
            record["status"] = "passed_reproducible"
            with self.assertRaisesRegex(SystemExit, "scenarios did not pass"):
                self.check(root, record)

    def test_all_passed_without_an_untested_scope_cannot_claim_waiver_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root)
            for item in record["scenarios"]:
                item.update(status="passed", evidence={"synthetic_only": True})
                item.pop("owner_waiver")
            with self.assertRaisesRegex(SystemExit, "every untested scenario"):
                self.check(root, record)

    def test_hub_signature_and_complete_byte_verification_cannot_be_waived(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root, "hub")
            item = next(item for item in record["scenarios"] if item["name"] == "component-bytes-signatures")
            source = next(item for item in record["scenarios"] if item["name"] == "current-ui-site")
            item.update(status="not_run", evidence=[], owner_waiver=copy.deepcopy(source["owner_waiver"]))
            record["unverified"].append(item["name"])
            with self.assertRaisesRegex(SystemExit, "cannot be waived"):
                self.check(root, record)

    def test_android_shared_core_and_positive_build_identity_are_not_waived(self):
        for key, value in (("client_core_revision", "a" * 40), ("build_run", True), ("build_attempt", 0)):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root, "android"); record[key] = value
                with self.assertRaises(SystemExit):
                    self.check(root, record)

    def test_policy_drift_is_still_rejected_in_normal_strict_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root)
            record["status"] = "passed_reproducible"
            for item in record["scenarios"]:
                item.update(status="passed", evidence={"synthetic_only": True}); item.pop("owner_waiver")
            with self.assertRaisesRegex(SystemExit, "Runtime source changed"):
                self.check(root, record, "scripts/homedesk-release.py")

    def test_payload_hash_verification_is_not_waived(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root)
            payload = root / "synthetic.bin"; payload.write_bytes(b"synthetic original")
            record["deliverables"] = {payload.name: release.digest(payload)}
            for item in record["scenarios"]:
                item["owner_waiver"]["deliverables"] = copy.deepcopy(record["deliverables"])
            self.check(root, record, payload=[payload])
            payload.write_bytes(b"synthetic altered")
            with self.assertRaisesRegex(SystemExit, "payload bytes differ"):
                self.check(root, record, payload=[payload])

    def test_source_ancestry_is_not_waived(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root)
            path = root / "docs/release/acceptance-14.0.1.json"
            path.write_text(json.dumps(record), encoding="utf8")
            with patch.object(release, "ROOT", root), patch.object(release, "version", return_value="14.0.1"), \
                 patch.object(release, "run", side_effect=subprocess.CalledProcessError(1, "synthetic git ancestry")):
                with self.assertRaises(subprocess.CalledProcessError):
                    release.validate_acceptance("client", "d" * 40)

    def test_remote_validator_uses_both_actual_signed_source_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root)
            policies = record["scenarios"][0]["owner_waiver"]["policy_file_sha256"]
            notes = (root / "docs/RELEASE_NOTES.md").read_text(encoding="utf8")
            with patch.object(release, "ROOT", root / "not-a-local-checkout"):
                untested = release.validate_owner_waiver_scenarios(record, "client", policy_file_sha256=policies, release_notes=notes)
            self.assertEqual(untested, release.REQUIRED_SCENARIOS["client"])

    def test_remote_policy_or_disclosure_cannot_be_omitted_or_mismatched(self):
        for mutation in ("hashes_only", "notes_only", "wrong_hash", "wrong_notes"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                policies = copy.deepcopy(record["scenarios"][0]["owner_waiver"]["policy_file_sha256"])
                notes = (root / "docs/RELEASE_NOTES.md").read_text(encoding="utf8")
                values = {"policy_file_sha256": policies, "release_notes": notes}
                if mutation == "hashes_only":
                    values.pop("release_notes")
                elif mutation == "notes_only":
                    values.pop("policy_file_sha256")
                elif mutation == "wrong_hash":
                    policies["scripts/homedesk-release.py"] = "a" * 64
                else:
                    values["release_notes"] = "not the signed release notes"
                with self.assertRaises(SystemExit):
                    release.validate_owner_waiver_scenarios(record, "client", **values)

    def metadata(self, root, record, mutation=None):
        revision = "d" * 40
        (root / "compatibility.json").write_text(json.dumps({"component": record["component"]}), encoding="utf8")
        checks = {"check_runs": [{"name": "Quality Gate", "id": 1, "conclusion": "success", "app": {"slug": "github-actions"}}]}
        security = {"workflow_runs": [{"name": name, "id": index, "conclusion": "success"}
                                      for index, name in enumerate(("CodeQL", "Secret scan"), start=1)]}
        selected = {"id": record["build_run"], "head_sha": record["source_revision"], "conclusion": "success",
                    "run_attempt": record["build_attempt"], "head_branch": "main",
                    "name": "Pages" if record["component"] == "hub" else "Component CI",
                    "path": ".github/workflows/pages.yml" if record["component"] == "hub" else ".github/workflows/ci.yml",
                    "event": "workflow_dispatch" if record["component"] == "server" else "push"}
        if mutation == "quality":
            checks["check_runs"][0]["conclusion"] = "failure"
        elif mutation == "codeql":
            security["workflow_runs"][0]["conclusion"] = "failure"
        elif mutation == "secrets":
            security["workflow_runs"][1]["conclusion"] = "failure"
        elif mutation is not None:
            key, value = mutation
            selected[key] = value
        def run(*command, **values):
            if command[:3] == ("git", "rev-parse", "HEAD"):
                return revision
            if command[0] == "git":
                return ""
            if command[:2] == ("gh", "api"):
                if "check-runs?" in command[2]:
                    return json.dumps(checks)
                if "actions/runs?" in command[2]:
                    return json.dumps(security)
                if command[2].endswith("actions/runs/" + str(record["build_run"])):
                    return json.dumps(selected)
            raise AssertionError("Unexpected synthetic command; no real GitHub operation is allowed")
        env = {"GITHUB_REF_NAME": "v14.0.1", "GITHUB_SHA": revision,
               "GITHUB_REPOSITORY": "ZHanry/synthetic-offline", "GITHUB_OUTPUT": str(root / "synthetic-output")}
        with patch.object(release, "ROOT", root), patch.object(release, "version", return_value="14.0.1"), \
             patch.object(release, "validate_acceptance", return_value=record), patch.object(release, "run", side_effect=run), \
             patch.dict(os.environ, env):
            release.candidate_metadata()
        return (root / "synthetic-output").read_text(encoding="utf8")

    def test_metadata_retains_the_original_build_for_every_component(self):
        for component in release.REQUIRED_SCENARIOS:
            with self.subTest(component=component), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root, component)
                output = self.metadata(root, record)
                self.assertIn("build-run=" + str(record["build_run"]), output)

    def test_owner_waiver_cannot_bypass_quality_security_or_original_ci_identity(self):
        for mutation in ("quality", "codeql", "secrets", ("conclusion", "failure"),
                         ("head_sha", "a" * 40), ("id", 900004), ("run_attempt", 2),
                         ("head_branch", "other"), ("path", ".github/workflows/other.yml"),
                         ("event", "workflow_dispatch")):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root)
                with self.assertRaises(SystemExit):
                    self.metadata(root, record, mutation)

    def test_hub_uses_actual_pages_identity_and_accepts_a_real_dispatch_event(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); record = self.fixture(root, "hub")
            self.assertIn("build-run=" + str(record["build_run"]), self.metadata(root, record, ("event", "workflow_dispatch")))
        for mutation in (("name", "Server CI"), ("path", ".github/workflows/ci.yml"), ("event", "pull_request")):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); record = self.fixture(root, "hub")
                with self.assertRaisesRegex(SystemExit, "exact original CI identity"):
                    self.metadata(root, record, mutation)



if __name__ == "__main__":
    unittest.main()
