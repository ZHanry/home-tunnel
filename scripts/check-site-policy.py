"""Static checks for the hub site: links, claims, slots, and accessible structure."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "docs" / "site"
BANNED = (
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
    "releases/download/v10.0.0",
)
ALLOWED_IMAGES = {
    "assets/hometunnel.svg",
    "assets/architecture.svg",
    "assets/share-card.svg",
    "assets/admin-dashboard-7.jpg",
}
DOWNLOAD_PAGES = {"downloads.html", "en/downloads.html"}
LANDING_PAGES = {"index.html", "en/index.html"}
STATUS_PAGES = LANDING_PAGES | DOWNLOAD_PAGES


def audit(root=ROOT):
    errors = []
    site = root / "docs" / "site"
    pages = sorted(site.rglob("*.html"))
    if len(pages) < 8:
        errors.append("expected zh/en landing, privacy, preview, and download pages")
    slots = json.loads((site / "screenshot-slots.json").read_text(encoding="utf-8"))
    releases = json.loads((site / "releases.json").read_text(encoding="utf-8"))
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
        for phrase in BANNED:
            if phrase in text:
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
        for slot_id, figure in re.findall(r'<figure\b[^>]*data-shot-slot="([^"]+)"[^>]*>([\s\S]*?)</figure>', text):
            seen_slots.setdefault(slot_id, []).append((relative, figure))
        if relative in STATUS_PAGES and 'id="download-status"' not in text:
            errors.append(relative + " needs a download status region")
        if relative in LANDING_PAGES:
            for token in ('"softwareVersion": "9.0.0"', "rel=\"canonical\"", 'hreflang="en"', 'hreflang="zh-CN"', 'id="faq"', 'id="remote"', 'id="tunnel"', "FRP", "UDP", "9.0.0", "10.0.0"):
                if token not in text:
                    errors.append(relative + " missing " + token)
            if text.count("<details") < 4:
                errors.append(relative + " needs a real FAQ")
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
        pages_for_slot = seen_slots.get(slot["id"], [])
        found_on = {item[0] for item in pages_for_slot}
        for expected in slot["pages"]:
            if expected not in found_on:
                errors.append(f"slot {slot['id']} missing on {expected}")
        for page_name, figure in pages_for_slot:
            if slot["status"] == "awaiting-v10-capture":
                if "<img" in figure:
                    errors.append(f"empty slot {slot['id']} on {page_name} contains an image")
                if slot["replacement_file"] not in figure:
                    errors.append(f"slot {slot['id']} must name {slot['replacement_file']}")
            else:
                asset = slot["asset"].split("/")[-1]
                if asset not in figure:
                    errors.append(f"slot {slot['id']} on {page_name} lost {asset}")
                for label in slot.get("label_must_include", []):
                    if label not in figure:
                        errors.append(f"slot {slot['id']} on {page_name} must include {label}")
    blob = "\n".join(page.read_text(encoding="utf-8") for page in pages)
    for historical in slots["historical_assets_not_for_v10"]:
        name = historical.split("/")[-1]
        if name in blob:
            errors.append("historical asset used as current content: " + name)
    for path in [root / "README.md", root / "README.en.md", *root.joinpath("docs").rglob("*.md")]:
        if "docs/8.0/" in path.as_posix().replace("\\", "/") or "/8.0/" in path.as_posix().replace("\\", "/"):
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in BANNED:
            if phrase in text:
                errors.append(f"{path.relative_to(root)} contains banned claim: {phrase}")
    return errors


def main():
    errors = audit()
    if errors:
        raise SystemExit("Site policy failed:\n" + "\n".join(errors))
    print("Site structure, screenshot slots, stable downloads, and claim limits passed")


if __name__ == "__main__":
    sys.exit(main())
