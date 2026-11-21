"""
Fase 0 — Baseline Snapshot Tool for OTTV 3D Parametric Studio
=============================================================
Runs `universal_pipeline.load_universal_model_stages_1_and_2()` and
`ottv_engine.analyze_building_ottv()` with default `EnvelopeParameters()`
on every 3D/BIM fixture inside `fixtures/` and saves a deterministic
snapshot to `fixtures/baseline.json`.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List

import numpy as np

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
FIXTURES_DIR = os.path.join(PROJECT_ROOT, "fixtures")
BASELINE_PATH = os.path.join(FIXTURES_DIR, "baseline.json")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from universal_pipeline import load_universal_model_stages_1_and_2  # noqa: E402
from ottv_engine import EnvelopeParameters, analyze_building_ottv  # noqa: E402

FIXTURE_EXTENSIONS = (".3dm", ".ifc", ".obj", ".glb", ".gltf", ".hbjson", ".json", ".stl", ".ply")
ORIENTATION_ORDER = ["U", "TL", "T", "TGR", "S", "BD", "B", "BL"]


def list_fixture_files(fixtures_dir: str = FIXTURES_DIR) -> List[str]:
    """Returns deterministically sorted fixture filenames (excluding baseline.json)."""
    if not os.path.isdir(fixtures_dir):
        return []
    files: List[str] = []
    for name in sorted(os.listdir(fixtures_dir), key=lambda s: s.lower()):
        if name.lower() == "baseline.json":
            continue
        ext = os.path.splitext(name.lower())[1]
        full = os.path.join(fixtures_dir, name)
        if ext in FIXTURE_EXTENSIONS and os.path.isfile(full):
            files.append(name)
    return files


def evaluate_fixture(filepath: str, filename: str) -> Dict[str, Any]:
    """
    Evaluates a single fixture using default EnvelopeParameters and extracts
    all Stage 1+2 geometry metrics and full OTTV SNI 6389:2020 metrics.
    """
    params = EnvelopeParameters()

    # 1. Stage 1 & 2 universal loader
    raw_groups, audit = load_universal_model_stages_1_and_2(
        filepath=filepath,
        unit_mode=params.unit_mode,
        up_axis=params.up_axis,
        nurbs_u_div=params.nurbs_u_div,
        nurbs_v_div=params.nurbs_v_div,
        auto_split_merged_cw=params.auto_split_merged_cw,
        groups_to_auto_split=params.groups_to_auto_split,
        frame_width_threshold_m=params.frame_width_threshold_m,
        spandrel_height_threshold_m=params.spandrel_height_threshold_m,
    )

    all_verts = np.vstack([rg.vertices for rg in raw_groups]) if raw_groups else np.zeros((1, 3), dtype=np.float64)
    b_min = [round(float(x), 4) for x in np.min(all_verts, axis=0)]
    b_max = [round(float(x), 4) for x in np.max(all_verts, axis=0)]
    b_span = [round(float(b_max[i] - b_min[i]), 4) for i in range(3)]

    stage12_groups = sorted(
        [
            {
                "group_name": rg.group_name,
                "category": rg.default_category,
                "face_count": int(len(rg.faces)),
            }
            for rg in raw_groups
        ],
        key=lambda g: (g["group_name"], g["category"], g["face_count"]),
    )

    # 2. Full OTTV SNI 6389:2020 analysis with default EnvelopeParameters
    ottv_res = analyze_building_ottv(filepath, filename, params)

    outer_area_by_role: Dict[str, float] = {}
    for g in ottv_res.get("groups", []):
        role = str(g.get("category") or "unknown")
        area = float(g.get("outer_area_m2") or 0.0)
        outer_area_by_role[role] = round(outer_area_by_role.get(role, 0.0) + area, 4)
    outer_area_by_role = dict(sorted(outer_area_by_role.items()))

    orient_map = {row["code"]: row for row in ottv_res.get("orientation_breakdown", [])}
    ottv_by_orientation: Dict[str, Dict[str, float]] = {}
    for code in ORIENTATION_ORDER:
        row = orient_map.get(code, {})
        ottv_by_orientation[code] = {
            "ottv_wm2": round(float(row.get("ottv_orientation_wm2", 0.0)), 4),
            "area_m2": round(float(row.get("total_area_m2", 0.0)), 4),
        }

    summary = ottv_res.get("summary", {})
    return {
        "filename": filename,
        "group_count": len(stage12_groups),
        "groups": stage12_groups,
        "bbox": {
            "min": b_min,
            "max": b_max,
            "span": b_span,
            "normalized_span_m": [round(float(x), 4) for x in audit.normalized_span_m],
        },
        "z_ground_offset_m": round(float(audit.z_ground_offset_m), 4),
        "slivers_removed": int(audit.slivers_removed),
        "outer_area_by_role": outer_area_by_role,
        "total_envelope_area_m2": round(float(summary.get("total_envelope_area_m2", 0.0)), 4),
        "total_floors": int(summary.get("total_floors", 0)),
        "wwr": round(float(summary.get("effective_wwr", 0.0)), 4),
        "ottv_total_wm2": round(float(ottv_res.get("ottv_total_wm2", 0.0)), 4),
        "ottv_by_orientation": ottv_by_orientation,
    }


def evaluate_all_fixtures(fixtures_dir: str = FIXTURES_DIR) -> Dict[str, Any]:
    files = list_fixture_files(fixtures_dir)
    if not files:
        raise RuntimeError(f"Tidak ada file fixture ditemukan di: {fixtures_dir}")

    fixtures_data: Dict[str, Any] = {}
    for fname in files:
        fpath = os.path.join(fixtures_dir, fname)
        t0 = time.time()
        entry = evaluate_fixture(fpath, fname)
        dt = time.time() - t0
        fixtures_data[fname] = entry
        print(
            f"[OK {dt:5.2f}s] {fname:38s} | groups={entry['group_count']:2d} | "
            f"slivers={entry['slivers_removed']:4d} | area={entry['total_envelope_area_m2']:8.2f} m2 | "
            f"WWR={entry['wwr']*100:5.1f}% | OTTV={entry['ottv_total_wm2']:6.2f} W/m2",
            flush=True,
        )

    return {
        "schema_version": 1,
        "fixture_count": len(fixtures_data),
        "fixtures": fixtures_data,
    }


def main() -> None:
    print(f"Menjalankan snapshot baseline untuk fixture di: {FIXTURES_DIR}", flush=True)
    snapshot = evaluate_all_fixtures(FIXTURES_DIR)
    with open(BASELINE_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
    print(f"\nBaseline tersimpan ke: {BASELINE_PATH} ({snapshot['fixture_count']} fixture)")


if __name__ == "__main__":
    main()
