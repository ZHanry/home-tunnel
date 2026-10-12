"""Prepare or apply one coordinated stable channel after actual Release verification."""
from __future__ import annotations

import argparse
import base64
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import distribution
import homedesk_downloads


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


verifier = module("component_verifier", "verify-homedesk-components.py")
site_policy = module("site_policy", "check-site-policy.py")
release_policy = module("release_policy", "homedesk-release.py")
COMPONENTS = ("server", "client", "android")
UNVERIFIED = {"physical-android-device", "carrier-network-nat", "long-duration-media"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def permitted_acceptance(record, value):
    return record.get("status") == "passed_reproducible" or (value == "14.0.1" and record.get("status") == "accepted_with_waivers")


def waiver_projection_check(acceptance, component):
    """Pure structural projection; live checks verify signed source bytes later."""
    waived = [item for item in acceptance.get("scenarios", []) if item.get("status") == "not_run"]
    hashes = waived[0].get("owner_waiver", {}).get("policy_file_sha256", {}) if waived else {}
    disclosure = "accepted_with_waivers " + release_policy.OWNER_WAIVER_AUTHORIZATION + " " + " ".join(item.get("name", "") for item in waived)
    release_policy.validate_owner_waiver_scenarios(acceptance, component, policy_file_sha256=hashes, release_notes=disclosure)


def promoted_distribution(original, records, verified_at):
    """Pure projection from independently verified source, bytes and acceptance."""
    dist = copy.deepcopy(original)
    candidate = dist["channels"]["candidate"]
    value = candidate["version"]
    require(distribution.is_nestlink_version(value) and distribution.nestlink_predecessor(value) is not None,
            "Coordinated promotion needs a configured current version and immutable predecessor")
    require(set(records) == set(COMPONENTS), "All three actual component Releases are required")
    payload_sources = {}
    unverified = set(candidate.get("not_verified", []))
    scopes = []
    for name in COMPONENTS:
        item, record = candidate["components"][name], records[name]
        require(record.get("revision") == item["source_sha"] and record.get("assets") == item["artifacts"], "Independent source/assets mismatch: " + name)
        require(all(record.get(key) is True for key in ("source_manifest_verified", "sigstore_verified", "reproducible_acceptance_verified")), "Missing independent verification: " + name)
        acceptance = record.get("acceptance")
        require(isinstance(acceptance, dict), "Missing signed acceptance: " + name)
        source = record.get("payload_source_revision")
        require(re.fullmatch(r"[a-f0-9]{40}", source or ""), "Missing exact tested payload source: " + name)
        require(permitted_acceptance(acceptance, value) and acceptance.get("version") == value and acceptance.get("component") == name
                and acceptance.get("source_revision") == source, "Acceptance identity mismatch: " + name)
        require(isinstance(acceptance.get("scope"), str) and len(acceptance["scope"].strip()) >= 20, "Actual acceptance scope required: " + name)
        require(isinstance(acceptance.get("unverified"), list) and UNVERIFIED <= set(acceptance["unverified"]), "Outstanding coverage must remain explicit: " + name)
        if acceptance.get("status") == "accepted_with_waivers":
            waiver_projection_check(acceptance, name)
        payload_sources[name] = source
        unverified.update(acceptance["unverified"])
        scopes.append(name + ": " + acceptance["scope"].strip())
    for name in COMPONENTS:
        scenarios = records[name]["acceptance"].get("scenarios", [])
        require(isinstance(scenarios, list) and scenarios and all(isinstance(item, dict) for item in scenarios), "Actual scenarios required: " + name)
        names = [item.get("name") for item in scenarios]
        require(len(names) == len(set(names)) and release_policy.REQUIRED_SCENARIOS[name] <= set(names), "Missing or duplicate required scenario: " + name)
        for scenario in scenarios:
            if scenario.get("status") == "not_run" and records[name]["acceptance"]["status"] == "accepted_with_waivers":
                continue  # Explicitly untested; schema/source binding checked above.
            require(scenario.get("status") == "passed" and isinstance(scenario.get("evidence"), dict), "Unpassed scenario: " + name)
            evidence = scenario["evidence"]
            sources = evidence.get("fixture_sources", {})
            required_peers = {"server", "client"} | ({"android"} if name == "android" else set())
            require(required_peers <= set(sources) and all(sources[peer] == payload_sources[peer] for peer in set(sources) & set(payload_sources)), "Scenario used another component combination: " + name)
            execution = evidence.get("execution", {})
            require(execution.get("exit_code") == 0 and not isinstance(execution.get("exit_code"), bool)
                    and isinstance(execution.get("command"), str) and len(execution["command"].strip()) >= 10, "Actual successful execution required: " + name)
            require(isinstance(evidence.get("observation"), str) and len(evidence["observation"].strip()) >= 10, "Actual scenario observation required: " + name)
            files = evidence.get("files", [])
            require(isinstance(files, list) and files and any(item.get("kind") == "result" and item.get("path", "").endswith(".json") for item in files), "Primary structured result evidence required: " + name)
            require(all(re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", "")) and isinstance(item.get("size_bytes"), int)
                        and not isinstance(item["size_bytes"], bool) and item["size_bytes"] > 0 for item in files), "Original hashed evidence required: " + name)
    server_images = records["server"]["acceptance"].get("images", {})
    require(set(server_images) == {"control-center", "traffic-gateway"}, "Actual accepted server image digests required")
    images = {}
    for service, alias in (("control-center", "control"), ("traffic-gateway", "gateway")):
        image = server_images[service]
        require(image.get("image") == "ghcr.io/zhanry/home-tunnel-" + service and image.get("revision") == payload_sources["server"]
                and re.fullmatch(r"sha256:[a-f0-9]{64}", image.get("digest", "")), "Accepted image identity differs: " + service)
        images[alias] = {key: image[key] for key in ("image", "digest")}
    combination = {name: value for name in ("server", "client", "android", "agent")}
    note = f"nestlink {value} stable. Actual Release files, source manifests, Sigstore signatures and version-specific reproducible acceptance independently verified. Exact scope and outstanding coverage are recorded in the release notes. Historical release bytes remain available."
    acceptance_status = "accepted_with_waivers" if any(records[name]["acceptance"]["status"] == "accepted_with_waivers" for name in COMPONENTS) else "passed_reproducible"
    if acceptance_status == "accepted_with_waivers":
        note = f"nestlink {value} stable. Actual Release files, source manifests and Sigstore signatures independently verified. Owner-waived runtime scenarios remain not_run; accepted_with_waivers and exact source/build/payload/policy bindings are disclosed in the release notes. Historical release bytes remain available."
    candidate.update(stage="stable", promotion_status="promoted", downloads_published=True, acceptance_status=acceptance_status,
                     tested_combination=combination, tested_combination_scope="\n".join(scopes), not_verified=sorted(unverified), note=note,
                     component_verification={"version": value, "verified_at": verified_at,
                        "method": "Independent GitHub Release downloads, SHA-256, exact tag/source, signed BUILD and current acceptance checks",
                        "records": f"docs/release/components-{value}.json"})
    stable_components = {}
    for name, component in candidate["components"].items():
        stable_components[name] = {key: component[key] for key in ("repository", "version", "tag", "prerelease")}
        stable_components[name]["release_url"] = f"https://github.com/{component['repository']}/releases/tag/v{value}"
        if name != "hub":
            stable_components[name].update(release_revision=component["source_sha"], downloads=copy.deepcopy(component["artifacts"]))
    contract = candidate["contract"]
    dist["channels"]["stable"] = {"schema_version": 1, "product": "nestlink", "version": value, "stage": "stable", "api_major": 2,
        "contract_ref": contract["ref"], "contract_revision": contract["revision"], "contract_sha256": contract["openapi_sha256"],
        "minimum_server": value, "tested_combination": combination, "tested_combination_scope": "\n".join(scopes),
        "components": stable_components, "upstream": {"frp": candidate["frp"]}, "signing": copy.deepcopy(candidate["signing"]),
        "remote_policy": candidate["remote_policy"], "relay_enabled": candidate["relay_enabled"], "verification_note": note,
        "not_verified": sorted(unverified), "images": images}
    return dist


def verify_acceptance_sources(records):
    """Resolve each signed payload's original successful source build and code drift."""
    for name, record in records.items():
        acceptance = record["acceptance"]
        repo, source, revision = record["repository"], acceptance["source_revision"], record["revision"]
        run = json.loads(verifier.run("gh", "api", f"repos/{repo}/actions/runs/{acceptance['build_run']}"))
        require(run.get("status") == "completed" and run.get("conclusion") == "success" and run.get("head_sha") == source,
                "Signed acceptance build does not resolve to successful exact source: " + name)
        comparison = json.loads(verifier.run("gh", "api", f"repos/{repo}/compare/{source}...{revision}"))
        allowed = {f"docs/release/acceptance-{acceptance['version']}.json", "docs/HOMEDESK_RELEASE.md", "docs/RELEASE_NOTES.md"}
        if acceptance.get("status") == "accepted_with_waivers":
            allowed.update(release_policy.OWNER_WAIVER_POLICY_FILES)
            def source_bytes(filename):
                response = json.loads(verifier.run("gh", "api", f"repos/{repo}/contents/{filename}?ref={revision}"))
                require(response.get("encoding") == "base64", "Actual release source bytes are missing: " + filename)
                return base64.b64decode(response["content"], validate=False)
            hashes = {filename: hashlib.sha256(source_bytes(filename)).hexdigest() for filename in release_policy.OWNER_WAIVER_POLICY_FILES}
            notes = source_bytes("docs/RELEASE_NOTES.md").decode("utf8")
            release_policy.validate_owner_waiver_scenarios(acceptance, name, policy_file_sha256=hashes, release_notes=notes)
        require(comparison.get("status") in ("identical", "ahead") and all(item["filename"] in allowed for item in comparison.get("files", [])),
                "Runtime source changed between tested payload and released source: " + name)
    repo = records["server"]["repository"]
    for image in records["server"]["acceptance"]["images"].values():
        subprocess.run(["cosign", "verify", image["image"] + "@" + image["digest"],
                        "--certificate-identity", f"https://github.com/{repo}/.github/workflows/server-candidate.yml@refs/heads/main",
                        "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com"], check=True)


def final_copy(root, records):
    """Update only the selected pending release, preserving historical copy."""
    value = (root / "VERSION").read_text(encoding="utf8").strip()
    predecessor = distribution.nestlink_predecessor(value)
    require(predecessor is not None, "Final copy needs a configured release predecessor")
    require(set(records) == set(COMPONENTS) and all(
        record.get("acceptance", {}).get("version") == value
        and permitted_acceptance(record.get("acceptance", {}), value)
        and all(record.get(key) is True for key in ("source_manifest_verified", "sigstore_verified", "reproducible_acceptance_verified"))
        for record in records.values()),
        "Final copy must use the selected version's verified component records")
    previous = predecessor[0]
    published = {
        "README.md": "已正式发布。三个组件的原始发行文件、签名和本版可复现验收已独立核验；确切验证范围与未验证项见发行说明",
        "README.en.md": "The coordinated release is available. Original files, signatures and version-specific reproducible acceptance have been independently verified; see the release notes for the exact scope and outstanding coverage.",
    }
    has_waivers = any(record["acceptance"]["status"] == "accepted_with_waivers" for record in records.values())
    if has_waivers:
        for name, record in records.items():
            if record["acceptance"]["status"] == "accepted_with_waivers":
                waiver_projection_check(record["acceptance"], name)
        published = {"README.md": "已正式发布。三个组件的原始发行文件、签名和来源已独立核验；accepted_with_waivers 下的未测场景保持 not_run，授权和确切范围见发行说明",
                     "README.en.md": "The coordinated release is available. Original files, signatures and sources have been independently verified. Owner-waived runtime scenarios remain not_run under accepted_with_waivers; authorization and exact scope are disclosed in the release notes."}
    legacy = {
        "README.md": "目前正在构建和验收。已发布的 13.0.0 下载保留至新版实际产物完成校验",
        "README.en.md": "Builds and acceptance are in progress; verified 13.0.0 downloads remain available until the new product bytes are published.",
    }
    outputs = {}
    for relative in published:
        path = root / relative
        contents = path.read_text(encoding="utf8")
        if value == "14.0.0":
            before = legacy[relative]
            require(contents.count(before) == 1, "Final copy source text drifted: " + relative)
            contents = contents.replace(before, published[relative], 1)
        else:
            english = relative.endswith(".en.md")
            marker = (f"**{value} maintenance work is in progress.**" if english
                      else f"**{value} 维护版正在构建与验收。**")
            lines = contents.splitlines(keepends=True)
            matches = [index for index, line in enumerate(lines) if line.startswith(marker + " ")]
            require(len(matches) == 1, "Current maintenance banner missing or ambiguous: " + relative)
            text = (f"**{value} maintenance release is available.** {published[relative]} Historical downloads and records remain available."
                    if english else f"**{value} 维护版已正式发布。** {published[relative]}。历史下载与记录继续保留。")
            lines[matches[0]] = text + "\n"
            contents = "".join(lines)
        outputs[path] = contents
    scopes = "\n\n".join("- **" + name + "**: " + records[name]["acceptance"]["scope"] for name in COMPONENTS)
    unverified = sorted(set().union(*(set(records[name]["acceptance"]["unverified"]) for name in COMPONENTS)))
    current = (f"本版 {value} 三个组件的真实 GitHub Release、原始文件 SHA-256、确切源提交及 Sigstore 签名已独立核验。"
               f"稳定通道和下载清单绑定这些发行字节。各组件实际验收范围如下；{previous} 原始记录和下载保留为历史记录。\n\n"
               + scopes + "\n\n本版组件验收保留的未测索引：" + "、".join("`" + item + "`" for item in unverified)
               + "。历史验收结论不替代本版；正在运行的生产服务端保持原版本。")
    if has_waivers:
        waived = "\n".join("- " + name + "/" + item["name"] + ": not_run — " + item["owner_waiver"]["reason"] for name, record in records.items() for item in record["acceptance"]["scenarios"] if item["status"] == "not_run")
        current += "\n\n状态：accepted_with_waivers。用户授权原话：`" + release_policy.OWNER_WAIVER_AUTHORIZATION + "`。未执行的运行时场景不宣称通过：\n\n" + waived + "\n\nHub `current-ui-site`：not_run，本版 C 产品真实界面回归未执行；网站布局、下载字节和签名另行实际检查。官网产品截图保留真实14.0.0来源、原始manifest和摘要；14.0.1产品UI回归为not_run。Website product screenshots retain their actual 14.0.0 source, original manifests and hashes; 14.0.1 product UI regression remains not_run."
    for relative in ("docs/RELEASE_NOTES.md", "docs/HOMEDESK_RELEASE.md"):
        path = root / relative
        contents = path.read_text(encoding="utf8")
        if value == "14.0.0":
            before = "本版最终构建、安装和联调正在验收。"
            require(contents.count(before) == 1, "Final release notes source text drifted: " + relative)
            start, end = contents.index(before), contents.find("\n\n", contents.index(before))
            require(end >= start, "Final release notes pending paragraph is incomplete: " + relative)
            contents = contents[:start] + current + contents[end:]
            contents = contents.replace("Current build and integration acceptance is pending.", "Version-specific reproducible acceptance passed within the component scopes above; outstanding coverage remains unverified.")
        else:
            require(contents.splitlines()[0] == f"# NestLink {value} 维护版", "Current maintenance heading differs: " + relative)
            # The exact current pending paragraph precedes all historical sections.
            top, separator, history = contents.partition("\n## ")
            paragraphs = top.split("\n\n")
            marker = "目前仅为维护源码准备，新的 CI、安装包、镜像、APK、真实界面及隔离联调验收仍在进行。"
            matches = [index for index, paragraph in enumerate(paragraphs) if paragraph.startswith(marker)]
            require(len(matches) == 1, "Current maintenance notes marker missing or ambiguous: " + relative)
            paragraphs[matches[0]] = current
            contents = "\n\n".join(paragraphs) + separator + history
        outputs[path] = contents
    # Validate every selected document before writing any staged copy.
    for path, contents in outputs.items():
        path.write_text(contents, encoding="utf8", newline="\n")


def prepare_files(root, dist, records):
    """Validate a complete temporary tree before touching channel or download files."""
    with tempfile.TemporaryDirectory(prefix="nestlink-promotion-") as temporary:
        staging = Path(temporary)
        for name in ("docs", "scripts", "contracts"):
            shutil.copytree(root / name, staging / name)
        for name in ("VERSION", "README.md", "README.en.md"):
            shutil.copyfile(root / name, staging / name)
        distribution.dump(staging / f"docs/release/components-{dist['development_line']}.json", records)
        distribution.dump(staging / "distribution.json", dist)
        errors = distribution.validate_distribution(dist, root=staging)
        require(not errors, "\n".join(errors))
        for relative, value in distribution.projected_files(dist).items():
            distribution.dump(staging / relative, value)
        homedesk_downloads.project(dist["channels"]["candidate"], root=staging)
        homedesk_downloads.project_stable_entry_points(dist, root=staging)
        final_copy(staging, records)
        errors = site_policy.audit(staging)
        require(not errors, "\n".join(errors))
        outputs = {}
        for file in staging.rglob("*"):
            if file.is_file():
                relative = file.relative_to(staging)
                if not (root / relative).is_file() or file.read_bytes() != (root / relative).read_bytes():
                    outputs[relative] = file.read_bytes()
        return outputs


def apply_files(root, outputs):
    """Restore all originals if a filesystem write fails partway through."""
    originals = {relative: (root / relative).read_bytes() if (root / relative).is_file() else None for relative in outputs}
    try:
        for relative, contents in outputs.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + ".promotion-tmp")
            temporary.write_bytes(contents)
            temporary.replace(path)
    except BaseException:
        for relative, contents in originals.items():
            path = root / relative
            if contents is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(contents)
            path.with_name(path.name + ".promotion-tmp").unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in COMPONENTS:
        parser.add_argument("--" + name + "-sha", required=True, help="Exact final released tag commit, including its acceptance record")
    parser.add_argument("--download-dir", type=Path, help="Retain independently rehashed actual Release downloads")
    parser.add_argument("--apply", action="store_true", help="Write the fully verified channel/download/copy projection; default only prints the reviewed file plan")
    args = parser.parse_args()
    root = distribution.ROOT
    dist = distribution.load()
    require(dist["channels"]["candidate"].get("promotion_status") == "not_promoted", "Stable promotion has already been recorded")
    errors = distribution.validate_distribution(dist)
    require(not errors, "\n".join(errors))
    candidate = dist["channels"]["candidate"]
    for name in COMPONENTS:
        source = getattr(args, name + "_sha")
        require(re.fullmatch(r"[a-f0-9]{40}", source), "Exact final Release tag source required: " + name)
        candidate["components"][name]["source_sha"] = source
    records = verifier.verify(candidate, record=True, signatures=True, download_dir=args.download_dir)
    verify_acceptance_sources(records)
    promoted = promoted_distribution(dist, records, datetime.now(timezone.utc).isoformat())
    outputs = prepare_files(root, promoted, records)
    if args.apply:
        apply_files(root, outputs)
    print(("Applied" if args.apply else "Verified; ready to apply") + f" coordinated {candidate['version']} projection:")
    for relative in sorted(outputs):
        print(str(relative) + " sha256=" + hashlib.sha256(outputs[relative]).hexdigest())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
