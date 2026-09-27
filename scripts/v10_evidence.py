"""Fail-closed checks for a Home Tunnel 10.0.0 aggregate candidate record.

Shape and internal consistency only. A clean result is not VM acceptance,
UI approval, or proof that the recorded commits exist. Missing, unrun, stale,
mismatched, and fabricated records fail.
"""

from __future__ import annotations

import hashlib
import re
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
VERSION = "10.0.0"
CONTRACT_REF = "api-v1.4.0"
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
    if record.get("version") != VERSION or record.get("stage") != "candidate":
        bad("evidence must describe the 10.0.0 candidate")
    frozen_at = parse_time(record.get("source_frozen_at"))
    if frozen_at is None:
        bad("source_frozen_at must be a timezone-aware timestamp")
    if record.get("frp") != FRP:
        bad("FRP must stay at its independent 0.70.1 identity")

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
    if len(shas) == 4 and len(set(shas)) != 4:
        bad("the four source SHAs must be distinct commits")

    contract = record.get("contract") if isinstance(record.get("contract"), dict) else {}
    if contract.get("ref") != CONTRACT_REF or contract.get("immutable") is not True:
        bad("immutable api-v1.4.0 contract identity is required")
    if SHA40.fullmatch(str(contract.get("revision", ""))) is None or bad_digest(contract.get("sha256")):
        bad("contract revision and digest are required")

    components = record.get("components") if isinstance(record.get("components"), dict) else {}
    if set(components) != set(COMPONENTS):
        bad("all four component artifact sets are required")
    artifacts = {}
    for name in COMPONENTS:
        component = components.get(name) if isinstance(components.get(name), dict) else {}
        expected_sha = (sources.get(name) or {}).get("sha") if isinstance(sources.get(name), dict) else None
        if component.get("version") != VERSION or component.get("source_sha") != expected_sha:
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
    hub_sha = (sources.get("hub") or {}).get("sha") if isinstance(sources.get("hub"), dict) else None
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
        if observed is None or (frozen_at is not None and observed < frozen_at):
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
        if name == "active_2h" and (type(gate.get("duration_seconds")) is not int or gate["duration_seconds"] < 7200):
            bad("active_2h duration was not met")
        if name == "online_24h" and (type(gate.get("duration_seconds")) is not int or gate["duration_seconds"] < 86400):
            bad("online_24h duration was not met")
        if name == "input_release_2s" and (type(gate.get("release_ms")) is not int or not 0 <= gate["release_ms"] <= 2000):
            bad("input_release_2s was not measured within 2 seconds")
        if name == "network_restore_30s" and (type(gate.get("restore_seconds")) is not int or not 0 <= gate["restore_seconds"] <= 30):
            bad("network_restore_30s was not measured within 30 seconds")
        if name == "network_blocked_udp" and gate.get("payload_fallback") is not False:
            bad("blocked UDP must fail closed with no payload fallback")
        if name == "network_ipv6" and gate.get("address_family") != "ipv6":
            bad("network_ipv6 must record an IPv6 path")
        if name == "migration_9_to_10" and (gate.get("from_version") != "9.0.0" or gate.get("to_version") != VERSION):
            bad("migration gate must bind 9.0.0 to 10.0.0")
    return errors


def assess_status(status, *, evidence_errors=None, evidence_path=None):
    """Development may stay not_submitted. A pass claim fails closed without a clean real record."""
    if not isinstance(status, dict) or status.get("schema_version") != 1 or status.get("version") != VERSION:
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
    if state in {"passed", "accepted"}:
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
