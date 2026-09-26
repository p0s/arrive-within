#!/usr/bin/env python3
"""Profile-bound entry point used by the shared physical verification runner."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from physical_capture_contract import load_report, validate_report


def main(expected_capture_id: str, expected_locale: str, expected_namespace: str) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--marketing-version", required=True)
    parser.add_argument("--build-number", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--device-family", required=True)
    parser.add_argument("--device-model", required=True)
    parser.add_argument("--os-version", required=True)
    parser.add_argument("--started-after", required=True)
    args = parser.parse_args()
    try:
        report = load_report(args.report)
        if report.get("namespace") != expected_namespace:
            raise ValueError("report fixture namespace does not match the selected profile case")
        result = validate_report(
            report,
            expected_capture_id=expected_capture_id,
            expected_locale=expected_locale,
            bundle_id=args.bundle_id,
            marketing_version=args.marketing_version,
            build_number=args.build_number,
            source_commit=args.source_commit,
            device_family=args.device_family,
            device_model=args.device_model,
            os_version=args.os_version,
            started_after=args.started_after,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    print("This profile-bound validator must be called by its generated fixture wrapper.", file=sys.stderr)
    raise SystemExit(64)
