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
            expected = expected.replace("14.0.0 自动化及可复现联调正在进行。", "本版自动化及可复现联调已通过，具体范围见发行说明。")
            expected = expected.replace("14.0.0 automated checks and reproducible integration are in progress.", "Automated checks and reproducible integration passed; see the release notes for the exact scope.")
            expected = expected.replace("14.0.0 正在构建与验收，下方保留已发布的 13.0.0 下载。", "浏览器、桌面与手机统一使用本版，下方列出原始发行文件与摘要。")
            expected = expected.replace("14.0.0 is being built and verified. Published 13.0.0 downloads remain available below.", "Browser, desktop and phone share this release. Original release files and hashes are listed below.")
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
