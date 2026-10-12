"""Project verified candidate attachment bytes into the two download pages."""
from pathlib import Path
import argparse
import re
from html import escape

import distribution

START = "<!-- homedesk-assets:start -->"
END = "<!-- homedesk-assets:end -->"


def contents(candidate, english=False):
    if not candidate.get("downloads_published"):
        version = escape(candidate["version"])
        return (f"<p>{version} build and acceptance are in progress. Original download hashes will appear after publication.</p>"
                if english else f"<p>{version} 构建与验收进行中，发布后列出原始下载文件与摘要。</p>")
    components = candidate["components"]
    file_label = "File" if english else "文件"
    titles = {"server": "Server" if english else "服务端",
              "client": "Windows / Linux desktop" if english else "Windows / Linux 桌面端",
              "android": "Android"}
    parts = []
    for name in ("server", "client", "android"):
        component = components[name]
        if not component.get("published"):
            raise ValueError("Unpublished component: " + name)
        title = escape(titles[name] + " · " + component["version"])
        parts.append(f'<h3>{title}</h3><table role="table" class="download-table">'
                     f'<caption>{title} · SHA-256</caption><thead role="rowgroup"><tr role="row">'
                     f'<th role="columnheader" scope="col">{file_label}</th>'
                     '<th role="columnheader" scope="col">SHA-256</th></tr></thead><tbody role="rowgroup">')
        for artifact in component["artifacts"]:
            url = escape(artifact["url"], quote=True)
            filename = escape(artifact["filename"])
            checksum = escape(artifact["sha256"])
            size = artifact["size_bytes"]
            parts.append(f'<tr role="row"><td role="cell"><span class="cell-label" aria-hidden="true">{file_label}</span>'
                         f'<a href="{url}">{filename}</a><br><span class="muted">{size} bytes</span></td>'
                         '<td role="cell"><span class="cell-label" aria-hidden="true">SHA-256</span>'
                         f'<code data-sha256-for="{url}">{checksum}</code></td></tr>')
        parts.append('</tbody></table>')
    return "\n" + "\n".join(parts) + "\n"


def project(candidate, *, root=distribution.ROOT, check=False):
    for relative, english in (("docs/site/downloads.html", False), ("docs/site/en/downloads.html", True)):
        path = root / relative
        original = path.read_text(encoding="utf8")
        if original.count(START) != 1 or original.count(END) != 1:
            raise ValueError("Expected one candidate attachment region: " + relative)
        before, rest = original.split(START, 1)
        _, after = rest.split(END, 1)
        expected = before + START + contents(candidate, english) + END + after
        if check and expected != original:
            raise ValueError("Candidate downloads differ from verified distribution: " + relative)
        if not check and expected != original:
            path.write_text(expected, encoding="utf8")


def project_stable_entry_points(dist, *, root=distribution.ROOT, check=False):
    """Keep button URLs and markdown tied to recorded stable download bytes."""
    stable = dist["channels"]["stable"]
    candidate = dist["channels"]["candidate"]
    promoted = candidate.get("promotion_status") == "promoted"
    replacements = {}
    for name in ("server", "client", "android"):
        for item in stable["components"][name].get("downloads", []):
            filename = item["filename"]
            if filename.endswith(".exe"): role = "windows"
            elif filename.endswith("-x64.deb"): role = "linux-x64"
            elif filename.endswith("-arm64.deb"): role = "linux-arm64"
            elif filename.endswith(".apk"): role = "android"
            elif filename.startswith("NestLink-Server-") and filename.endswith(".tar.gz"): role = "server"
            else: continue
            replacements[role] = item["url"]
    patterns = {
        "windows": r'https://github\.com/ZHanry/home-tunnel-client/releases/download/v[^/]+/NestLink-Setup-[^"<> ]+-x64\.exe',
        "linux-x64": r'https://github\.com/ZHanry/home-tunnel-client/releases/download/v[^/]+/NestLink-Linux-[^"<> ]+-x64\.deb',
        "linux-arm64": r'https://github\.com/ZHanry/home-tunnel-client/releases/download/v[^/]+/NestLink-Linux-[^"<> ]+-arm64\.deb',
        "android": r'https://github\.com/ZHanry/home-tunnel-android/releases/download/v[^/]+/NestLink-Android-[^"<> ]+\.apk',
        "server": r'https://github\.com/ZHanry/home-tunnel-server/releases/download/v[^/]+/NestLink-Server-[^"<> ]+\.tar\.gz',
    }
    for path in (root / "docs/site").rglob("*.html"):
        original = path.read_text(encoding="utf8")
        expected = re.sub(r'data-stable-version="[^"]+"', f'data-stable-version="{stable["version"]}"', original)
        for role, url in replacements.items():
            expected = re.sub(patterns[role], lambda _match, value=url: value, expected)
        english = path.parent.name == "en"
        if path.name == "downloads.html":
            expected = re.sub(r'(<span class="eyebrow">)DOWNLOAD / [^<]+',
                              lambda match: match[1] + "DOWNLOAD / " + escape(stable["version"]), expected)
        stable_status = f'{stable["version"]} · stable release' if english else f'{stable["version"]} · 正式版'
        expected = re.sub(r'(<p\b[^>]*\bid="download-status"[^>]*>)[^<]*',
                          lambda match: match[1] + escape(stable_status), expected)
        status = f'{candidate["version"]} · stable release' if english else f'{candidate["version"]} · 正式版'
        if not promoted:
            status = f'{candidate["version"]} · Build and acceptance' if english else f'{candidate["version"]} · 构建与验收'
        expected = re.sub(r'(<span class="version-pill">)[^<]+', lambda match: match[1] + status, expected)
        if promoted:
            waived = candidate["version"] == "14.0.1" and candidate.get("acceptance_status") == "accepted_with_waivers"
            zh = "本版发行字节、签名和来源已核验；运行时回归按用户要求保留 not_run（accepted_with_waivers），确切范围见发行说明。产品截图为真实 14.0.0 参考，14.0.1 产品 UI 为 not_run。" if waived else "本版自动化及可复现联调已通过，具体范围见发行说明。"
            en = "Release bytes, signatures and sources are verified; runtime regression remains not_run at the owner's request under accepted_with_waivers. See the release notes for the exact scope. Product screenshots are actual 14.0.0 references; 14.0.1 product UI remains not_run." if waived else "Automated checks and reproducible integration passed; see the release notes for the exact scope."
            expected = expected.replace(f'{candidate["version"]} 自动化及可复现联调正在进行。', zh)
            expected = expected.replace(f'{candidate["version"]} automated checks and reproducible integration are in progress.', en)
            if waived and path.name == "preview.html":
                expected = expected.replace("NestLink 14.0.0 当前界面。", "NestLink 14.0.0 实装截图参考；14.0.1 产品 UI 为 not_run。")
                expected = expected.replace("The current NestLink 14.0.0 interface.", "Actual NestLink 14.0.0 screenshot references; 14.0.1 product UI remains not_run.")
                expected = expected.replace("图片来自本版实际安装和运行的应用，使用示例账号与设备数据。", "图片来自真实 14.0.0 安装和运行的应用，保留原始源码、manifest 与摘要，使用示例账号与设备数据。14.0.1 产品 UI 回归为 not_run；这些历史截图不作为新版实测结论。")
                expected = expected.replace("Images come from installed, running apps of this release with example accounts and devices.", "Images come from actual installed, running 14.0.0 apps with example accounts and devices; original sources, manifests and hashes are preserved. The 14.0.1 product UI regression is not_run; these historical screenshots do not assert current product acceptance.")
            expected = re.sub(r'\d+\.\d+\.\d+ 正在构建与验收，下方保留已发布的 \d+\.\d+\.\d+ 下载。', "浏览器、桌面与手机统一使用本版，下方列出原始发行文件与摘要。", expected)
            expected = re.sub(r'\d+\.\d+\.\d+ is being built and verified\. Published \d+\.\d+\.\d+ downloads remain available below\.', "Browser, desktop and phone share this release. Original release files and hashes are listed below.", expected)
        if check and expected != original:
            raise ValueError("Stable entry points differ from distribution: " + str(path.relative_to(root)))
        if not check and expected != original:
            path.write_text(expected, encoding="utf8")
    lines = [f'# NestLink downloads · {stable["version"]}', '']
    if not promoted:
        lines += [f'{candidate["version"]} is being built and verified. These are the actual published {stable["version"]} downloads.', '']
    for name in ("server", "client", "android"):
        component = stable["components"][name]
        lines += [f'## {name} · {component["version"]}', '', f'[Release]({component["release_url"]})', '', '| File | Bytes | SHA-256 |', '| --- | ---: | --- |']
        for item in component.get("downloads", []):
            lines.append(f'| [{item["filename"]}]({item["url"]}) | {item["size_bytes"]} | `{item["sha256"]}` |')
        lines.append('')
    markdown = "\n".join(lines)
    path = root / "docs/DOWNLOADS.md"
    if check and path.read_text(encoding="utf8") != markdown:
        raise ValueError("Markdown downloads differ from distribution")
    if not check:
        path.write_text(markdown, encoding="utf8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    dist = distribution.load()
    errors = distribution.validate_distribution(dist)
    if errors:
        raise SystemExit("\n".join(errors))
    candidate = dist["channels"]["candidate"]
    if not candidate.get("downloads_published"):
        stable = dist["channels"]["stable"]
        candidate = {**candidate, "downloads_published": True,
                     "components": {name: {**item, "published": True, "artifacts": item.get("downloads", [])}
                                    for name, item in stable["components"].items()}}
    project(candidate, check=args.check)
    project_stable_entry_points(dist, check=args.check)
