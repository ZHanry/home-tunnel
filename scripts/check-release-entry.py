"""Check the channel source, projected downloads, and local documentation links."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import distribution
import v10_evidence

ROOT = Path(__file__).resolve().parents[1]


def main():
    dist = distribution.load(ROOT)
    status, status_errors, record = v10_evidence.load_status(ROOT)
    errors = list(status_errors)
    if dist["channels"]["candidate"]["promotion_status"] == "promoted":
        # Promotion is only as good as the evidence record acceptance-status.json names.
        evidence_errors = list(status_errors) if record is not None else ["promotion was not given a clean evidence record"]
        errors.extend(distribution.validate_distribution(dist, root=ROOT, evidence_errors=evidence_errors, evidence_record=record))
    else:
        errors.extend(distribution.validate_distribution(dist, root=ROOT))
    errors.extend(distribution.projection_errors(dist, root=ROOT))
    for path in [ROOT / "README.md", ROOT / "README.en.md", *ROOT.joinpath("docs").rglob("*.md")]:
        text = path.read_text(encoding="utf-8")
        for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", text):
            if target.startswith(("https:", "http:", "#", "mailto:")):
                continue
            relative = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if relative and not (path.parent / relative).exists():
                errors.append(f"{path.relative_to(ROOT)} -> {relative}")
    if errors:
        raise SystemExit("Release entry check failed:\n" + "\n".join(errors))
    stable = dist["channels"]["stable"]["version"]
    candidate = dist["channels"]["candidate"]
    if candidate["promotion_status"] == "promoted":
        print(f"Channel source passed. Stable downloads are {stable} ({candidate['acceptance_status']}, status {status.get('status')}).")
    else:
        print(f"Channel source passed. Stable downloads remain {stable}. {candidate['version']} is not promoted.")


if __name__ == "__main__":
    main()
