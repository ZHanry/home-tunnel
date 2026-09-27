"""Rewrite projected download files from distribution.json."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import distribution


def main():
    dist = distribution.project()
    stable = dist["channels"]["stable"]["version"]
    print(f"Projected stable {stable} and the unpromoted candidate from distribution.json")


if __name__ == "__main__":
    main()
