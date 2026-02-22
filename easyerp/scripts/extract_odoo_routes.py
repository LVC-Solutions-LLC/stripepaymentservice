#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROUTE_RE = re.compile(r"@http\.route\(([^\n]+)")


def parse_file(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    text = path.read_text(encoding="utf-8", errors="ignore")
    for i, line in enumerate(text.splitlines(), start=1):
        if "@http.route(" not in line:
            continue
        match = ROUTE_RE.search(line)
        if not match:
            continue
        rows.append({"file": str(path), "line": str(i), "route": match.group(1).strip()})
    return rows


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: extract_odoo_routes.py <addons_path>")
        return 1

    root = Path(sys.argv[1]).expanduser().resolve()
    results: list[dict[str, str]] = []

    for py_file in root.rglob("*.py"):
        if "controllers" not in py_file.parts:
            continue
        results.extend(parse_file(py_file))

    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
