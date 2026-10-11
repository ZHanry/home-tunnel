"""Seal versioned nestlink products with source, verified payloads and release evidence."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def run(*args, capture=False, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip() if capture else subprocess.run(args, cwd=cwd, check=True)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def version():
    if (ROOT / "compatibility.json").is_file():
        return json.loads((ROOT / "compatibility.json").read_text(encoding="utf8"))["version"]
    return (ROOT / "VERSION").read_text(encoding="utf8").strip()


def is_stable_release(value):
    return re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", value) is not None


def candidate_metadata():
    value = version()
    tag = os.environ.get("GITHUB_REF_NAME", "")
    stable = is_stable_release(value)
    candidate = re.fullmatch(r"\d+\.\d+\.\d+-(?:RC[1-9]\d*|rc\.[1-9]\d*)", value)
    if (not stable and not candidate) or tag != "v" + value:
        raise SystemExit("A matching supported product tag is required")
    revision = run("git", "rev-parse", "HEAD", capture=True)
    if revision != os.environ["GITHUB_SHA"]:
        raise SystemExit("Workflow checkout does not match the release revision")
    run("git", "fetch", "origin", "main")
    run("git", "merge-base", "--is-ancestor", revision, "origin/main")
    repository = os.environ["GITHUB_REPOSITORY"]
    checks = json.loads(run("gh", "api", f"repos/{repository}/commits/{revision}/check-runs?per_page=100", capture=True))["check_runs"]
    gates = [c for c in checks if c["name"] == "Quality Gate" and c.get("app", {}).get("slug") == "github-actions"]
    if not gates or max(gates, key=lambda c: c["id"]).get("conclusion") != "success":
        raise SystemExit("The exact main commit must pass Quality Gate before publication")
    runs = json.loads(run("gh", "api", f"repos/{repository}/actions/runs?head_sha={revision}&per_page=100", capture=True))["workflow_runs"]
    for name in ("CodeQL", "Secret scan"):
        matches = [r for r in runs if r["name"] == name]
        if not matches or max(matches, key=lambda r: r["id"]).get("conclusion") != "success":
            raise SystemExit(f"The exact commit must pass {name}")
    component = json.loads((ROOT/"compatibility.json").read_text())["component"] if (ROOT/"compatibility.json").is_file() else "hub"
    acceptance = validate_acceptance(component, revision) if stable else None
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as output:
        output.write(f"version={value}\nstable={str(stable).lower()}\n")
        cis = [r for r in runs if r["name"] in ("Client CI", "Android CI") and r.get("conclusion") == "success"]
        if acceptance and component in ("client", "android", "server"):
            selected_run = acceptance["build_run"]
            selected = json.loads(run("gh", "api", f"repos/{repository}/actions/runs/{selected_run}", capture=True))
            if selected.get("conclusion") != "success" or selected.get("head_sha") != acceptance["source_revision"]:
                raise SystemExit("The accepted payload must come from a successful exact-source CI run")
            output.write(f"build-run={selected_run}\n")
        elif cis:
            output.write(f"build-run={max(cis, key=lambda r:r['id'])['id']}\n")


REQUIRED_SCENARIOS = {
    "client": {"installed-native-p2p", "browser-screen-input", "account-revocation", "managed-tunnels"},
    "server": {"account-migration", "browser-authorization", "native-authorization", "managed-tunnels"},
    "android": {"installed-universal-apk", "account-login-management", "native-remote-control"},
    "hub": {"component-bytes-signatures", "current-ui-site"},
}

def validate_acceptance(component, revision, payload=None):
    value = version()
    path = ROOT / f"docs/release/acceptance-{value}.json"
    if not path.is_file():
        raise SystemExit(f"{value} requires recorded reproducible acceptance before publication")
    record = json.loads(path.read_text(encoding="utf8"))
    if record.get("version") != value or record.get("component") != component or record.get("status") != "passed_reproducible":
        raise SystemExit("Release acceptance identity or status is invalid")
    source = record.get("source_revision", "")
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise SystemExit("Acceptance needs the tested source commit")
    run("git", "merge-base", "--is-ancestor", source, revision)
    changes = run("git", "diff", "--name-only", source, revision, capture=True).splitlines()
    allowed = {f"docs/release/acceptance-{value}.json", "docs/HOMEDESK_RELEASE.md", "docs/RELEASE_NOTES.md"}
    if any(name not in allowed for name in changes):
        raise SystemExit("Runtime source changed after acceptance: " + ", ".join(name for name in changes if name not in allowed))
    scenarios = {item.get("name") for item in record.get("scenarios", []) if item.get("status") == "passed" and item.get("evidence")}
    if not REQUIRED_SCENARIOS[component] <= scenarios:
        raise SystemExit("Required reproducible integration scenarios did not pass")
    if not {"physical-android-device", "carrier-network-nat", "long-duration-media"} <= set(record.get("unverified", [])):
        raise SystemExit("The recorded scope must preserve the outstanding physical/network/media checks")
    if payload is not None:
        expected = record.get("deliverables", {})
        actual = {file.name: digest(file) for file in payload}
        if expected != actual:
            raise SystemExit("Release payload bytes differ from the actually accepted installers/APK/deployment")
    return record


def add_source(bundle, checkout, prefix="source/"):
    # Archive committed bytes, including each exact gitlink. Never package local secrets or ignored outputs.
    data = subprocess.check_output(["git", "archive", "--format=tar", "HEAD"], cwd=checkout)
    with tarfile.open(fileobj=io.BytesIO(data)) as source:
        for member in source:
            if member.isfile():
                entry = zipfile.ZipInfo(prefix + member.name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | member.mode) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(entry, source.extractfile(member).read())
            elif member.issym():
                entry = zipfile.ZipInfo(prefix + member.name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | member.mode) << 16
                bundle.writestr(entry, member.linkname)
    entries = subprocess.check_output(["git", "ls-files", "--stage", "-z"], cwd=checkout).decode().split("\0")
    for entry in filter(None, entries):
        metadata, path = entry.split("\t", 1)
        mode, revision, _ = metadata.split()
        if mode == "160000":
            nested = checkout / path
            if run("git", "rev-parse", "HEAD", capture=True, cwd=nested) != revision:
                raise SystemExit(f"Submodule revision mismatch: {path}")
            add_source(bundle, nested, prefix + path + "/")


def pack(args):
    value = version()
    revision = run("git", "rev-parse", "HEAD", capture=True)
    if run("git", "status", "--porcelain", capture=True):
        raise SystemExit("Release source must be committed and clean")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise SystemExit("Use an empty output directory; existing sealed assets are never overwritten")
    maximum = {"server": 3, "client": 5, "android": 3, "hub": 2}[args.component]
    if len(args.select) + 2 > maximum or len(set(args.select)) != len(args.select):
        raise SystemExit("Too many or duplicate release attachments")
    selected = []
    for name in args.select:
        source = args.input / name
        if Path(name).name != name or not source.is_file() or source.stat().st_size == 0:
            raise SystemExit(f"Missing deliverable: {name}")
        shutil.copyfile(source, output / name)
        selected.append(output / name)
    acceptance = validate_acceptance(args.component, revision, selected) if is_stable_release(value) else None
    # The hub's only package already contains its distribution and corresponding source.
    material_name = f"NestLink-Distribution-{value}.zip" if args.component == "hub" else f"NestLink-{args.component}-Materials-{value}.zip"
    material = output / material_name
    staging = ROOT / "outputs" / "release-materials"
    staging.mkdir(parents=True, exist_ok=True)
    source_archive = staging / "corresponding-source.zip"
    with zipfile.ZipFile(source_archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        add_source(bundle, ROOT)
    payload = {source_archive.name: digest(source_archive)}
    evidence_files = []
    if args.evidence:
        for path in sorted(args.evidence.rglob("*")):
            if path.is_file() and not path.is_symlink():
                name = "evidence/" + path.relative_to(args.evidence).as_posix()
                payload[name] = digest(path)
                evidence_files.append((path, name))
    manifest = {
        "component": args.component, "version": value, "revision": revision,
        "repository": os.environ.get("GITHUB_REPOSITORY", run("git", "remote", "get-url", "origin", capture=True)),
        "policy": "require_direct", "relay_enabled": False,
        "deliverables": {p.name: digest(p) for p in selected}, "materials": payload,
        "build_run": os.environ.get("GITHUB_RUN_ID", "local"),
        "acceptance": acceptance or "candidate: cross-network NAT, sustained media and physical-device acceptance pending",
        "payload_source_revision": acceptance["source_revision"] if acceptance else revision,
    }
    manifest_path = staging / "BUILD.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    signature = staging / "BUILD.json.sigstore.json"
    if os.environ.get("GITHUB_ACTIONS") == "true":
        run("cosign", "sign-blob", "--yes", "--bundle", str(signature), str(manifest_path))
    with zipfile.ZipFile(material, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        bundle.write(source_archive, source_archive.name)
        bundle.write(manifest_path, manifest_path.name)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            bundle.write(signature, signature.name)
        for path, name in evidence_files:
            bundle.write(path, name)
        bundle.writestr("VERIFY.txt", "Verify BUILD.json with cosign verify-blob and its GitHub workflow identity, then check the listed SHA-256 values. SHA256SUMS.txt covers every public ZIP/installer/APK/deployment file. Corresponding source contains exact submodule bytes and build recipes.\n")
    selected.append(material)
    if len(selected) + 1 > maximum:
        raise SystemExit("Too many release attachments")
    (output / "SHA256SUMS.txt").write_text("".join(f"{digest(p)}  {p.name}\n" for p in sorted(selected)), encoding="utf8")
    print(json.dumps({"component": args.component, "revision": revision, "assets": [p.name for p in output.iterdir()]}))



def verify_server(args):
    """Verify and retag the accepted image digests; never rebuild stable runtime bytes."""
    value = version()
    revision = run("git", "rev-parse", "HEAD", capture=True)
    acceptance = validate_acceptance("server", revision)
    repository = os.environ["GITHUB_REPOSITORY"]
    build = json.loads(run("gh", "api", f"repos/{repository}/actions/runs/{acceptance['build_run']}", capture=True))
    source = acceptance["source_revision"]
    if (build.get("conclusion") != "success" or build.get("head_sha") != source
            or build.get("event") != "workflow_dispatch" or build.get("path") != ".github/workflows/ci.yml"
            or build.get("head_branch") != "main"):
        raise SystemExit("Server candidate origin does not match the accepted CI run")
    directory = args.input.resolve()
    identity = f"https://github.com/{repository}/.github/workflows/server-candidate.yml@refs/heads/main"
    run("cosign", "verify-blob", "--bundle", str(directory/"SHA256SUMS.txt.sigstore.json"),
        "--certificate-identity", identity, "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com",
        str(directory/"SHA256SUMS.txt"))
    listed = set()
    for line in (directory/"SHA256SUMS.txt").read_text().splitlines():
        checksum, name = line.split("  ", 1)
        if Path(name).name != name or checksum != digest(directory/name):
            raise SystemExit("Accepted server candidate checksum mismatch")
        listed.add(name)
    actual = {p.name for p in directory.iterdir() if p.is_file()} - {"SHA256SUMS.txt", "SHA256SUMS.txt.sigstore.json"}
    if listed != actual:
        raise SystemExit("Unexpected or missing server candidate evidence")
    manifest = json.loads((directory/"release-manifest.json").read_text())
    if any(manifest.get(k) != v for k,v in {"revision":source,"version":value,"repository":repository,
            "component":"server","run_id":str(acceptance["build_run"]),"channel":"candidate"}.items()):
        raise SystemExit("Server candidate source identity is invalid")
    images = {}
    for name in ("control-center", "traffic-gateway"):
        record = json.loads((directory/f"image-{name}.json").read_text())
        if (record.get("image") != "ghcr.io/zhanry/home-tunnel-" + name or record.get("revision") != source
                or record.get("version") != value or record != {**record,"name":name}
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", record.get("digest", ""))):
            raise SystemExit("Server image identity is invalid")
        images[name] = {k:record[k] for k in ("image","digest","revision")}
        reference = record["image"] + "@" + record["digest"]
        if manifest.get("images", {}).get(name) != images[name] or reference not in (directory/"compose.release.yaml").read_text():
            raise SystemExit("Server deployment is not bound to accepted image digests")
        run("cosign", "verify", reference, "--certificate-identity", identity,
            "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com", capture=True)
    if images != acceptance.get("images"):
        raise SystemExit("Released images differ from the actual integration fixture")
    archive = directory / f"NestLink-Server-{value}.tar.gz"
    validate_acceptance("server", revision, [archive])
    for arch in ("amd64", "arm64"):
        smoke = json.loads((directory/f"server-smoke-{arch}.json").read_text())
        stun = json.loads((directory/f"stun-runtime-{arch}.json").read_text())
        if (smoke.get("status") != "passed" or stun.get("status") != "passed" or stun.get("repository_revision") != source
                or images["control-center"]["digest"] not in smoke.get("control_image", "")
                or images["traffic-gateway"]["digest"] not in smoke.get("gateway_image", "")):
            raise SystemExit("Server platform integration evidence differs from the accepted source")
    for image in images.values():
        run("docker", "buildx", "imagetools", "create", "--tag", image["image"] + ":" + value, image["image"]+"@"+image["digest"])
        resolved = run("docker", "buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", image["image"] + ":" + value, capture=True)
        if json.loads(resolved).get("digest") != image["digest"]:
            raise SystemExit("Stable image tag does not resolve to the accepted digest")


def publish(args):
    candidate_metadata()
    directory = args.input.resolve()
    listed = set()
    for line in (directory / "SHA256SUMS.txt").read_text().splitlines():
        checksum, name = line.split("  ", 1)
        if Path(name).name != name or checksum != digest(directory / name):
            raise SystemExit("Release checksum mismatch")
        listed.add(name)
    if {p.name for p in directory.iterdir()} != listed | {"SHA256SUMS.txt"}:
        raise SystemExit("Unexpected or missing release attachment")
    tag = "v" + version()
    repository = os.environ["GITHUB_REPOSITORY"]
    notes = ROOT / "docs" / "HOMEDESK_RELEASE.md"
    stable = is_stable_release(version())
    creation = ["gh", "release", "create", tag, "--repo", repository, "--verify-tag", "--draft",
                "--title", "NestLink " + version(), "--notes-file", str(notes)]
    if not stable: creation.append("--prerelease")
    run(*creation)
    run("gh", "release", "upload", tag, "--repo", repository, *[str(p) for p in sorted(directory.iterdir())])
    run("gh", "release", "edit", tag, "--repo", repository, "--draft=false",
        "--prerelease=false" if stable else "--prerelease=true", "--latest=true" if stable else "--latest=false")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["metadata", "pack", "publish", "verify-server"])
    parser.add_argument("--component", choices=["server", "client", "android", "hub"])
    parser.add_argument("--input", type=Path, default=ROOT / "products")
    parser.add_argument("--output", type=Path, default=ROOT / "release-public")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--select", action="append", default=[])
    args = parser.parse_args()
    if args.operation == "metadata":
        candidate_metadata()
    elif args.operation == "pack":
        if not args.component:
            parser.error("--component is required")
        pack(args)
    elif args.operation == "verify-server":
        verify_server(args)
    else:
        publish(args)
