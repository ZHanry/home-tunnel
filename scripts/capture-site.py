"""Legacy viewport sampler. Acceptance captures use capture-site-matrix.mjs.

The headless --screenshot flag records only the first viewport, so it cannot
prove sections below the fold. Full-page matrix evidence lives outside this
12-image sampler.

Writes PNG files and a manifest. A missing browser is an error result, not a
synthetic screenshot. This does not mark Gemini review or VM acceptance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

CASES = (
    ("zh-landing-desktop-light.png", "/index.html?theme=light", 1440, 1200),
    ("zh-landing-desktop-dark.png", "/index.html?theme=dark", 1440, 1200),
    ("zh-landing-mobile-light.png", "/index.html?theme=light", 390, 844),
    ("zh-landing-focus-light.png", "/index.html?theme=light&focus=theme-light", 1440, 900),
    ("zh-landing-system.png", "/index.html?theme=system", 1440, 900),
    ("en-landing-desktop-light.png", "/en/index.html?theme=light", 1440, 1200),
    ("zh-privacy-desktop-light.png", "/privacy.html?theme=light", 1440, 1100),
    ("zh-preview-desktop-light.png", "/preview.html?theme=light", 1440, 1400),
    ("zh-downloads-desktop-light.png", "/downloads.html?theme=light", 1440, 1600),
    ("zh-downloads-offline.png", "/downloads.html?theme=light&state=offline", 1440, 1100),
    ("zh-downloads-error-dark.png", "/downloads.html?theme=dark&state=error", 1440, 1100),
    ("en-downloads-desktop-dark.png", "/en/downloads.html?theme=dark", 1440, 1400),
)


def browser_path():
    candidates = [
        os.environ.get("HOME_TUNNEL_BROWSER"),
        os.environ.get("BROWSER"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def capture(browser, url, destination: Path, width, height):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    with tempfile.TemporaryDirectory(prefix="home-tunnel-capture-", ignore_cleanup_errors=True) as profile:
        cwd = Path(profile)
        command = [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            f"--user-data-dir={profile}",
            f"--window-size={width},{height}",
            "--virtual-time-budget=8000",
            f"--screenshot={destination}",
            url,
        ]
        process = subprocess.Popen(command, cwd=cwd)
        deadline = time.time() + 40
        while time.time() < deadline:
            if destination.is_file() and destination.stat().st_size > 1000:
                break
            fallback = cwd / "screenshot.png"
            if fallback.is_file() and fallback.stat().st_size > 1000:
                shutil.move(str(fallback), destination)
                break
            if process.poll() is not None and time.time() + 8 < deadline:
                deadline = min(deadline, time.time() + 8)
            time.sleep(0.3)
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        if destination.is_file() and destination.stat().st_size > 1000:
            return
    raise RuntimeError(f"browser produced no screenshot for {url}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--source-sha", default="")
    parser.add_argument("--tree-sha", default="")
    args = parser.parse_args()
    browser = browser_path()
    manifest = {
        "gemini_review": "not_run",
        "browser": browser,
        "base_url": args.base_url,
        "source_sha": args.source_sha,
        "tree_sha": args.tree_sha,
        "cases": [],
    }
    if not browser:
        manifest["status"] = "browser_unavailable"
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        raise SystemExit("No installed Edge or Chrome browser was found")
    args.out.mkdir(parents=True, exist_ok=True)
    for filename, route, width, height in CASES:
        target = args.out / filename
        capture(browser, args.base_url.rstrip("/") + route, target, width, height)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        manifest["cases"].append({
            "filename": filename,
            "route": route,
            "viewport": [width, height],
            "sha256": digest,
            "bytes": target.stat().st_size,
            "synthetic_data": True,
            "gemini_review": "not_run",
        })
        print(filename, digest)
    manifest["status"] = "captured"
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
