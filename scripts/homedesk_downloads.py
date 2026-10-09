"""Project verified candidate attachment bytes into the two download pages."""
from pathlib import Path
import argparse
from html import escape

import distribution

START = "<!-- homedesk-assets:start -->"
END = "<!-- homedesk-assets:end -->"


def contents(candidate, english=False):
    if not candidate.get("downloads_published"):
        return ("<p>Candidate builds and release verification are in progress. Real download hashes will appear after publication.</p>"
                if english else "<p>候选构建与发布检查进行中，完成后列出真实下载与摘要。</p>")
    components = candidate["components"]
    file_label = "File" if english else "文件"
    titles = {"server": "Server" if english else "服务端",
              "client": "Windows / macOS / Linux / CLI + Agent" if english else "Windows / macOS / Linux / CLI 与 Agent",
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    dist = distribution.load()
    errors = distribution.validate_distribution(dist)
    if errors:
        raise SystemExit("\n".join(errors))
    project(dist["channels"]["candidate"], check=args.check)
