"""Evaluate a 10.0.0 evidence record, or the development acceptance status.

The status file may stay `not_submitted`. Claiming passed/accepted fails closed
when the record is missing, stale, mismatched, or a fixture.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import v10_evidence

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", nargs="?", type=Path)
    parser.add_argument("--status", type=Path, help="Development acceptance status JSON")
    args = parser.parse_args()
    if args.status and args.record:
        raise SystemExit("Pass either a record or --status")
    if args.status:
        if args.status.resolve() != (ROOT / "docs" / "release" / "acceptance-status.json").resolve():
            raise SystemExit("--status must be docs/release/acceptance-status.json")
        status, errors, record = v10_evidence.load_status(ROOT)
        if errors:
            raise SystemExit("\n".join(errors))
        if record is None:
            print(f"Acceptance status {status.get('status')}: not claimed as passing evidence")
        else:
            waived = [name for name, _ in v10_evidence.waived_items(record)]
            print(f"Acceptance status {status.get('status')}: evidence record is internally consistent; "
                  f"{len(waived)} owner waivers are not passes: {', '.join(waived) or 'none'}")
        return
    if not args.record:
        raise SystemExit("Provide an evidence record or --status")
    errors = v10_evidence.evaluate(json.loads(args.record.read_text(encoding="utf-8")))
    if errors:
        raise SystemExit("\n".join(errors))
    print("10.0.0 candidate evidence record is internally consistent")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
