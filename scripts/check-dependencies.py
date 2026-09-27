"""Report that this hub has no runtime dependency manifest to audit.

npm, Go, Gradle, and pip scans apply to the other repositories. Adding a
manifest here should come with a reviewed scanner, not a skipped audit.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = (
    "package.json",
    "pnpm-lock.yaml",
    "go.mod",
    "requirements.txt",
    "Pipfile",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
)


def main():
    found = [name for name in MANIFESTS if (ROOT / name).exists()]
    if found:
        raise SystemExit("No reviewed dependency scanner for: " + ", ".join(found))
    print("No runtime dependency manifest. Language-specific vulnerability scans are not applicable here.")


if __name__ == "__main__":
    main()
