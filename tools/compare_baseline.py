"""
Baseline Comparison Tool for OTTV 3D Parametric Studio
======================================================
Re-runs all fixtures with default `ProjectConfig()` (mode `'sni'`,
`sf_source='sni2020'`) and compares every recorded metric against
`fixtures/baseline.json`, printing a clear diff table and returning exit
code 0 if and only if 0 diffs occur.
"""

from __future__ import annotations

import json
import math
import os
import sys
from typing import Any, Dict, List, Tuple

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

from snapshot_baseline import (  # noqa: E402
    BASELINE_PATH,
    FIXTURES_DIR,
    ORIENTATION_ORDER,
    evaluate_all_fixtures,
)

FLOAT_TOL = 1e-4


def _floats_equal(a: float, b: float, tol: float = FLOAT_TOL) -> bool:
    return math.isclose(float(a), float(b), rel_tol=0.0, abs_tol=tol)


def compare_fixture_records(fname: str, base: Dict[str, Any], cur: Dict[str, Any]) -> List[Tuple[str, str, Any, Any, str]]:
    """Returns a list of `(fixture, metric, baseline_val, current_val, delta_str)` for every mismatch."""
    diffs: List[Tuple[str, str, Any, Any, str]] = []

    def check_scalar(metric: str, b_val: Any, c_val: Any, is_float: bool = False) -> None:
        if is_float:
            if not _floats_equal(b_val, c_val):
                diffs.append((fname, metric, b_val, c_val, f"{float(c_val) - float(b_val):+.4f}"))
        else:
            if b_val != c_val:
                delta = f"{int(c_val) - int(b_val):+d}" if isinstance(b_val, int) and isinstance(c_val, int) else "CHANGED"
                diffs.append((fname, metric, b_val, c_val, delta))

    check_scalar("group_count", base.get("group_count"), cur.get("group_count"), is_float=False)
    check_scalar("z_ground_offset_m", base.get("z_ground_offset_m", 0.0), cur.get("z_ground_offset_m", 0.0), is_float=True)
    check_scalar("slivers_removed", base.get("slivers_removed", 0), cur.get("slivers_removed", 0), is_float=False)
    check_scalar("total_envelope_area_m2", base.get("total_envelope_area_m2", 0.0), cur.get("total_envelope_area_m2", 0.0), is_float=True)
    check_scalar("total_floors", base.get("total_floors", 0), cur.get("total_floors", 0), is_float=False)
    check_scalar("wwr", base.get("wwr", 0.0), cur.get("wwr", 0.0), is_float=True)
    check_scalar("ottv_total_wm2", base.get("ottv_total_wm2", 0.0), cur.get("ottv_total_wm2", 0.0), is_float=True)
    if base.get("ottv_error") != cur.get("ottv_error"):
        diffs.append((fname, "ottv_error", base.get("ottv_error"), cur.get("ottv_error"), "DIFF"))

    # Compare bounding box vectors
    b_box = base.get("bbox", {})
    c_box = cur.get("bbox", {})
    for bk in ("min", "max", "span", "normalized_span_m"):
        bv = b_box.get(bk, [])
        cv = c_box.get(bk, [])
        if len(bv) != len(cv) or any(not _floats_equal(x, y) for x, y in zip(bv, cv)):
            diffs.append((fname, f"bbox.{bk}", bv, cv, "DIFF"))

    # Compare per-group category & face count
    b_grps = {(g["group_name"], g["category"]): g["face_count"] for g in base.get("groups", [])}
    c_grps = {(g["group_name"], g["category"]): g["face_count"] for g in cur.get("groups", [])}
    for gk in sorted(set(b_grps.keys()) | set(c_grps.keys())):
        bv = b_grps.get(gk)
        cv = c_grps.get(gk)
        if bv != cv:
            delta = f"{cv - bv:+d}" if isinstance(bv, int) and isinstance(cv, int) else ("ADDED" if bv is None else "REMOVED")
            diffs.append((fname, f"group[{gk[0]}:{gk[1]}].faces", bv, cv, delta))

    # Compare outer area per role
    b_roles = base.get("outer_area_by_role", {})
    c_roles = cur.get("outer_area_by_role", {})
    for rk in sorted(set(b_roles.keys()) | set(c_roles.keys())):
        bv = float(b_roles.get(rk, 0.0))
        cv = float(c_roles.get(rk, 0.0))
        if not _floats_equal(bv, cv):
            diffs.append((fname, f"outer_area[{rk}]", bv, cv, f"{cv - bv:+.4f}"))

    # Compare 8 orientations OTTV & area
    b_ori = base.get("ottv_by_orientation", {})
    c_ori = cur.get("ottv_by_orientation", {})
    for code in ORIENTATION_ORDER:
        bo = b_ori.get(code, {})
        co = c_ori.get(code, {})
        check_scalar(f"ori[{code}].ottv_wm2", bo.get("ottv_wm2", 0.0), co.get("ottv_wm2", 0.0), is_float=True)
        check_scalar(f"ori[{code}].area_m2", bo.get("area_m2", 0.0), co.get("area_m2", 0.0), is_float=True)

    return diffs


def main() -> None:
    if not os.path.isfile(BASELINE_PATH):
        print(f"ERROR: File baseline tidak ditemukan di {BASELINE_PATH}. Jalankan tools/snapshot_baseline.py terlebih dahulu.")
        sys.exit(2)

    with open(BASELINE_PATH, "r", encoding="utf-8") as f:
        baseline = json.load(f)

    print(f"Membandingkan hasil saat ini terhadap: {BASELINE_PATH}\n", flush=True)
    current = evaluate_all_fixtures(FIXTURES_DIR)

    base_map = baseline.get("fixtures", {})
    cur_map = current.get("fixtures", {})
    all_names = sorted(set(base_map.keys()) | set(cur_map.keys()), key=lambda s: s.lower())

    all_diffs: List[Tuple[str, str, Any, Any, str]] = []
    print("\n" + "=" * 110)
    print(f"{'FIXTURE':38s} | {'GRUP':>5s} | {'LUAS (m2)':>10s} | {'WWR':>7s} | {'OTTV':>8s} | {'SELISIH':>8s}")
    print("-" * 110)

    for fname in all_names:
        if fname not in base_map:
            all_diffs.append((fname, "fixture", None, "PRESENT", "ADDED"))
            print(f"{fname:38s} | {'-':>5s} | {'-':>10s} | {'-':>7s} | {'-':>8s} | {'ADDED':>8s}")
            continue
        if fname not in cur_map:
            all_diffs.append((fname, "fixture", "PRESENT", None, "MISSING"))
            print(f"{fname:38s} | {'-':>5s} | {'-':>10s} | {'-':>7s} | {'-':>8s} | {'MISSING':>8s}")
            continue

        f_diffs = compare_fixture_records(fname, base_map[fname], cur_map[fname])
        all_diffs.extend(f_diffs)
        c = cur_map[fname]
        print(
            f"{fname:38s} | {c['group_count']:5d} | {c['total_envelope_area_m2']:10.2f} | "
            f"{c['wwr']*100:6.1f}% | {c['ottv_total_wm2']:8.2f} | {len(f_diffs):8d}"
        )

    print("=" * 110)

    if all_diffs:
        print(f"\nDETAIL SELISIH ({len(all_diffs)} perbedaan):")
        print(f"{'FIXTURE':34s} | {'METRIK':32s} | {'BASELINE':16s} | {'SAAT INI':16s} | {'DELTA':>10s}")
        print("-" * 118)
        for fn, metric, bv, cv, delta in all_diffs:
            print(f"{fn:34s} | {metric:32s} | {str(bv):16s} | {str(cv):16s} | {delta:>10s}")
        print(f"\nHASIL: {len(all_diffs)} selisih ditemukan.")
        sys.exit(1)
    else:
        print("\nHASIL: 0 selisih (100% identik dengan fixtures/baseline.json).")
        sys.exit(0)


if __name__ == "__main__":
    main()
