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
    errors = distribution.validate_distribution(dist, root=ROOT)
    errors.extend(distribution.projection_errors(dist, root=ROOT))
    status_path = ROOT / "docs" / "release" / "acceptance-status.json"
    status = json.loads(status_path.read_text(encoding="utf-8"))
    errors.extend(v10_evidence.assess_status(status))
    if dist["channels"]["candidate"]["promotion_status"] == "promoted":
        errors.extend(distribution.validate_distribution(dist, root=ROOT, evidence_errors=["promotion was not given a clean evidence record"]))
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
    candidate = dist["channels"]["candidate"]["version"]
    print(f"Channel source passed. Stable downloads remain {stable}. {candidate} is not promoted.")


if __name__ == "__main__":
    main()
