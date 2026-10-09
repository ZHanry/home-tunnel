"""Download and verify the three actual candidate releases before publishing the hub."""
from pathlib import Path
import argparse
from contextlib import contextmanager
import hashlib
import json
import subprocess
import tempfile
import zipfile

import distribution


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


@contextmanager
def download_folder(directory, name, tag):
    if directory is None:
        with tempfile.TemporaryDirectory(prefix="homedesk-" + name + "-") as scratch:
            yield Path(scratch)
    else:
        folder = directory.resolve() / name / tag
        folder.mkdir(parents=True, exist_ok=True)
        yield folder


def verify(candidate, *, record=False, signatures=False, download_dir=None):
    verified = {}
    for name in ("server", "client", "android"):
        component = candidate["components"][name]
        repository, tag, revision = (component[key] for key in ("repository", "tag", "source_sha"))
        release = json.loads(run("gh", "api", f"repos/{repository}/releases/tags/{tag}"))
        if release["draft"] or release["prerelease"] != (candidate["version"] != "13.0.0") or release["tag_name"] != tag:
            raise SystemExit("Expected an actual release in the selected channel: " + name)
        ref = json.loads(run("gh", "api", f"repos/{repository}/git/ref/tags/{tag}"))["object"]
        while ref["type"] == "tag":
            ref = json.loads(run("gh", "api", f"repos/{repository}/git/tags/{ref['sha']}"))["object"]
        if ref["type"] != "commit" or ref["sha"] != revision:
            raise SystemExit("Immutable product tag differs from the selected source: " + name)
        assets = release["assets"]
        if len(assets) != distribution.attachment_counts(candidate['version'])[name]:
            raise SystemExit("Unexpected attachment count: " + name)
        with download_folder(download_dir, name, tag) as folder:
            command = ["gh", "release", "download", tag, "--repo", repository, "--dir", str(folder)]
            if download_dir is not None:
                # Cached files undergo the same verification as fresh downloads.
                command.append("--skip-existing")
            subprocess.run(command, check=True)
            entries = {}
            for asset in assets:
                filename = asset["name"]
                if Path(filename).name != filename or "\\" in filename:
                    raise SystemExit("Unsafe release filename")
                file = folder / filename
                checksum = digest(file)
                if file.stat().st_size != asset["size"] or asset.get("digest") not in (None, "sha256:" + checksum):
                    raise SystemExit("GitHub asset bytes differ from release metadata: " + filename)
                entries[filename] = {"filename": filename, "sha256": checksum,
                                     "size_bytes": file.stat().st_size, "url": asset["browser_download_url"]}
            sums = folder / "SHA256SUMS.txt"
            listed = {}
            for line in sums.read_text(encoding="utf8").splitlines():
                checksum, filename = line.split("  ", 1)
                if filename in listed or filename not in entries or entries[filename]["sha256"] != checksum:
                    raise SystemExit("Published SHA256SUMS disagrees with actual download bytes")
                listed[filename] = checksum
            if set(listed) != set(entries) - {"SHA256SUMS.txt"}:
                raise SystemExit("Checksum file must cover the complete attachment set")
            brand = 'NestLink' if candidate['version'] == distribution.NESTLINK_TARGET['hub'] else 'HomeDesk'
            materials = folder / f"{brand}-{name}-Materials-{component['version']}.zip"
            with zipfile.ZipFile(materials) as bundle:
                manifest_bytes = bundle.read("BUILD.json")
                manifest = json.loads(manifest_bytes)
                expected = {key: value["sha256"] for key, value in entries.items() if key not in (materials.name, sums.name)}
                if (manifest["revision"] != revision or manifest["component"] != name or manifest["version"] != component["version"]
                        or manifest["policy"] != "require_direct" or manifest["relay_enabled"] is not False
                        or manifest["deliverables"] != expected):
                    raise SystemExit("Signed build manifest does not describe these source and payload bytes")
                source = hashlib.sha256()
                with bundle.open("corresponding-source.zip") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        source.update(block)
                if source.hexdigest() != manifest["materials"]["corresponding-source.zip"]:
                    raise SystemExit("Corresponding source digest differs from its signed build manifest")
                if signatures:
                    (folder / "BUILD.json").write_bytes(manifest_bytes)
                    (folder / "BUILD.json.sigstore.json").write_bytes(bundle.read("BUILD.json.sigstore.json"))
                    subprocess.run(["cosign", "verify-blob", "--bundle", str(folder / "BUILD.json.sigstore.json"),
                                    "--certificate-identity", f"https://github.com/{repository}/.github/workflows/release.yml@refs/tags/{tag}",
                                    "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com", str(folder / "BUILD.json")], check=True)
            if candidate["version"] == "13.0.0":
                acceptance=manifest.get("acceptance",{})
                if (not isinstance(acceptance,dict) or acceptance.get("status")!="passed_reproducible"
                        or acceptance.get("component")!=name or acceptance.get("version")!="13.0.0"
                        or acceptance.get("source_revision")!=manifest.get("payload_source_revision")
                        or acceptance.get("deliverables")!=manifest["deliverables"]):
                    raise SystemExit("Current release must include actual reproducible acceptance: "+name)
            actual = sorted(entries.values(), key=lambda item: item["filename"])
            if record:
                component.update(published=True, release_url=release["html_url"], artifacts=actual)
            elif not component.get("published") or actual != component["artifacts"] or component["release_url"] != release["html_url"]:
                raise SystemExit("Distribution differs from the independently verified release: " + name)
            verified[name] = {"repository": repository, "tag": tag, "revision": revision,
                              "assets": actual, "source_manifest_verified": True, "sigstore_verified": signatures, "reproducible_acceptance_verified": candidate["version"] == "13.0.0"}
        print(name + ": exact candidate tag, actual download bytes, checksums and source verified")
    if record:
        candidate["downloads_published"] = True
    return verified


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", action="store_true", help="Record independently verified component bytes in distribution.json")
    parser.add_argument("--signatures", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--download-dir", type=Path, help="Keep downloaded assets for inspection; all verification checks still run")
    args = parser.parse_args()
    dist = distribution.load()
    errors = distribution.validate_distribution(dist)
    if errors:
        raise SystemExit("\n".join(errors))
    evidence = verify(dist["channels"]["candidate"], record=args.record, signatures=args.signatures, download_dir=args.download_dir)
    if args.record:
        distribution.dump(distribution.ROOT / "distribution.json", dist)
        distribution.project()
        import homedesk_downloads
        homedesk_downloads.project(dist["channels"]["candidate"])
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        distribution.dump(args.output, evidence)
