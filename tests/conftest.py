"""
Pytest session guard (S1): verifies that every literal `fixtures/...` path
referenced in `tests/*.py` exists on disk with EXACT case sensitivity so
Windows case-insensitive filesystems never mask Linux/CI path errors.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
TESTS_DIR = Path(__file__).resolve().parent
_FIXTURE_PATH_RE = re.compile(r"""["'](fixtures/[A-Za-z0-9_./\- ]+\.[A-Za-z0-9]+)["']""")


def _exists_exact_case(base_dir: Path, rel_path: str) -> tuple[bool, str]:
    cur = base_dir
    parts = [p for p in rel_path.replace("\\", "/").split("/") if p]
    for part in parts:
        if not cur.is_dir():
            return False, f"directory missing before '{part}' in '{rel_path}'"
        entries = os.listdir(cur)
        if part not in entries:
            ci_match = [e for e in entries if e.lower() == part.lower()]
            if ci_match:
                return False, f"case mismatch in '{rel_path}': referenced '{part}', actual on disk '{ci_match[0]}'"
            return False, f"missing path segment '{part}' in '{rel_path}'"
        cur = cur / part
    return True, ""


def pytest_sessionstart(session):
    errors: list[str] = []
    for test_file in sorted(TESTS_DIR.glob("test_*.py")):
        src = test_file.read_text(encoding="utf-8", errors="ignore")
        for m in _FIXTURE_PATH_RE.finditer(src):
            rel = m.group(1)
            ok, reason = _exists_exact_case(ROOT_DIR, rel)
            if not ok:
                errors.append(f"{test_file.name}: {reason}")
    if errors:
        raise AssertionError(
            "Exact-case fixture path check failed (S1):\n  - " + "\n  - ".join(errors)
        )
