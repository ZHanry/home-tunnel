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
ALLOWED_IMAGES = {"assets/nestlink.svg", "assets/share-card.svg"}

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
        if version != slot.get("captured_product_version") or version != "13.0.0":
            errors.append(f"slot {slot_id} capture version must match its recorded product version")
        revision = manifest.get("source_sha", manifest.get("repository_revision", manifest.get("capture_revision", "")))
        if not re.fullmatch(r"[a-f0-9]{40}", revision):
            errors.append(f"slot {slot_id} capture needs its exact source revision")
        if manifest.get("capture_kind") != slot.get("capture_kind"):
            errors.append(f"slot {slot_id} capture kind does not match its source")
        if slot.get("capture_kind") == "component-preview" and (manifest.get("installed_application") is not False or manifest.get("remote_session_verified") is not False):
            errors.append(f"slot {slot_id} component preview cannot claim installed-app or remote-session acceptance")
        if slot.get("capture_kind") == "native-linux":
            if manifest.get("installed_application") is not True or manifest.get("interactive") is not True:
                errors.append(f"slot {slot_id} needs an installed interactive Linux application capture")
            if manifest.get("repository") != "ZHanry/home-tunnel-client":
                errors.append(f"slot {slot_id} needs the actual Linux product repository")
            for key in ("package_sha256", "gui_sha256"):
                if not re.fullmatch(r"[a-f0-9]{64}", manifest.get(key, "")):
                    errors.append(f"slot {slot_id} needs the actual Linux {key}")
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
    errors=[]
    site=root/"docs/site"
    pages=sorted(site.rglob("*.html"))
    slots=json.loads((site/"screenshot-slots.json").read_text())["slots"]
    if len(pages)!=8:errors.append("expected eight zh/en landing, preview, download and privacy pages")
    candidate=json.loads((site/"candidate.json").read_text())
    css=(site/"assets/site.css").read_text()
    script=(site/"assets/site.js").read_text()
    for token in ("focus-visible","prefers-color-scheme","prefers-reduced-motion",'data-theme="dark"',"nav-toggle","table-layout:fixed","scrollbar-width:none"):
        if token not in css:errors.append("site.css missing "+token)
    if re.search(r"outline\s*:\s*none",css):errors.append("site.css removes keyboard focus outlines")
    for token in ("Escape","ArrowRight","aria-expanded","localStorage","download-status"):
        if token not in script:errors.append("site.js missing "+token)
    allowed=ALLOWED_IMAGES|{slot["asset"].lower() for slot in slots}
    seen={slot["id"]:[] for slot in slots}
    required=('<!doctype html>','name="viewport"','charset="utf-8"','name="color-scheme"','href="#content"','id="content"',
        'class="nav-toggle"','aria-controls="site-nav"','id="site-nav"','role="radiogroup"','data-theme-choice="light"',
        'data-theme-choice="dark"','data-theme-choice="system"',"home-tunnel-theme","download-state.js","site.js","NestLink.svg","__GOATCOUNTER_ENDPOINT__")
    for page in pages:
        relative=page.relative_to(site).as_posix()
        text=page.read_text(encoding="utf-8")
        for token in required:
            if token not in text:errors.append(relative+" missing "+token)
        for phrase in BANNED:
            if phrase.lower() in text.lower():errors.append(relative+" contains banned claim: "+phrase)
        if re.search(r"assets/(?:v10|rc12)/|admin-dashboard-7|social-preview\.jpg|desktop\.jpg",text):
            errors.append(relative+" reuses a historical screenshot")
        if ('lang="en"' if relative.startswith('en/') else 'lang="zh-CN"') not in text:errors.append(relative+" has the wrong document language")
        levels=[int(level) for level in re.findall(r'<h([1-3])\b',text)]
        if levels.count(1)!=1:errors.append(relative+" must have one h1")
        previous=0
        for level in levels:
            if previous and level>previous+1:errors.append(relative+" skips a heading level")
            previous=level
        for tag in re.findall(r'<img\b[^>]*>',text):
            if 'alt=' not in tag:errors.append(relative+" has an image without alt")
            match=re.search(r'src="([^"]+)"',tag)
            if match and match[1].removeprefix('../').split('?',1)[0].lower() not in allowed:errors.append(relative+" uses an image outside the current allowlist")
        for target in re.findall(r'(?:href|src)="([^"]+)"',text):
            if target.startswith(('https:','http:','mailto:','#','data:')):continue
            path=target.split('#',1)[0].split('?',1)[0]
            if path and not (page.parent/path).is_file():errors.append(relative+" -> "+path)
        for figure in re.findall(r'<figure\b[^>]*>.*?</figure>',text,flags=re.S):
            match=re.search(r'data-slot="([^"]+)"',figure)
            if not match or match[1] not in seen:errors.append(relative+" has an unregistered screenshot")
            else:seen[match[1]].append((relative,figure))
        if relative in LANDING_PAGES:
            for token in ('"softwareVersion": "13.0.0"','rel="canonical"','hreflang="en"','hreflang="zh-CN"','id="faq"','id="remote"','id="tunnel"',"FRP","P2P"):
                if token not in text:errors.append(relative+" missing "+token)
            if text.count('<details')<4:errors.append(relative+" needs four actual FAQ entries")
            if ('not run' not in text or 'unverified' not in text) if relative.startswith('en/') else ('未运行' not in text or '验证尚未完成' not in text):
                errors.append(relative+" must disclose incomplete verification")
        if relative in DOWNLOAD_PAGES:
            if 'Authenticode' not in text:errors.append(relative+" must disclose the actual Windows signing status")
            if candidate.get('downloads_published'):
                for name in ('client','server','android'):
                    for asset in candidate['components'][name]['artifacts']:
                        if asset['url'] not in text or asset['sha256'] not in text:errors.append(relative+" is missing a verified download or digest")
            elif 'releases/download/v13.0.0/' in text:errors.append(relative+" advertises an unpublished download")
    for slot in slots:
        errors.extend(audit_capture(site,slot))
        found={name for name,_ in seen[slot['id']]}
        if found!=set(slot['pages']):errors.append("Screenshot page binding drifted: "+slot['id'])
        for name,figure in seen[slot['id']]:
            if f'data-slot-status="{slot["status"]}"' not in figure:errors.append("Screenshot status differs: "+slot['id'])
            if slot['asset'].split('/')[-1] not in figure:errors.append("Screenshot asset differs: "+slot['id'])
            for label in slot.get('label_must_include',[]):
                if label not in figure:errors.append("Screenshot version label missing: "+slot['id'])
            if slot.get('fixture_data') and ('example data' if name.startswith('en/') else '示例数据') not in figure:
                errors.append(name+" must disclose example data")
            if slot.get('capture_kind')=='component-preview' and ('components' if name.startswith('en/') else '组件') not in figure:
                errors.append(name+" must identify component renders")
    raster={p.resolve() for p in (site/'assets').rglob('*') if p.suffix.lower() in ('.png','.jpg','.jpeg','.webp','.gif')}
    if raster!={(site/slot['asset']).resolve() for slot in slots}:errors.append("The site retains old or unregistered product screenshots")
    return errors


def main():
    errors = audit()
    if errors:
        raise SystemExit("Site policy failed:\n" + "\n".join(errors))
    print("Site structure, screenshot slots, stable downloads, and claim limits passed")


if __name__ == "__main__":
    sys.exit(main())
