import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import v10_evidence

ROOT = Path(__file__).resolve().parents[1]


def digest(label):
    return hashlib.sha256(label.encode()).hexdigest()


def sha(label):
    return hashlib.sha1(label.encode()).hexdigest()


def valid_record():
    sources = {}
    components = {}
    for name, repository in v10_evidence.REPOSITORIES.items():
        commit = sha("source-" + name)
        sources[name] = {"repository": repository, "sha": commit}
        components[name] = {
            "version": "10.0.0",
            "source_sha": commit,
            "artifacts": [{
                "filename": name + "-10.0.0.bin",
                "sha256": digest("artifact-" + name),
                "size_bytes": 2048,
            }],
        }
    cases = [{"id": f"UI-{index}", "result": "passed", "screenshot_sha256": digest(f"shot-{index}")} for index in range(2)]
    gates = {}
    for name in v10_evidence.REQUIRED_GATES:
        gates[name] = {
            "status": "passed",
            "source_component": "client",
            "source_sha": sources["client"]["sha"],
            "artifact_filename": "client-10.0.0.bin",
            "artifact_sha256": digest("artifact-client"),
            "observed_at": "2026-09-27T01:00:00Z",
            "command": "lab " + name,
            "measured_result": "measured " + name,
            "evidence_sha256": digest("evidence-" + name),
        }
    gates["repeat_30"].update(successes=30, attempts=30)
    gates["active_2h"]["duration_seconds"] = 7200
    gates["online_24h"]["duration_seconds"] = 86400
    gates["input_release_2s"]["release_ms"] = 2000
    gates["network_restore_30s"]["restore_seconds"] = 30
    gates["network_blocked_udp"]["payload_fallback"] = False
    gates["network_ipv6"]["address_family"] = "ipv6"
    gates["migration_9_to_10"].update(from_version="9.0.0", to_version="10.0.0")
    return {
        "schema_version": 1,
        "status": "passed",
        "product": "Home Tunnel",
        "version": "10.0.0",
        "stage": "candidate",
        "source_frozen_at": "2026-09-27T00:00:00Z",
        "frp": "0.70.1",
        "sources": sources,
        "contract": {"ref": "api-v1.4.0", "revision": sha("contract"), "sha256": digest("contract"), "immutable": True},
        "components": components,
        "ui_coverage": {
            "status": "passed",
            "reviewer": "gemini",
            "applicable_cases": 2,
            "reviewed_cases": 2,
            "blocking_findings": 0,
            "source_sha": sources["hub"]["sha"],
            "screenshot_manifest_sha256": digest("manifest"),
            "cases": cases,
        },
        "gates": gates,
    }


class EvidenceTests(unittest.TestCase):
    def test_consistent_in_memory_record_passes(self):
        self.assertEqual(v10_evidence.evaluate(valid_record()), [])

    def test_fixture_flag_and_placeholder_digest_fail(self):
        flagged = valid_record()
        flagged["fixture"] = True
        self.assertTrue(v10_evidence.evaluate(flagged))
        placeholder = valid_record()
        placeholder["components"]["client"]["artifacts"][0]["sha256"] = "a" * 64
        self.assertTrue(any("artifact" in item for item in v10_evidence.evaluate(placeholder)))

    def test_required_gates_fail_closed(self):
        missing = valid_record()
        missing["gates"].pop("online_24h")
        self.assertTrue(any("missing" in item for item in v10_evidence.evaluate(missing)))
        unrun = valid_record()
        unrun["gates"]["repeat_30"]["status"] = "not_run"
        self.assertTrue(any("repeat_30" in item for item in v10_evidence.evaluate(unrun)))
        stale = valid_record()
        stale["gates"]["active_2h"]["observed_at"] = "2026-09-26T23:00:00Z"
        self.assertTrue(any("active_2h" in item and "stale" in item for item in v10_evidence.evaluate(stale)))
        mismatched = valid_record()
        mismatched["gates"]["vm_windows_pair"]["artifact_sha256"] = digest("other-bytes")
        self.assertTrue(any("vm_windows_pair" in item for item in v10_evidence.evaluate(mismatched)))

    def test_specific_gate_thresholds_fail_closed(self):
        short = valid_record()
        short["gates"]["active_2h"]["duration_seconds"] = 7199
        self.assertTrue(any("active_2h" in item for item in v10_evidence.evaluate(short)))
        day = valid_record()
        day["gates"]["online_24h"]["duration_seconds"] = 86399
        self.assertTrue(any("online_24h" in item for item in v10_evidence.evaluate(day)))
        repeat = valid_record()
        repeat["gates"]["repeat_30"]["successes"] = 29
        self.assertTrue(any("repeat_30" in item for item in v10_evidence.evaluate(repeat)))
        fallback = valid_record()
        fallback["gates"]["network_blocked_udp"]["payload_fallback"] = True
        self.assertTrue(any("payload fallback" in item for item in v10_evidence.evaluate(fallback)))
        slow = valid_record()
        slow["gates"]["input_release_2s"]["release_ms"] = 2001
        self.assertTrue(any("input_release_2s" in item for item in v10_evidence.evaluate(slow)))
        restore = valid_record()
        restore["gates"]["network_restore_30s"]["restore_seconds"] = 31
        self.assertTrue(any("network_restore_30s" in item for item in v10_evidence.evaluate(restore)))

    def test_owner_waivers_are_disclosed_and_never_passes(self):
        waiver = {"approved_by": "owner", "approved_at": "2026-09-29T00:40:00Z",
                  "reason": "owner shipped without the matrix", "disclosed_in": "docs/RELEASE_NOTES.md"}
        waived = valid_record()
        for name in v10_evidence.WAIVABLE_GATES:
            waived["gates"][name] = {"status": "waived", "waiver": dict(waiver)}
        waived["ui_coverage"] = {"status": "waived", "waiver": dict(waiver), "source_sha": waived["sources"]["hub"]["sha"]}
        self.assertTrue(any("record status" in item for item in v10_evidence.evaluate(waived)))
        waived["status"] = "accepted_with_waivers"
        self.assertEqual(v10_evidence.evaluate(waived), [])
        self.assertEqual(len(v10_evidence.waived_items(waived)), len(v10_evidence.REQUIRED_GATES) + 1)
        clean = valid_record()
        clean["status"] = "accepted_with_waivers"
        self.assertTrue(any("record status" in item for item in v10_evidence.evaluate(clean)))
        for key in ("approved_by", "approved_at", "reason", "disclosed_in"):
            incomplete = valid_record()
            incomplete["status"] = "accepted_with_waivers"
            incomplete["gates"]["online_24h"] = {"status": "waived", "waiver": {k: v for k, v in waiver.items() if k != key}}
            self.assertTrue(any("online_24h" in item for item in v10_evidence.evaluate(incomplete)))
        claimed = valid_record()
        claimed["status"] = "accepted_with_waivers"
        claimed["gates"]["active_2h"] = {"status": "waived", "waiver": dict(waiver), "measured_result": "7200 s"}
        self.assertTrue(any("active_2h" in item for item in v10_evidence.evaluate(claimed)))
        unbound = valid_record()
        unbound["status"] = "accepted_with_waivers"
        unbound["ui_coverage"] = {"status": "waived", "waiver": dict(waiver), "source_sha": "a" * 40}
        self.assertTrue(any("UI coverage" in item for item in v10_evidence.evaluate(unbound)))

    def test_ui_and_contract_gaps_fail(self):
        ui = valid_record()
        ui["ui_coverage"]["blocking_findings"] = 1
        self.assertTrue(v10_evidence.evaluate(ui))
        contract = valid_record()
        contract["contract"]["immutable"] = False
        self.assertTrue(any("contract" in item for item in v10_evidence.evaluate(contract)))
        sources = valid_record()
        sources["sources"].pop("android")
        self.assertTrue(any("source" in item for item in v10_evidence.evaluate(sources)))

    def test_schema_gate_list_matches_the_validator(self):
        schema = json.loads((ROOT / "docs" / "release" / "v10-evidence.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(tuple(schema["x-required-gates"]), v10_evidence.REQUIRED_GATES)
        self.assertEqual(tuple(schema["x-owner-waivable-gates"]), v10_evidence.WAIVABLE_GATES)

    def test_repository_reconstructs_waivers_without_pass_claims(self):
        status, errors, record = v10_evidence.load_status(ROOT)
        self.assertEqual(errors, [])
        self.assertEqual(status["status"], "accepted_with_waivers")
        self.assertTrue(record["reconstructed_from_published_receipts"])
        self.assertEqual(len(v10_evidence.waived_items(record)), len(v10_evidence.REQUIRED_GATES) + 1)
        for gate in [record["ui_coverage"], *record["gates"].values()]:
            self.assertEqual(gate["status"], "waived")
            self.assertIn("waiver_receipt", gate)
            self.assertNotIn("measured_result", gate)
        claimed = copy.deepcopy(status)
        claimed["status"] = "passed"
        claimed["evidence_file"] = "docs/release/example-evidence.json"
        self.assertTrue(v10_evidence.assess_status(claimed, evidence_errors=[], evidence_path=claimed["evidence_file"]))

    def test_reconstructed_waivers_are_bound_to_original_receipts(self):
        _, _, record = v10_evidence.load_status(ROOT)
        for mutation, expected in (
            (lambda gate: gate["waiver"].update(reason="new approval invented today"), "preserve"),
            (lambda gate: gate["waiver_receipt"].update(sha256="0" * 64), "digest"),
            (lambda gate: gate["waiver_receipt"].update(cases=["not-an-approved-case"]), "cases"),
            (lambda gate: gate["waiver_receipt"].update(component="android"), "source"),
            (lambda gate: gate["waiver_receipt"].update(path="../outside.json"), "outside"),
            (lambda gate: gate.pop("waiver_receipt"), "missing"),
        ):
            with self.subTest(expected=expected):
                changed = copy.deepcopy(record)
                mutation(changed["gates"]["vm_windows_pair"])
                self.assertTrue(any(expected in error for error in v10_evidence.receipt_errors(changed, ROOT)))

    def test_reconstructed_waiver_cannot_change_its_gate_scope(self):
        _, _, record = v10_evidence.load_status(ROOT)
        swapped = copy.deepcopy(record)
        swapped["gates"]["vm_windows_pair"] = copy.deepcopy(swapped["gates"]["active_2h"])
        self.assertTrue(any("scope" in error for error in v10_evidence.receipt_errors(swapped, ROOT)))
        partial_ui = copy.deepcopy(record)
        partial_ui["ui_coverage"]["waiver_receipt"]["cases"] = ["keyboard_focus"]
        self.assertTrue(any("scope" in error for error in v10_evidence.receipt_errors(partial_ui, ROOT)))
        partial_network = copy.deepcopy(record)
        partial_network["gates"]["network_direct_udp"]["waiver_receipt"]["cases"] = ["lan"]
        self.assertTrue(any("scope" in error for error in v10_evidence.receipt_errors(partial_network, ROOT)))
        duplicate_case = copy.deepcopy(record)
        duplicate_case["gates"]["vm_windows_pair"]["waiver_receipt"]["cases"] *= 2
        self.assertTrue(any("scope" in error for error in v10_evidence.receipt_errors(duplicate_case, ROOT)))

    def test_reconstructed_waivers_bind_exact_component_package_bytes(self):
        _, _, record = v10_evidence.load_status(ROOT)
        for component in ("client", "android"):
            for field, value in (("sha256", digest("different published bytes")), ("size_bytes", 1),
                                 ("filename", "not-an-approved-package.bin")):
                with self.subTest(component=component, field=field):
                    changed = copy.deepcopy(record)
                    changed["components"][component]["artifacts"][0][field] = value
                    self.assertTrue(any("artifact bytes" in error for error in v10_evidence.receipt_errors(changed, ROOT)))

    def test_reconstructed_ui_preserves_android_and_aggregate_disclosure(self):
        _, _, record = v10_evidence.load_status(ROOT)
        for mutation, expected in (
            (lambda ui: ui.pop("additional_waivers"), "Android"),
            (lambda ui: ui["additional_waivers"]["android"]["waiver"].update(reason="new broader approval"), "preserve"),
            (lambda ui: ui["additional_waivers"]["android"].update(measured_result="new UI pass"), "measured"),
            (lambda ui: ui["additional_waivers"]["android"]["waiver_receipt"].update(cases=["all_applicable_states"]), "cases"),
            (lambda ui: ui.pop("release_disclosure"), "disclosure"),
            (lambda ui: ui["release_disclosure"].update(sha256="0" * 64), "digest"),
            (lambda ui: ui["release_disclosure"].update(quote="some unrelated text"), "full final UI"),
            (lambda ui: ui["release_disclosure"].update(source_url="https://github.com/ZHanry/home-tunnel/blob/main/docs/RELEASE_NOTES.md"), "original hub source"),
        ):
            with self.subTest(expected=expected):
                changed = copy.deepcopy(record)
                mutation(changed["ui_coverage"])
                self.assertTrue(any(expected in error for error in v10_evidence.receipt_errors(changed, ROOT)))

    def test_direct_record_command_checks_waiver_provenance(self):
        _, _, record = v10_evidence.load_status(ROOT)
        record["gates"]["vm_windows_pair"]["waiver_receipt"]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "record.json"
            path.write_text(json.dumps(record), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(ROOT / "scripts/check-v10-evidence.py"), str(path)],
                cwd=ROOT, capture_output=True, text=True,
            )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("waiver receipt digest", completed.stderr)

    def test_public_wording_can_change_without_rewriting_historical_disclosure(self):
        _, errors, record = v10_evidence.load_status(ROOT)
        self.assertEqual(errors, [])
        current = (ROOT / "docs/RELEASE_NOTES.md").read_bytes()
        self.assertNotEqual(hashlib.sha256(current).hexdigest(), record["ui_coverage"]["release_disclosure"]["sha256"])
        self.assertEqual(v10_evidence.receipt_errors(record, ROOT), [])

    def test_missing_original_git_disclosure_fails_closed(self):
        _, _, record = v10_evidence.load_status(ROOT)
        with patch.object(v10_evidence.subprocess, "run", return_value=subprocess.CompletedProcess([], 128, b"", b"missing")):
            self.assertTrue(any("original release disclosure is unavailable" in error
                                for error in v10_evidence.receipt_errors(record, ROOT)))


if __name__ == "__main__":
    unittest.main()
