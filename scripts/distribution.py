"""The candidate/stable channel source and its projected site files.

`distribution.json` is the only file to edit when promoting a release. The stable
snapshot under docs/release stays the published 9.0.0 record until that promotion
also replaces the stable channel and passes evidence evaluation.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ("hub", "server", "client", "android")
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
    if dist.get("development_line") != version or version != "10.0.0":
        bad("development_line must match VERSION and stay 10.0.0 for this line")
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
    promotion = candidate.get("promotion_status") if isinstance(candidate, dict) else None
    if promotion == "not_promoted":
        if stable != frozen:
            bad("stable channel must stay on the published 9.0.0 snapshot until promotion")
        if candidate.get("version") != "10.0.0" or candidate.get("stage") != "development":
            bad("candidate must be 10.0.0 development")
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
            if component.get("repository") != expected_repo or component.get("version") != "10.0.0":
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
        version = candidate.get("version")
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
        import v10_evidence

        waived = sorted(name for name, _ in v10_evidence.waived_items(evidence_record))
        if sorted(candidate.get("waived") or []) != waived:
            bad("promoted channel must list exactly the waived gates of the evidence record")
        if accepted == "accepted_with_waivers" and not waived:
            bad("accepted_with_waivers requires at least one waived gate")
        record_sources = evidence_record.get("sources") or {}
        record_components = evidence_record.get("components") or {}
        components = stable.get("components") if isinstance(stable.get("components"), dict) else {}
        if set(components) != set(COMPONENTS):
            bad("stable channel needs all four components")
        for name in COMPONENTS:
            component = components.get(name) if isinstance(components.get(name), dict) else {}
            if component.get("version") != version or component.get("tag") != f"v{version}" or component.get("prerelease") is not False:
                bad(f"stable component identity differs: {name}")
            # The hub manifest omits its own revision to avoid a self-reference.
            if name != "hub" and component.get("release_revision") != (record_sources.get(name) or {}).get("sha"):
                bad(f"stable {name} revision differs from the accepted source")
            sealed = {item.get("filename"): item.get("sha256") for item in (record_components.get(name) or {}).get("artifacts") or []}
            for item in component.get("downloads", []) or []:
                if sealed.get(item.get("filename")) != item.get("sha256"):
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
