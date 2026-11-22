"""Review Fase 4d/4e (22 Nov 2026): Indonesian decimal comma in recommender copy."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from recommender import _fmt_id  # noqa: E402


def test_fmt_id_uses_decimal_comma() -> None:
    assert _fmt_id(20.4321) == "20,43"
    assert _fmt_id(35.0, 1) == "35"
    assert _fmt_id(35.5, 1) == "35,5"
