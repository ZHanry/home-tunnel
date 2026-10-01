"""Fail-closed checks for a Home Tunnel 10.x aggregate candidate record.

Shape and internal consistency only. A clean result is not VM acceptance,
UI approval, or proof that the recorded commits exist. Missing, unrun, stale,
mismatched, and fabricated records fail.
"""

from __future__ import annotations

import hashlib
import math
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

COMPONENTS = ("hub", "server", "client", "android")
REPOSITORIES = {
    "hub": "ZHanry/home-tunnel",
    "server": "ZHanry/home-tunnel-server",
    "client": "ZHanry/home-tunnel-client",
    "android": "ZHanry/home-tunnel-android",
}
REQUIRED_GATES = (
    "vm_windows_pair",
    "vm_web_to_windows",
    "vm_android_x64",
    "network_direct_udp",
    "network_blocked_udp",
    "network_ipv6",
    "migration_9_to_10",
    "repeat_30",
    "input_release_2s",
    "network_restore_30s",
    "active_2h",
    "online_24h",
)
# The owner may waive a gate that was not run on these exact sources, with a dated reason
# that is disclosed in the release notes. A waiver is not a pass and must not carry measured
# results. The owner waived the unrun 10.0.0 matrix on 2026-09-29; see docs/RELEASE_NOTES.md.
WAIVABLE_GATES = REQUIRED_GATES
# These are mappings of the existing 10.0.0 receipt cases, not new waiver scope.
# A receipt for one waived test must never authorize a different aggregate gate.
RECONSTRUCTED_RECEIPT_SCOPE = {
    "ui_coverage": ("client", "gemini_screenshots", ("all_applicable_states",)),
    "ui_coverage.android": ("android", "gemini_screenshots", ("final_apk_screenshot_review",)),
    "vm_windows_pair": ("client", "remote_sessions", ("windows_to_windows",)),
    "vm_web_to_windows": ("client", "remote_sessions", ("web_to_windows",)),
    "vm_android_x64": ("android", "x64_api35", ("final_apk_remote_session",)),
    "network_direct_udp": ("client", "udp_network", ("lan", "traversable_nat")),
    "network_blocked_udp": ("client", "udp_network", ("udp_blocked",)),
    "network_ipv6": ("client", "udp_network", ("ipv6",)),
    "migration_9_to_10": ("client", "upgrade_recovery", ("real_9_to_10_install", "backup", "restore")),
    "repeat_30": ("client", "stability", ("thirty_connections",)),
    "input_release_2s": ("client", "stability", ("input_release",)),
    "network_restore_30s": ("client", "udp_network", ("reconnect",)),
    "active_2h": ("client", "stability", ("two_hour_active",)),
    "online_24h": ("client", "stability", ("twenty_four_hour_online",)),
}
VERSION = "10.0.0"  # Historical fixture/default; evaluate the record's explicit release line.
COMPONENT_VERSIONS = {
    "10.0.0": {name: "10.0.0" for name in COMPONENTS},
    "10.1.0": {"hub": "10.1.0", "server": "10.1.0", "client": "10.1.0", "android": "10.0.0"},
}


V101_ARTIFACT_NAMES = {
    "hub": {"DOWNLOADS.md", "RELEASE_NOTES.md"},
    "server": {"home-tunnel-server-10.1.0.tar.gz", "compose.release.yaml"},
    "client": {
        "HomeTunnel-Setup-10.1.0-x64.exe", "HomeTunnel-Windows-10.1.0-x64.zip",
        "home-tunnel-linux-10.1.0-amd64.tar.gz", "home-tunnel-linux-10.1.0-arm64.tar.gz",
        "home-tunnel-macos-10.1.0-amd64.tar.gz", "home-tunnel-macos-10.1.0-arm64.tar.gz",
    },
    "android": {"HomeTunnel-Android-10.0.0-arm64-v8a.apk", "HomeTunnel-Android-10.0.0-x86_64.apk"},
}


def component_versions(version):
    """Explicitly reviewed release combinations; never silently relabel a component."""
    return COMPONENT_VERSIONS.get(version, {})

# acceptance-status.json states that claim a release; each needs a clean evidence record.
ACCEPTED_STATES = {"passed", "accepted", "accepted_with_waivers"}
CONTRACT_REF = "api-v1.4.0"  # Historical default.
CONTRACT_REFS = {"10.0.0": "api-v1.4.0", "10.1.0": "api-v1.5.0"}
V101_CONTRACT = {
    "revision": "194ae805f3569dc16d94b7fda71367e5d68fdff5",
    "sha256": "c447a23f72b9f72efc118d75cd7cf3e071e0533e2bf0773e9b34f0e1ec779f54",
}
FRP = "0.70.1"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
UNRUN = {"", "not_run", "unrun", "pending", "skipped", "not_verified", "missing", "blocked", "untested"}
PLACEHOLDER_DIGESTS = {
    hashlib.sha256(b"").hexdigest(),
    hashlib.sha256(b"fixture").hexdigest(),
    hashlib.sha256(b"placeholder").hexdigest(),
    hashlib.sha256(b"test").hexdigest(),
}


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def parse_time(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def bad_digest(value):
    return (
        not isinstance(value, str)
        or SHA256.fullmatch(value) is None
        or len(set(value)) == 1
        or value in PLACEHOLDER_DIGESTS
    )


def waiver_problem(name, gate):
    """Return an error for an invalid owner waiver, or None."""
    waiver = gate.get("waiver") if isinstance(gate.get("waiver"), dict) else {}
    if (waiver.get("approved_by") != "owner" or parse_time(waiver.get("approved_at")) is None
            or not str(waiver.get("reason", "")).strip() or not str(waiver.get("disclosed_in", "")).strip()):
        return f"{name} waiver needs owner approval, time, reason and release-note disclosure"
    if any(key in gate for key in ("measured_result", "evidence_sha256", "observed_at")) or gate.get("result") == "passed":
        return f"{name} waiver must not claim measured results"
    return None


def waived_items(record):
    """(name, reason) for every waived gate and a waived UI review."""
    items = []
    ui = record.get("ui_coverage") if isinstance(record.get("ui_coverage"), dict) else {}
    if ui.get("status") == "waived":
        items.append(("ui_coverage", str((ui.get("waiver") or {}).get("reason", ""))))
    gates = record.get("gates") if isinstance(record.get("gates"), dict) else {}
    for name in REQUIRED_GATES:
        gate = gates.get(name)
        if isinstance(gate, dict) and gate.get("status") == "waived":
            items.append((name, str((gate.get("waiver") or {}).get("reason", ""))))
    return items


def evaluate(record, *, now=None):
    """Return a list of failures. An empty list means the record is internally consistent."""
    errors = []

    def bad(message):
        errors.append(message)

    if not isinstance(record, dict):
        return ["evidence must be an object"]
    if record.get("fixture") is True or record.get("synthetic") is True:
        bad("fixture or synthetic records cannot be used as acceptance evidence")
    if record.get("schema_version") != 1 or record.get("product") != "Home Tunnel":
        bad("unsupported evidence identity")
    version = record.get("version")
    versions = component_versions(version)
    if not versions or record.get("stage") != "candidate":
        bad("evidence must describe a supported 10.x candidate")
    frozen_at = parse_time(record.get("source_frozen_at"))
    if frozen_at is None:
        bad("source_frozen_at must be a timezone-aware timestamp")
    if record.get("frp") != FRP:
        bad("FRP must stay at its independent 0.70.1 identity")
    if record.get("status") != ("accepted_with_waivers" if waived_items(record) else "passed"):
        bad("record status must be passed without waivers, or accepted_with_waivers with them")

    sources = record.get("sources") if isinstance(record.get("sources"), dict) else {}
    if set(sources) != set(COMPONENTS):
        bad("all four source identities are required")
    shas = []
    for name in COMPONENTS:
        source = sources.get(name) if isinstance(sources.get(name), dict) else {}
        sha = str(source.get("sha", ""))
        if source.get("repository") != REPOSITORIES[name] or SHA40.fullmatch(sha) is None or len(set(sha)) == 1:
            bad(f"{name} source SHA is missing or mismatched")
        else:
            shas.append(sha)
        if version == "10.1.0" and parse_time(source.get("frozen_at")) is None:
            bad(f"{name} source needs its own frozen_at timestamp")
    if len(shas) == 4 and len(set(shas)) != 4:
        bad("the four source SHAs must be distinct commits")

    contract = record.get("contract") if isinstance(record.get("contract"), dict) else {}
    if contract.get("ref") != CONTRACT_REFS.get(version) or contract.get("immutable") is not True:
        bad("immutable contract identity must match the release line")
    if version == "10.1.0" and any(contract.get(key) != value for key, value in V101_CONTRACT.items()):
        bad("10.1.0 must bind the frozen api-v1.5.0 revision and digest")
    if SHA40.fullmatch(str(contract.get("revision", ""))) is None or bad_digest(contract.get("sha256")):
        bad("contract revision and digest are required")

    components = record.get("components") if isinstance(record.get("components"), dict) else {}
    if set(components) != set(COMPONENTS):
        bad("all four component artifact sets are required")
    artifacts = {}
    for name in COMPONENTS:
        component = components.get(name) if isinstance(components.get(name), dict) else {}
        expected_sha = (sources.get(name) or {}).get("sha") if isinstance(sources.get(name), dict) else None
        if component.get("version") != versions.get(name) or component.get("source_sha") != expected_sha:
            bad(f"{name} version or source SHA does not match the frozen source")
        items = component.get("artifacts")
        if not isinstance(items, list) or not items:
            bad(f"{name} artifacts are missing")
            continue
        seen = set()
        for item in items:
            if not isinstance(item, dict):
                bad(f"{name} artifact is not an object")
                continue
            filename = str(item.get("filename", ""))
            digest = item.get("sha256")
            size = item.get("size_bytes")
            if not filename or any(part in filename for part in ("/", "\\", "\n", "\r")) or filename in {".", ".."} or filename in seen:
                bad(f"{name} artifact name is unsafe or duplicated")
            seen.add(filename)
            if bad_digest(digest) or type(size) is not int or size <= 0:
                bad(f"{name} artifact digest or size is missing")
            else:
                artifacts[(name, filename)] = digest

    ui = record.get("ui_coverage") if isinstance(record.get("ui_coverage"), dict) else {}
    hub_sha = (sources.get("hub") or {}).get("sha") if isinstance(sources.get("hub"), dict) else None
    if ui.get("status") == "waived":
        problem = waiver_problem("ui_coverage", ui)
        if problem:
            bad(problem)
        if ui.get("source_sha") != hub_sha:
            bad("UI coverage is not bound to the hub source")
    else:
        if ui.get("status") != "passed" or ui.get("reviewer") != "gemini" or ui.get("blocking_findings") != 0:
            bad("full UI coverage requires a passed Gemini review and zero blocking findings")
        applicable = ui.get("applicable_cases")
        cases = ui.get("cases")
        if type(applicable) is not int or applicable <= 0 or ui.get("reviewed_cases") != applicable or not isinstance(cases, list) or len(cases) != applicable:
            bad("UI coverage is incomplete")
        elif isinstance(cases, list):
            seen_cases = set()
            for case in cases:
                if not isinstance(case, dict) or not str(case.get("id", "")).strip() or case.get("result") != "passed" or case.get("id") in seen_cases or bad_digest(case.get("screenshot_sha256")):
                    bad("every applicable UI case must pass with its own screenshot digest")
                    break
                seen_cases.add(case["id"])
        if ui.get("source_sha") != hub_sha or bad_digest(ui.get("screenshot_manifest_sha256")):
            bad("UI coverage is not bound to the hub source and a manifest digest")

    gates = record.get("gates") if isinstance(record.get("gates"), dict) else {}
    missing = [name for name in REQUIRED_GATES if name not in gates]
    extra = [name for name in gates if name not in REQUIRED_GATES]
    if missing:
        bad("required gates are missing: " + ", ".join(missing))
    if extra:
        bad("unknown gates are present: " + ", ".join(extra))
    for name in REQUIRED_GATES:
        gate = gates.get(name)
        if isinstance(gate, dict) and gate.get("status") == "waived":
            if name not in WAIVABLE_GATES:
                bad(f"{name} cannot be waived")
            else:
                problem = waiver_problem(name, gate)
                if problem:
                    bad(problem)
            continue
        if not isinstance(gate, dict) or gate.get("status") in UNRUN or gate.get("status") is None:
            bad(f"{name} was not run")
            continue
        if gate.get("status") == "stale":
            bad(f"{name} is stale")
            continue
        if gate.get("status") != "passed":
            bad(f"{name} did not pass")
            continue
        component = gate.get("source_component")
        source_sha = (sources.get(component) or {}).get("sha") if isinstance(sources.get(component), dict) else None
        if component not in COMPONENTS or gate.get("source_sha") != source_sha:
            bad(f"{name} source SHA is mismatched or stale")
        filename = gate.get("artifact_filename")
        digest = gate.get("artifact_sha256")
        if artifacts.get((component, filename)) != digest or bad_digest(digest):
            bad(f"{name} artifact digest is mismatched")
        observed = parse_time(gate.get("observed_at"))
        gate_frozen_at = frozen_at
        if version == "10.1.0":
            used = gate.get("source_components")
            if (not isinstance(used, list) or not used or component not in used or
                    len(used) != len(set(used)) or any(name not in COMPONENTS for name in used)):
                bad(f"{name} must identify every source component it exercised")
            else:
                times = [parse_time((sources.get(name) or {}).get("frozen_at")) for name in used]
                if all(value is not None for value in times):
                    gate_frozen_at = max(times)
        if observed is None or (gate_frozen_at is not None and observed < gate_frozen_at):
            bad(f"{name} is stale or has no observation time")
        if now is not None and observed is not None and observed > now:
            bad(f"{name} observation is in the future")
        measured = str(gate.get("measured_result", ""))
        if not str(gate.get("command", "")).strip() or not measured.strip():
            bad(f"{name} is missing a command or measured result")
        if bad_digest(gate.get("evidence_sha256")):
            bad(f"{name} evidence digest is missing or placeholder")
        lowered = measured.lower()
        if "fixture" in lowered or "synthetic" in lowered or "placeholder" in lowered:
            bad(f"{name} uses fabricated evidence")
        if name == "repeat_30" and (gate.get("successes") != 30 or gate.get("attempts") != 30):
            bad("repeat_30 requires 30 successes in 30 attempts")
        if name == "active_2h" and (not finite_number(gate.get("duration_seconds")) or gate["duration_seconds"] < 7200):
            bad("active_2h duration was not met")
        if name == "online_24h" and (not finite_number(gate.get("duration_seconds")) or gate["duration_seconds"] < 86400):
            bad("online_24h duration was not met")
        if name == "input_release_2s" and (not finite_number(gate.get("release_ms")) or not 0 <= gate["release_ms"] <= 2000):
            bad("input_release_2s was not measured within 2 seconds")
        if name == "network_restore_30s" and (not finite_number(gate.get("restore_seconds")) or not 0 <= gate["restore_seconds"] <= 30):
            bad("network_restore_30s was not measured within 30 seconds")
        if name == "network_blocked_udp" and gate.get("payload_fallback") is not False:
            bad("blocked UDP must fail closed with no payload fallback")
        if name == "network_ipv6" and gate.get("address_family") != "ipv6":
            bad("network_ipv6 must record an IPv6 path")
        if name == "migration_9_to_10" and (gate.get("from_version") != "9.0.0" or gate.get("to_version") != version):
            bad(f"migration gate must bind 9.0.0 to {version}")
    return errors


def assess_status(status, *, evidence_errors=None, evidence_path=None):
    """Development may stay not_submitted. A pass claim fails closed without a clean real record."""
    if not isinstance(status, dict) or status.get("schema_version") != 1 or not component_versions(status.get("version")):
        return ["acceptance status identity is wrong"]
    state = status.get("status")
    reason = str(status.get("reason", ""))
    if state in {"not_submitted", "pending"}:
        errors = []
        if status.get("evidence_file") not in (None, ""):
            errors.append("unsubmitted acceptance must not reference an evidence file")
        if "not evidence" not in reason.lower() and "不是验收证据" not in reason:
            errors.append("unsubmitted acceptance must say it is not evidence")
        return errors
    if state in ACCEPTED_STATES:
        if evidence_path is None:
            return ["accepted status is missing an evidence file"]
        name = Path(str(evidence_path)).name.lower()
        errors = []
        if any(token in name for token in ("fixture", "example", "sample", "placeholder")):
            errors.append("fixture files cannot satisfy acceptance")
        if evidence_errors is None:
            errors.append("accepted status was not evaluated")
        else:
            errors.extend(evidence_errors)
        return errors
    return [f"unsupported or unrun acceptance status: {state}"]


def receipt_errors(record, root):
    """Verify cited historical waivers without extending or re-approving them.

    A reconstructed record preserves the exact existing waiver and records which
    waived receipt cases it represents. It is not a new measurement or approval.
    Other evidence records retain the normal fail-closed evaluator above.
    """
    import json

    errors = []
    root = Path(root).resolve()
    gates = record.get("gates") if isinstance(record.get("gates"), dict) else {}
    ui = record.get("ui_coverage") if isinstance(record.get("ui_coverage"), dict) else {}
    entries = {"ui_coverage": ui, **gates}
    additional = ui.get("additional_waivers", {})
    if record.get("reconstructed_from_published_receipts") and ui.get("status") == "waived":
        if not isinstance(additional, dict) or set(additional) != {"android"}:
            errors.append("ui_coverage must preserve the separate original Android UI waiver")
        elif not isinstance(additional["android"], dict) or additional["android"].get("status") != "waived":
            errors.append("ui_coverage.android must remain an original waived receipt")
        disclosure = ui.get("release_disclosure")
        if not isinstance(disclosure, dict):
            errors.append("ui_coverage is missing the original aggregate release disclosure")
        else:
            relative = "docs/RELEASE_NOTES.md"
            hub = (record.get("sources") or {}).get("hub", {})
            url = f"https://github.com/{REPOSITORIES['hub']}/blob/{hub.get('sha')}/{relative}"
            quote = "- 最终界面的完整 Gemini 审查"
            if disclosure.get("path") != relative or disclosure.get("source_url") != url:
                errors.append("ui_coverage release disclosure must identify the original hub source")
            # Public explanations may be clarified without rewriting their
            # historical evidence. Read the original, immutable source commit,
            # not today's editable release-notes document.
            content = None
            if SHA40.fullmatch(str(hub.get("sha", ""))):
                try:
                    historical = subprocess.run(
                        ["git", "show", f"{hub['sha']}:{relative}"], cwd=root,
                        capture_output=True, timeout=10, check=False,
                    )
                    if historical.returncode == 0:
                        content = historical.stdout
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if content is None:
                errors.append("ui_coverage original release disclosure is unavailable; fetch the repository history")
            else:
                if hashlib.sha256(content).hexdigest() != disclosure.get("sha256"):
                    errors.append("ui_coverage release disclosure digest differs")
                if disclosure.get("quote") != quote or quote.encode("utf-8") not in content:
                    errors.append("ui_coverage release disclosure must retain the full final UI review waiver")
    if isinstance(additional, dict):
        entries.update({f"ui_coverage.{component}": gate for component, gate in additional.items()})
    for name, gate in entries.items():
        if not isinstance(gate, dict):
            errors.append(f"{name} waiver must be an object")
            continue
        provenance = gate.get("waiver_receipt")
        if not provenance:
            if record.get("reconstructed_from_published_receipts") and gate.get("status") == "waived":
                errors.append(f"{name} reconstructed waiver is missing its receipt")
            continue
        if not isinstance(provenance, dict):
            errors.append(f"{name} waiver receipt must be an object")
            continue
        path = (root / str(provenance.get("path", ""))).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            errors.append(f"{name} waiver receipt is missing or outside the repository")
            continue
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != provenance.get("sha256"):
            errors.append(f"{name} waiver receipt digest differs")
            continue
        try:
            receipt = json.loads(content)
        except (UnicodeDecodeError, ValueError):
            errors.append(f"{name} waiver receipt is not valid JSON")
            continue
        if not isinstance(receipt, dict):
            errors.append(f"{name} waiver receipt must contain an object")
            continue
        if gate.get("status") != "waived" or receipt.get("status") != "waived" or gate.get("waiver") != receipt.get("waiver"):
            errors.append(f"{name} must preserve its existing waiver exactly")
        problem = waiver_problem(name, gate)
        if problem:
            errors.append(problem)
        cases = provenance.get("cases")
        receipt_cases = receipt.get("cases") if isinstance(receipt.get("cases"), dict) else {}
        if (not isinstance(cases, list) or not cases or
                any(not isinstance(case, str) or receipt_cases.get(case) != "waived" for case in cases)):
            errors.append(f"{name} must cite existing waived receipt cases")
        component = provenance.get("component")
        sources = record.get("sources") if isinstance(record.get("sources"), dict) else {}
        source = sources.get(component, {}) if isinstance(component, str) else {}
        source = source if isinstance(source, dict) else {}
        if (receipt.get("repository") != source.get("repository") or
                (receipt.get("revision") or receipt.get("app_revision")) != source.get("sha")):
            errors.append(f"{name} waiver receipt source differs")
        scope = RECONSTRUCTED_RECEIPT_SCOPE.get(name)
        if scope is None:
            errors.append(f"{name} has no historical waiver receipt scope")
            continue
        expected_component, expected_gate, expected_cases = scope
        expected_path = f"validation/{expected_component}/{source.get('sha')}/{expected_component}-acceptance-{expected_gate}.json"
        if component != expected_component:
            errors.append(f"{name} waiver receipt source component is outside its original scope")
        if provenance.get("path") != expected_path or receipt.get("gate") != expected_gate:
            errors.append(f"{name} waiver receipt gate or path is outside its original scope")
        if not isinstance(cases, list) or sorted(str(case) for case in cases) != sorted(expected_cases):
            errors.append(f"{name} waiver receipt cases must preserve the exact original gate scope")

        # The owner waived these exact published packages. A source commit alone
        # cannot extend that approval to rebuilt or otherwise different bytes.
        packages = receipt.get("packages") if isinstance(receipt.get("packages"), dict) else {}
        by_filename = {
            package.get("name", key): package
            for key, package in packages.items() if isinstance(package, dict)
        }
        components = record.get("components") if isinstance(record.get("components"), dict) else {}
        component_record = components.get(expected_component)
        artifacts = component_record.get("artifacts", []) if isinstance(component_record, dict) else []
        if not isinstance(artifacts, list) or not artifacts:
            errors.append(f"{name} waiver receipt has no component artifacts to bind")
            continue
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue  # The normal evaluator reports malformed artifacts.
            package = by_filename.get(artifact.get("filename"), {})
            if (package.get("sha256") != artifact.get("sha256") or
                    package.get("bytes") != artifact.get("size_bytes")):
                errors.append(f"{name} artifact bytes differ from its original waiver receipt: {artifact.get('filename')}")
    return errors


def load_status(root, *, now=None):
    """Read docs/release/acceptance-status.json and evaluate the record it names.

    Returns (status, errors, record). errors is [] only for an unsubmitted development
    status or for an accepted claim backed by a clean record whose own status agrees.
    """
    import json

    status = json.loads((Path(root) / "docs" / "release" / "acceptance-status.json").read_text(encoding="utf-8"))
    state = status.get("status") if isinstance(status, dict) else None
    if state not in ACCEPTED_STATES:
        return status, assess_status(status), None
    relative = status.get("evidence_file")
    if not relative:
        return status, assess_status(status), None
    path = (Path(root) / str(relative)).resolve()
    if not path.is_file() or not path.is_relative_to(Path(root).resolve()):
        return status, assess_status(status, evidence_errors=["evidence file is missing"], evidence_path=path), None
    record = json.loads(path.read_text(encoding="utf-8"))
    evidence_errors = evaluate(record, now=now)
    if isinstance(record, dict):
        evidence_errors.extend(receipt_errors(record, root))
        import v101_provenance
        evidence_errors.extend(v101_provenance.evaluate(record, root))
    if isinstance(record, dict):
        if record.get("status") != state:
            evidence_errors.append("acceptance status must match the evidence record status")
        if record.get("version") != status.get("version"):
            evidence_errors.append("acceptance status version must match the evidence record version")
    return status, assess_status(status, evidence_errors=evidence_errors, evidence_path=path), record
