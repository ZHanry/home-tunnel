"""The candidate/stable channel source and its projected site files.

`distribution.json` is the only file to edit when promoting a release. The stable
snapshot under docs/release stays the published 9.0.0 record until that promotion
also replaces the stable channel and passes evidence evaluation.
"""

from __future__ import annotations

import hashlib
import json

import v10_evidence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ("hub", "server", "client", "android")
STABLE_10_SHA256 = "c7273a48c2b0acd66c3ef95871364e32a0bb385aed937c42dfe64e40722b9098"
ANCHOR_SHA256 = "9edd66e01ccabfd15c6c502eac749334fb0354fb87209f74cb73415c3366a8fb"
REQUIRED_UNVERIFIED = {
    "secure-desktop",
    "system-audio",
    "bidirectional-file-acceptance",
    "10.0.0-stable-downloads",
}
# Channel acceptance_status -> the evidence record status it must match.
PROMOTED_ACCEPTANCE = {"accepted": "passed", "accepted_with_waivers": "accepted_with_waivers"}


def load(root=ROOT):
    return json.loads((root / "distribution.json").read_text(encoding="utf-8"))


def dump(path: Path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _anchor_present(stable):
    for component in stable.get("components", {}).values():
        for package in component.get("downloads", []) or []:
            if package.get("sha256") == ANCHOR_SHA256 and package.get("filename") == "HomeTunnel-Setup-9.0.0-x64.exe":
                return True
    return False


def validate_distribution(dist, *, root=ROOT, evidence_errors=None, evidence_record=None):
    errors = []

    def bad(message):
        errors.append(message)

    if not isinstance(dist, dict) or dist.get("schema_version") != 1 or dist.get("product") != "Home Tunnel":
        bad("distribution identity is wrong")
    if dist.get("source_of_truth") != "distribution.json":
        bad("distribution.json must remain the only channel source")
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    if dist.get("development_line") != version or not v10_evidence.component_versions(version):
        bad("development_line must match VERSION and a supported release line")
    channels = dist.get("channels")
    if not isinstance(channels, dict) or set(channels) != {"stable", "candidate"}:
        bad("stable and candidate channels are both required")
        return errors
    stable = channels["stable"]
    candidate = channels["candidate"]
    frozen_path = root / "docs" / "release" / "stable-9.0.0.json"
    if not frozen_path.is_file():
        bad("published 9.0.0 snapshot is missing")
        return errors
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    if frozen.get("version") != "9.0.0" or frozen.get("stage") != "stable" or not _anchor_present(frozen):
        bad("published 9.0.0 snapshot lost its installer anchor")
    if not isinstance(stable, dict) or not isinstance(candidate, dict):
        bad("stable and candidate must be objects")
        return errors
    # Keep historical bytes immutable when a later line is promoted.
    if version == "10.1.0":
        previous_path = root / "docs" / "release" / "stable-10.0.0.json"
        if not previous_path.is_file():
            bad("published 10.0.0 snapshot is missing")
        else:
            previous = json.loads(previous_path.read_text(encoding="utf-8"))
            if hashlib.sha256(previous_path.read_bytes()).hexdigest() != STABLE_10_SHA256:
                bad("published 10.0.0 snapshot bytes changed")
            if (previous.get("version") != "10.0.0" or previous.get("stage") != "stable" or
                    previous.get("components", {}).get("client", {}).get("release_revision") != "5eb6768f0d21a842c01d66d3d979a4f935a2ed61"):
                bad("published 10.0.0 snapshot lost its client identity")
    promotion = candidate.get("promotion_status")
    if promotion == "not_promoted":
        if stable != frozen:
            bad("stable channel must stay on the published 9.0.0 snapshot until promotion")
        if candidate.get("version") != version or candidate.get("stage") != "development":
            bad("candidate must match the development line")
        if candidate.get("downloads_published") is not False or candidate.get("acceptance_status") != "pending":
            bad("unpromoted candidate cannot publish downloads or claim acceptance")
        if candidate.get("prerelease") is not False or candidate.get("tag") is not None:
            bad("unpromoted candidate must not look like a release tag")
        if "https://" in json.dumps(candidate) or "http://" in json.dumps(candidate):
            bad("candidate channel must not contain URLs")
        components = candidate.get("components") if isinstance(candidate.get("components"), dict) else {}
        for name in COMPONENTS:
            component = components.get(name) if isinstance(components.get(name), dict) else {}
            expected_repo = frozen.get("components", {}).get(name, {}).get("repository")
            if component.get("repository") != expected_repo or component.get("version") != v10_evidence.component_versions(version).get(name):
                bad(f"candidate repository drifted: {name}")
            if component.get("source_sha") is not None or component.get("artifacts") != []:
                bad(f"candidate {name} must not invent a source SHA or artifacts")
        contract = candidate.get("contract") if isinstance(candidate.get("contract"), dict) else {}
        if contract.get("frozen") is not False or contract.get("planned_ref") != "api-v1.4.0" or contract.get("current_stable_ref") != "api-v1.3.0":
            bad("api-v1.4.0 must stay unfrozen and distinct from stable api-v1.3.0")
        if candidate.get("frp") != "0.70.1" or stable.get("upstream", {}).get("frp") != "0.70.1":
            bad("FRP must remain 0.70.1")
        signing = candidate.get("signing") if isinstance(candidate.get("signing"), dict) else {}
        if signing.get("windows") != "unsigned-no-certificate-configured" or signing.get("macos") != "unsigned-no-certificate-configured":
            bad("desktop signing status must stay unsigned until a real certificate exists")
        if signing.get("android_certificate_sha256") != stable.get("signing", {}).get("android_certificate_sha256"):
            bad("Android certificate identity drifted")
        missing = REQUIRED_UNVERIFIED - set(candidate.get("not_verified") or [])
        if missing:
            bad("candidate is missing explicit not-verified marks: " + ", ".join(sorted(missing)))
        if evidence_errors:
            bad("evidence errors were supplied while the candidate is not promoted")
        return errors
    if promotion == "promoted":
        accepted = candidate.get("acceptance_status")
        if accepted not in PROMOTED_ACCEPTANCE or candidate.get("downloads_published") is not True:
            bad("promotion requires accepted evidence and published downloads")
        if candidate.get("version") != version:
            bad("promoted candidate must match the development line")
        if stable.get("version") != version or stable.get("stage") != "stable":
            bad("promotion must move the same version into the stable channel")
        if candidate.get("tag") != f"v{version}" or candidate.get("prerelease") is not False:
            bad("promoted candidate must name its stable tag")
        if candidate.get("frp") != "0.70.1" or stable.get("upstream", {}).get("frp") != "0.70.1":
            bad("FRP must remain 0.70.1")
        if stable.get("signing", {}).get("android_certificate_sha256") != frozen.get("signing", {}).get("android_certificate_sha256"):
            bad("Android certificate identity drifted")
        if evidence_errors is None or evidence_record is None:
            bad("promotion is fail-closed without an evidence evaluation")
            return errors
        if evidence_errors:
            bad("promotion evidence failed: " + "; ".join(evidence_errors))
        if PROMOTED_ACCEPTANCE.get(accepted) != evidence_record.get("status"):
            bad("candidate acceptance_status differs from the evidence record")
        # Every waiver in the record must be disclosed on the channel; a waiver is never a pass.
        waived = sorted(name for name, _ in v10_evidence.waived_items(evidence_record))
        if sorted(candidate.get("waived") or []) != waived:
            bad("promoted channel must list exactly the waived gates of the evidence record")
        if accepted == "accepted_with_waivers" and not waived:
            bad("accepted_with_waivers requires at least one waived gate")
        if evidence_record.get("version") != version:
            bad("promoted version differs from the accepted evidence")
        if stable.get("contract_ref") != (evidence_record.get("contract") or {}).get("ref"):
            bad("stable contract differs from the accepted evidence")
        for field, evidence_field in (("contract_revision", "revision"), ("contract_sha256", "sha256")):
            if stable.get(field) != (evidence_record.get("contract") or {}).get(evidence_field):
                bad("stable contract bytes differ from the accepted evidence")
        for platform in ("windows", "macos"):
            if stable.get("signing", {}).get(platform) != "unsigned-no-certificate-configured":
                bad("desktop signing status must stay unsigned until a real certificate exists")
        expected_combination = {name: v10_evidence.component_versions(version).get(name) for name in ("server", "client", "android")}
        expected_combination["agent"] = v10_evidence.component_versions(version).get("client")
        if stable.get("tested_combination") != expected_combination:
            bad("stable combination differs from the accepted component versions")
        record_sources = evidence_record.get("sources") or {}
        record_components = evidence_record.get("components") or {}
        components = stable.get("components") if isinstance(stable.get("components"), dict) else {}
        if set(components) != set(COMPONENTS):
            bad("stable channel needs all four components")
        for name in COMPONENTS:
            component = components.get(name) if isinstance(components.get(name), dict) else {}
            component_version = v10_evidence.component_versions(version).get(name)
            if (component.get("version") != component_version or component.get("tag") != f"v{component_version}"
                    or component.get("prerelease") is not False
                    or component.get("repository") != v10_evidence.REPOSITORIES[name]):
                bad(f"stable component identity differs: {name}")
            if (record_components.get(name) or {}).get("version") != component_version:
                bad(f"stable {name} version differs from the accepted component")
            repository = v10_evidence.REPOSITORIES[name]
            if component.get("release_url") != f"https://github.com/{repository}/releases/tag/v{component_version}":
                bad(f"stable {name} release URL differs from its identity")
            proposed = (candidate.get("components") or {}).get(name) or {}
            accepted_component = record_components.get(name) or {}
            if (proposed.get("repository") != repository or proposed.get("version") != component_version or
                    proposed.get("source_sha") != (record_sources.get(name) or {}).get("sha") or
                    proposed.get("artifacts") != accepted_component.get("artifacts")):
                bad(f"candidate {name} differs from its accepted source and artifacts")
            # The hub manifest omits its own revision to avoid a self-reference.
            if name != "hub" and component.get("release_revision") != (record_sources.get(name) or {}).get("sha"):
                bad(f"stable {name} revision differs from the accepted source")
            sealed = {item.get("filename"): item for item in (record_components.get(name) or {}).get("artifacts") or []}
            if version == "10.1.0" and name != "hub":
                filenames = [item.get("filename") for item in component.get("downloads", [])]
                if (len(filenames) != len(set(filenames)) or set(filenames) != set(sealed)
                        or set(filenames) != v10_evidence.V101_ARTIFACT_NAMES[name]):
                    bad(f"stable {name} must preserve the exact complete accepted download set")
            for item in component.get("downloads", []) or []:
                if item.get("url") != f"https://github.com/{repository}/releases/download/v{component_version}/{item.get('filename')}":
                    bad(f"stable {name} download URL differs from its identity")
                accepted_item = sealed.get(item.get("filename"), {})
                if (accepted_item.get("sha256") != item.get("sha256") or
                        accepted_item.get("size_bytes") != item.get("size_bytes")):
                    bad(f"stable {name} download is not an accepted artifact: {item.get('filename')}")
        return errors
    bad("unknown promotion_status")
    return errors


def projected_files(dist):
    return {
        "releases.json": dist["channels"]["stable"],
        "docs/site/releases.json": dist["channels"]["stable"],
        "docs/site/candidate.json": dist["channels"]["candidate"],
    }


def projection_errors(dist, *, root=ROOT):
    errors = []
    for relative, expected in projected_files(dist).items():
        path = root / relative
        if not path.is_file():
            errors.append(f"missing projected file {relative}")
            continue
        actual = json.loads(path.read_text(encoding="utf-8"))
        if actual != expected:
            errors.append(f"{relative} drifted from distribution.json")
    return errors


def project(root=ROOT):
    dist = load(root)
    if dist.get("channels", {}).get("candidate", {}).get("promotion_status") == "promoted":
        import v10_evidence

        _status, status_errors, record = v10_evidence.load_status(root)
        errors = validate_distribution(dist, root=root, evidence_errors=status_errors, evidence_record=record)
    else:
        errors = validate_distribution(dist, root=root)
    if errors:
        raise ValueError("\n".join(errors))
    for relative, value in projected_files(dist).items():
        dump(root / relative, value)
    return dist
