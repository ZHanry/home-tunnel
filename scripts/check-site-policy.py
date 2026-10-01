"""Static checks for the hub site: links, claims, slots, and accessible structure."""

from __future__ import annotations

import json
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "docs" / "site"
BANNED = (
    "负责人豁免",
    "owner waiver",
    "waived by the owner",
    "10.0.0 稳定版已发布",
    "10.0.0 stable release is available",
    "10.0.0 已通过验收",
    "acceptance has passed",
    "secure desktop is supported",
    "安全桌面已支持",
    "系统音频已可用",
    "audio playback is available",
    "文件传输已验收",
    "file transfer has passed acceptance",
    "Authenticode signed",
    "Developer ID signed",
    "已通过 Gemini",
    "Gemini review passed",
)
# An unpromoted line cannot advertise stable download URLs.
ALLOWED_IMAGES = {
    "assets/hometunnel.svg",
    "assets/architecture.svg",
    "assets/share-card.svg",
    "assets/admin-dashboard-7.jpg",
    "assets/v10/admin-console.png",
    "assets/v10/tunnel-wizard.png",
    "assets/v10/remote-entry.png",
    "assets/v10/android-overview.png",
    "assets/v10/android-devices.png",
    "assets/v10/windows-signin.png",
}
DOWNLOAD_PAGES = {"downloads.html", "en/downloads.html"}
LANDING_PAGES = {"index.html", "en/index.html"}
STATUS_PAGES = LANDING_PAGES | DOWNLOAD_PAGES


def audit_capture(site, slot):
    """Bind published product pixels to an original capture manifest."""
    errors = []
    slot_id = slot["id"]
    try:
        asset = site / slot["asset"]
        manifest_path = site / slot["capture_manifest"]
        if not asset.resolve().is_relative_to(site.resolve()) or not manifest_path.resolve().is_relative_to(site.resolve()):
            return [f"slot {slot_id} capture paths must stay inside the site"]
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        version = manifest.get("product_version", manifest.get("component_version", manifest.get("version")))
        if version != slot.get("captured_product_version") or version != "10.0.0":
            errors.append(f"slot {slot_id} capture version must match 10.0.0")
        revision = manifest.get("source_sha", manifest.get("repository_revision", manifest.get("capture_revision", "")))
        if not re.fullmatch(r"[a-f0-9]{40}", revision):
            errors.append(f"slot {slot_id} capture needs its exact source revision")
        entries = manifest.get("captures", manifest.get("screenshots", []))
        if slot.get("capture_kind") == "native-windows":
            if manifest.get("interactive") is not True:
                errors.append(f"slot {slot_id} needs an interactive native Windows capture")
            for key in ("package_sha256", "gui_sha256"):
                if not re.fullmatch(r"[a-f0-9]{64}", manifest.get(key, "")):
                    errors.append(f"slot {slot_id} needs the actual Windows {key}")
            entries = [{"file": slot["source_file"], "sha256": manifest.get("screenshot_sha256")}]
        matches = [entry for entry in entries if Path(entry.get("file", entry.get("source_path", ""))).name == slot["source_file"]]
        if len(matches) != 1:
            return errors + [f"slot {slot_id} must identify one original captured file"]
        entry = matches[0]
        data = asset.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry.get("sha256"):
            errors.append(f"slot {slot_id} image digest does not match capture")
        if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
            errors.append(f"slot {slot_id} must contain actual PNG bytes")
        else:
            dimensions = (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"))
            expected = (entry.get("width", manifest.get("width")), entry.get("height", manifest.get("height")))
            if dimensions != expected:
                errors.append(f"slot {slot_id} image dimensions do not match capture")
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append(f"slot {slot_id} has invalid capture provenance: {error}")
    return errors


def audit(root=ROOT):
    errors = []
    site = root / "docs" / "site"
    pages = sorted(site.rglob("*.html"))
    if len(pages) < 8:
        errors.append("expected zh/en landing, privacy, preview, and download pages")
    slots = json.loads((site / "screenshot-slots.json").read_text(encoding="utf-8"))
    releases = json.loads((site / "releases.json").read_text(encoding="utf-8"))
    candidate = json.loads((site / "candidate.json").read_text(encoding="utf-8"))
    promoted = candidate.get("promotion_status") == "promoted"
    banned = BANNED if promoted else BANNED + (f"releases/download/v{candidate.get('version')}",)
    css = (site / "assets" / "site.css").read_text(encoding="utf-8")
    script = (site / "assets" / "site.js").read_text(encoding="utf-8")
    for token in ("focus-visible", "prefers-color-scheme", "prefers-reduced-motion", "max-width: 800px", 'data-theme="dark"', "nav-toggle", "table-layout: fixed", "minmax(min(100%, 240px)", 'data-tone="loading"'):
        if token not in css:
            errors.append("site.css missing " + token)
    if re.search(r"outline\s*:\s*none", css):
        errors.append("site.css removes the focus outline")
    for token in ("Escape", "ArrowRight", "aria-expanded", "localStorage", "download-status", 'forced === "loading"'):
        if token not in script:
            errors.append("site.js missing " + token)
    download_urls = [
        item["url"]
        for component in releases["components"].values()
        for item in component.get("downloads") or []
    ]
    seen_slots = {slot["id"]: [] for slot in slots["slots"]}
    for page in pages:
        text = page.read_text(encoding="utf-8")
        relative = page.relative_to(site).as_posix()
        for phrase in banned:
            if phrase.lower() in text.lower():
                errors.append(f"{relative} contains banned claim: {phrase}")
        required = (
            "<!doctype html>",
            'name="viewport"',
            'charset="utf-8"',
            'name="color-scheme"',
            'href="#content"',
            'id="content"',
            'class="nav-toggle"',
            'aria-controls="site-nav"',
            'id="site-nav"',
            'role="radiogroup"',
            'data-theme-choice="light"',
            'data-theme-choice="dark"',
            'data-theme-choice="system"',
            "home-tunnel-theme",
            "download-state.js",
            "site.js",
            "HomeTunnel.svg",
            "__GOATCOUNTER_ENDPOINT__",
        )
        for token in required:
            if token not in text:
                errors.append(f"{relative} missing {token}")
        if relative.startswith("en/"):
            if 'lang="en"' not in text:
                errors.append(relative + " must use lang=en")
        elif 'lang="zh-CN"' not in text:
            errors.append(relative + " must use lang=zh-CN")
        headings = [int(level) for level in re.findall(r"<h([1-3])\b", text)]
        if headings.count(1) != 1:
            errors.append(relative + " must have one h1")
        previous = 0
        for level in headings:
            if previous and level > previous + 1:
                errors.append(relative + " skips a heading level")
                break
            previous = level
        for image in re.findall(r"<img\b[^>]*>", text):
            if "alt=" not in image:
                errors.append(relative + " has an image without alt")
            source = re.search(r'src="([^"]+)"', image)
            if not source:
                continue
            normalized = source.group(1).split("?", 1)[0].removeprefix("../").lower()
            if normalized not in ALLOWED_IMAGES:
                errors.append(relative + " uses an image outside the allowlist: " + source.group(1))
        for target in re.findall(r'(?:href|src)="([^"]+)"', text):
            if target.startswith(("http:", "https:", "mailto:", "#", "data:")):
                continue
            path = target.split("#", 1)[0].split("?", 1)[0]
            if path and not (page.parent / path).exists():
                errors.append(f"{relative} -> {path}")
        for figure in re.findall(r'<figure\b[^>]*>[\s\S]*?</figure>', text):
            slot_id = re.search(r'data-shot-slot="([^"]+)"', figure)
            if slot_id:
                seen_slots.setdefault(slot_id.group(1), []).append((relative, figure))
        if relative in STATUS_PAGES and 'id="download-status"' not in text:
            errors.append(relative + " needs a download status region")
        if relative in LANDING_PAGES:
            software = f'"softwareVersion": "{releases["version"]}"'
            for token in (software, "rel=\"canonical\"", 'hreflang="en"', 'hreflang="zh-CN"', 'id="faq"', 'id="remote"', 'id="tunnel"', "FRP", "UDP", "9.0.0", "10.0.0"):
                if token not in text:
                    errors.append(relative + " missing " + token)
            if text.count("<details") < 4:
                errors.append(relative + " needs a real FAQ")
            if promoted and candidate.get("waived"):
                # Machine evidence retains original statuses; public prose must
                # plainly disclose incomplete verification at the download entry.
                if relative == "index.html" and ("未运行" not in text or "验证尚未完成" not in text):
                    errors.append("Chinese landing must disclose incomplete verification")
                if relative == "en/index.html" and ("not run" not in text.lower() or "unverified" not in text.lower()):
                    errors.append("English landing must disclose incomplete verification")
            elif not promoted:
                if relative == "index.html" and "验收尚未完成" not in text:
                    errors.append("Chinese landing must say acceptance is unfinished")
                if relative == "en/index.html" and "acceptance is pending" not in text:
                    errors.append("English landing must say acceptance is pending")
        if relative in DOWNLOAD_PAGES:
            for url in download_urls:
                if url not in text:
                    errors.append(relative + " is missing stable download " + url)
            if "Authenticode" not in text:
                errors.append(relative + " must keep the desktop signing fact")
    for slot in slots["slots"]:
        if slot["status"] == "captured-v10-ui":
            errors.extend(audit_capture(site, slot))
        pages_for_slot = seen_slots.get(slot["id"], [])
        found_on = {item[0] for item in pages_for_slot}
        for expected in slot["pages"]:
            if expected not in found_on:
                errors.append(f"slot {slot['id']} missing on {expected}")
        for page_name, figure in pages_for_slot:
            if f'data-slot-status="{slot["status"]}"' not in figure:
                errors.append(f"slot {slot['id']} on {page_name} has a mismatched status")
            if slot["status"] == "awaiting-v10-capture":
                if "<img" in figure:
                    errors.append(f"empty slot {slot['id']} on {page_name} contains an image")
                if f'data-shot-file="{slot["replacement_file"]}"' not in figure:
                    errors.append(f"slot {slot['id']} must bind its replacement in data-shot-file")
            else:
                asset = slot["asset"].split("/")[-1]
                if asset not in figure:
                    errors.append(f"slot {slot['id']} on {page_name} lost {asset}")
                for label in slot.get("label_must_include", []):
                    if label not in figure:
                        errors.append(f"slot {slot['id']} on {page_name} must include {label}")
                if slot["status"] == "captured-v10-ui" and slot.get("fixture_data"):
                    label = "example data" if page_name.startswith("en/") else "示例数据"
                    if label not in figure:
                        errors.append(f"slot {slot['id']} on {page_name} must disclose {label}")
    blob = "\n".join(page.read_text(encoding="utf-8") for page in pages)
    for historical in slots["historical_assets_not_for_v10"]:
        name = historical.split("/")[-1]
        if name in blob:
            errors.append("historical asset used as current content: " + name)
    for path in [root / "README.md", root / "README.en.md", *root.joinpath("docs").rglob("*.md")]:
        if "docs/8.0/" in path.as_posix().replace("\\", "/") or "/8.0/" in path.as_posix().replace("\\", "/"):
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in banned:
            if phrase.lower() in text.lower():
                errors.append(f"{path.relative_to(root)} contains banned claim: {phrase}")
    return errors


def main():
    errors = audit()
    if errors:
        raise SystemExit("Site policy failed:\n" + "\n".join(errors))
    print("Site structure, screenshot slots, stable downloads, and claim limits passed")


if __name__ == "__main__":
    sys.exit(main())
