"""Confirm the hub repository keeps its Apache-2.0 license notice."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    if "Apache License" not in license_text or "Version 2.0" not in license_text:
        raise SystemExit("LICENSE is not Apache-2.0")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    if "Apache-2.0" not in readme:
        raise SystemExit("README must identify the Apache-2.0 license")
    conflicts = []
    for path in ROOT.rglob("LICENSE*"):
        if path.name != "LICENSE" and "8.0" not in path.as_posix():
            conflicts.append(path.relative_to(ROOT).as_posix())
    if conflicts:
        raise SystemExit("Unexpected license files: " + ", ".join(conflicts))
    print("Apache-2.0 license file and README notice passed")


if __name__ == "__main__":
    main()
