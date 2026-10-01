"""Byte and scope bindings for the explicitly supported 10.1 release evidence.

Historical records retain their original evaluator. This module does not infer
installed application, independent endpoint or network outage acceptance from a
single-machine worker probe.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

from v10_evidence import V101_ARTIFACT_NAMES

NATIVE_GATES = {"repeat_30", "active_2h", "input_release_2s"}
NATIVE_SCOPE = "sealed-windows-worker-single-machine-qa-host"


def evaluate(record, root):
    if record.get("version") != "10.1.0":
        return []
    errors = []
    root = Path(root).resolve()
    bindings = record.get("provenance", {})

    def read(name):
        reference = bindings.get(name, {})
        path = (root / str(reference.get("path", ""))).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            errors.append(f"{name} provenance is missing or outside the repository")
            return {}
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != reference.get("sha256"):
            errors.append(f"{name} provenance digest differs")
            return {}
        try:
            value = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            errors.append(f"{name} provenance is not JSON")
            return {}
        if not isinstance(value, dict):
            errors.append(f"{name} provenance must be an object")
            return {}
        return value

    candidate = read("client_candidate")
    download = read("client_candidate_download")
    worker = read("worker_provenance")
    native = read("native_report")
    server = read("server_manifest")
    sources = record.get("sources", {})
    components = record.get("components", {})
    for name, expected in V101_ARTIFACT_NAMES.items():
        items = components.get(name, {}).get("artifacts", [])
        names = [item.get("filename") for item in items]
        if len(names) != len(expected) or set(names) != expected:
            errors.append(f"{name} must preserve the exact complete 10.1 distribution artifact set")
    if set(candidate.get("packages", {})) != V101_ARTIFACT_NAMES["client"]:
        errors.append("sealed client candidate package set differs")
    previous_path = root / "docs/release/stable-10.0.0.json"
    if not previous_path.is_file():
        errors.append("Android requires the immutable 10.0.0 distribution snapshot")
    else:
        previous = json.loads(previous_path.read_text())["components"]["android"]
        if (sources.get("android", {}).get("sha") != previous.get("release_revision") or
                components.get("android", {}).get("version") != previous.get("version") or
                components.get("android", {}).get("artifacts") != previous.get("downloads")):
            errors.append("Android must preserve its exact historical 10.0.0 source and package identities")
    client_sha = sources.get("client", {}).get("sha")
    server_sha = sources.get("server", {}).get("sha")
    if (candidate.get("revision") != client_sha or candidate.get("version") != "10.1.0"
            or candidate.get("source_modified") is not False
            or candidate.get("server", {}).get("revision") != server_sha):
        errors.append("client candidate provenance source differs")
    if (download.get("source_revision") != client_sha or
            download.get("candidate_sha256") != bindings.get("client_candidate", {}).get("sha256") or
            download.get("signatures_verified") is not True or download.get("run_attestations_verified") is not True or
            str(download.get("run_id")) != str(candidate.get("build", {}).get("run_id"))):
        errors.append("client download must bind the attested candidate and build run")
    for artifact in components.get("client", {}).get("artifacts", []):
        sealed = candidate.get("packages", {}).get(artifact.get("filename"), {})
        if sealed.get("sha256") != artifact.get("sha256") or sealed.get("bytes") != artifact.get("size_bytes"):
            errors.append("client package differs from the sealed candidate")
    worker_ref = bindings.get("worker_provenance", {})
    sealed_worker = candidate.get("files", {}).get("remote-host-provenance.json", {})
    if (sealed_worker.get("sha256") != worker_ref.get("sha256") or
            worker.get("repository_revision") != client_sha or worker.get("server", {}).get("revision") != server_sha or
            worker.get("build", {}).get("source_modified") is not False):
        errors.append("worker provenance differs from the sealed candidate")
    if (server.get("revision") != server_sha or server.get("version") != "10.1.0" or
            server.get("repository") != sources.get("server", {}).get("repository")):
        errors.append("server manifest source differs")
    if (native.get("status") != "passed" or native.get("release_eligible") is not True or
            native.get("worker_sha256") != worker.get("worker", {}).get("sha256")):
        errors.append("native report does not bind the accepted original worker")
    for component in ("client", "server"):
        source = native.get("sources", {}).get(component, {})
        if source.get("commit") != sources.get(component, {}).get("sha") or source.get("modified") is not False:
            errors.append(f"native report {component} source differs")
    if not native.get("limitations") or "same machine" not in native.get("scope", ""):
        errors.append("native report must retain its bounded topology and limitations")
    if record.get("ui_coverage", {}).get("status") != "waived":
        errors.append("10.1 UI review requires its own byte-bound evidence; the native worker report cannot establish it")
    stability = native.get("stability", {})
    expected = {
        "repeat_30": {"attempts": len(stability.get("sessions", [])), "successes": stability.get("actual_connections")},
        "active_2h": {"duration_seconds": stability.get("active_window", {}).get("actual_active_seconds")},
        "input_release_2s": {"release_ms": native.get("input", {}).get("heartbeat_watchdog", {}).get("release_ms")},
    }
    for name, gate in record.get("gates", {}).items():
        if gate.get("status") != "passed":
            continue
        if name not in NATIVE_GATES:
            errors.append(f"{name} requires its own 10.1 runtime evidence; the worker probe cannot establish it")
            continue
        package = "HomeTunnel-Windows-10.1.0-x64.zip"
        if (gate.get("artifact_filename") != package or
                gate.get("artifact_sha256") != candidate.get("packages", {}).get(package, {}).get("sha256")):
            errors.append(f"{name} must bind the sealed Windows ZIP, not another platform's package")
        if (gate.get("scope") != NATIVE_SCOPE or gate.get("source_components") != ["client", "server"] or
                gate.get("evidence_sha256") != bindings.get("native_report", {}).get("sha256") or
                gate.get("observed_at") != native.get("finished_at")):
            errors.append(f"{name} native evidence scope, timestamp or digest differs")
        if any(gate.get(key) != value for key, value in expected[name].items()):
            errors.append(f"{name} measured fields differ from the native report")
        if name == "repeat_30" and any(
                session.get("signed_pairing") is not True or session.get("live_media") is not True or
                session.get("trusted_input") is not True for session in stability.get("sessions", [])):
            errors.append("repeat_30 must retain every signed, live, input-verified session")
        if name == "active_2h" and stability.get("active_window", {}).get("status") != "passed":
            errors.append("active_2h active window did not pass")
        if name == "input_release_2s" and native.get("input", {}).get("heartbeat_watchdog", {}).get("passed") is not True:
            errors.append("input_release_2s watchdog did not pass")
    # The documentation commit precedes the aggregate manifest commit, avoiding
    # self-reference without substituting older document bytes.
    hub = sources.get("hub", {})
    for artifact in components.get("hub", {}).get("artifacts", []):
        filename = artifact.get("filename")
        if filename not in {"DOWNLOADS.md", "RELEASE_NOTES.md"}:
            errors.append("hub evidence must bind the two release documents")
            continue
        result = subprocess.run(["git", "show", f"{hub.get('sha')}:docs/{filename}"], cwd=root, capture_output=True, check=False)
        if result.returncode or hashlib.sha256(result.stdout).hexdigest() != artifact.get("sha256") or len(result.stdout) != artifact.get("size_bytes"):
            errors.append(f"hub {filename} differs from its immutable documentation source")
    return errors
