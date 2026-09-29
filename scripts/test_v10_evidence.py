import copy
import hashlib
import json
import sys
import unittest
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

    def test_repository_has_no_submitted_evidence(self):
        status = json.loads((ROOT / "docs" / "release" / "acceptance-status.json").read_text(encoding="utf-8"))
        self.assertEqual(v10_evidence.assess_status(status), [])
        self.assertEqual(status["status"], "not_submitted")
        for path in (ROOT / "docs" / "release").glob("*.json"):
            if path.name == "v10-evidence.schema.json":
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertNotIn("gates", data)
        claimed = copy.deepcopy(status)
        claimed["status"] = "passed"
        claimed["evidence_file"] = "docs/release/example-evidence.json"
        self.assertTrue(v10_evidence.assess_status(claimed, evidence_errors=[], evidence_path=claimed["evidence_file"]))


if __name__ == "__main__":
    unittest.main()
