"""Validate a real 8.0 candidate manifest without changing stable downloads."""
import argparse
import json
import re
import hashlib
import subprocess
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

REPOSITORIES = {
    "hub": "ZHanry/home-tunnel",
    "server": "ZHanry/home-tunnel-server",
    "client": "ZHanry/home-tunnel-client",
    "android": "ZHanry/home-tunnel-android",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(value):
    require(value.get("schema_version") == 1, "Unknown candidate manifest schema")
    version = value.get("version", "")
    require(re.fullmatch(r"8\.0\.0-rc\.[1-9][0-9]*", version), "Expected 8.0.0-rc.N")
    require(value.get("stage") == "prerelease", "Candidate must be a prerelease")
    require(value.get("latest") is False, "Candidate cannot replace the stable channel")
    require(set(value.get("components", {})) == set(REPOSITORIES), "All four components are required")
    contract = value.get("contract", {})
    require(re.fullmatch(r"api-v1\.2\.0(?:-rc\.[1-9][0-9]*)?", contract.get("ref", "")), "Invalid contract ref")
    require(re.fullmatch(r"[0-9a-f]{40}", contract.get("revision", "")), "Contract revision is required")
    require(re.fullmatch(r"[0-9a-f]{64}", contract.get("sha256", "")), "Contract checksum is required")
    for name, repository in REPOSITORIES.items():
        component = value["components"][name]
        require(component.get("repository") == repository, f"Unexpected {name} repository")
        require(component.get("tag") == "v" + version, f"Mismatched {name} tag")
        require(component.get("prerelease") is True, f"{name} is not a prerelease")
        require(re.fullmatch(r"[0-9a-f]{40}", component.get("revision", "")), f"Missing {name} revision")
        base = f"https://github.com/{repository}/releases/"
        require(component.get("release_url") == base + "tag/v" + version, f"Invalid {name} release URL")
        assets = component.get("assets", [])
        require(isinstance(assets, list) and assets, f"Missing {name} release assets")
        names = set()
        for asset in assets:
            filename = asset.get("filename", "")
            require(filename and not any(c in filename for c in '/\\\r\n') and filename not in (".", ".."), "Unsafe asset name")
            require(filename not in names, "Duplicate asset name")
            names.add(filename)
            require(asset.get("url") == base + "download/v" + version + "/" + quote(filename), "Asset must use the exact candidate tag")
            require(re.fullmatch(r"[0-9a-f]{64}", asset.get("sha256", "")), "Missing asset checksum")
            require(type(asset.get("size_bytes")) is int and asset["size_bytes"] > 0, "Missing asset size")
    evidence = value.get("verification", {})
    require(evidence.get("automated") == "passed", "Automated safety checks must pass")
    require(evidence.get("windows_browser_udp_session") == "passed", "A real Windows/browser UDP media and input session is required before a candidate release")
    require(evidence.get("physical") in ("passed", "not_verified", "partial"), "Physical verification status is required")
    limitations = evidence.get("limitations")
    require(isinstance(limitations, list) and all(isinstance(item, str) and item.strip() for item in limitations), "Limitations must be explicit text")
    if evidence.get("physical") != "passed":
        require(bool(limitations), "Unverified platforms must be disclosed")
    require(evidence.get("reports"), "Versioned verification report assets are required")
    for report in evidence["reports"]:
        require(isinstance(report, dict), "Report identity must be an object")
        require(re.fullmatch(r"[0-9a-f]{64}", report.get("sha256", "")), "Missing report checksum")
        require(any(report.get("url") == asset["url"] and report["sha256"] == asset["sha256"] for component in value["components"].values() for asset in component["assets"]), "Reports must be sealed release assets")
    return version


def github(path):
    result = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def tag_revision(repository, tag):
    target = github(f"repos/{repository}/git/ref/tags/{quote(tag, safe='')}")["object"]
    for _ in range(5):
        if target["type"] == "commit":
            return target["sha"]
        require(target["type"] == "tag", "Tag does not resolve to a commit")
        target = github(f"repos/{repository}/git/tags/{target['sha']}")["object"]
    raise ValueError("Tag chain exceeds limit")


def download_hash(url, expected_size=None):
    digest, size = hashlib.sha256(), 0
    with urlopen(url, timeout=60) as response:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            require(expected_size is None or size <= expected_size, "Downloaded asset exceeds sealed size")
            digest.update(chunk)
    require(expected_size is None or size == expected_size, "Downloaded asset size differs")
    return digest.hexdigest()


def verify_remote(value):
    """Resolve immutable GitHub identities and hash the actual published bytes."""
    validate(value)
    contract = value["contract"]
    require(tag_revision(REPOSITORIES["server"], contract["ref"]) == contract["revision"], "Contract tag revision differs")
    contract_url = f"https://raw.githubusercontent.com/{REPOSITORIES['server']}/{contract['revision']}/contracts/openapi.v1.json"
    require(download_hash(contract_url) == contract["sha256"], "Published contract checksum differs")
    for name, component in value["components"].items():
        repository, tag = component["repository"], component["tag"]
        require(tag_revision(repository, tag) == component["revision"], f"{name} tag revision differs")
        release = github(f"repos/{repository}/releases/tags/{quote(tag, safe='')}")
        require(release["prerelease"] is True and release["draft"] is False, f"{name} must be a published prerelease")
        assets = {asset["name"]: asset for asset in release["assets"]}
        for sealed in component["assets"]:
            asset = assets.get(sealed["filename"])
            require(asset is not None and asset["size"] == sealed["size_bytes"] and asset["browser_download_url"] == sealed["url"], "Release asset identity differs")
            require(download_hash(sealed["url"], sealed["size_bytes"]) == sealed["sha256"], f"{name}/{sealed['filename']} checksum differs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--verify-remote", action="store_true", help="Resolve GitHub tags and download/hash every real asset (requires gh login)")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    version = validate(manifest)
    if args.verify_remote:
        verify_remote(manifest)
    print(f"Candidate {version}: {'published bytes verified' if args.verify_remote else 'manifest structure passed; published bytes not checked'}")


if __name__ == "__main__":
    main()
