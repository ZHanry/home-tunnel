"""Look for obvious secrets in tracked text. SHA-256 digests are not secrets."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA |PRIVATE )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"(?i)\b(?:password|secret|token)\b\s*[:=]\s*['\"][^'\"]{8,}"),
)
SKIP = {".git", "__pycache__", "docs/8.0/evidence"}


def main():
    findings = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        if any(part in relative for part in SKIP) or path.suffix.lower() in {".jpg", ".png", ".svg", ".ico"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in PATTERNS:
            if pattern.search(text):
                findings.append(relative + " matched " + pattern.pattern)
    if findings:
        raise SystemExit("Secret scan failed:\n" + "\n".join(findings))
    print("No obvious secrets in text files. CI still runs Gitleaks.")


if __name__ == "__main__":
    main()
