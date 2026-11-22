"""Fase 5a: the `.3dm.json` loader branch (browser path, rhino3dm.js extraction) must give
the same result as the native rhino3dm `.3dm` branch.

tests/data/*.3dm.json were produced by spike-pyodide/rhino_extract.mjs from the synthetic
fixtures (simple box, nested blocks, Brep without render mesh).
"""

import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from config_schema import ProjectConfig  # noqa: E402
from ottv_engine import analyze_building_ottv  # noqa: E402
from universal_pipeline import load_universal_model_stages_1_and_2  # noqa: E402

CASES = [
    ("01_kotak_m", "kotak_m"),
    ("11_blok_bersarang", "blok_bersarang"),
    ("12_brep_tanpa_mesh", "brep_tanpa_mesh"),
]


@pytest.mark.parametrize("fixture_dir,payload_name", CASES)
def test_pre_extracted_3dm_matches_native(tmp_path, fixture_dir, payload_name) -> None:
    native = ROOT / "fixtures" / "synthetic" / fixture_dir / "model.3dm"
    payload = tmp_path / "model.3dm.json"
    shutil.copy(ROOT / "tests" / "data" / f"{payload_name}.3dm.json", payload)

    groups_n, audit_n = load_universal_model_stages_1_and_2(str(native))
    groups_b, audit_b = load_universal_model_stages_1_and_2(str(payload))
    assert sorted(g.group_name for g in groups_b) == sorted(g.group_name for g in groups_n)
    assert audit_b.detected_unit == audit_n.detected_unit
    assert len(audit_b.missing_mesh) == len(audit_n.missing_mesh)

    from adapters import detect_file_signature

    shutil.copy(native, tmp_path / "model.3dm")
    assert detect_file_signature(str(payload))["detected_software_label"] == detect_file_signature(str(native))["detected_software_label"]

    params = ProjectConfig().to_envelope_parameters()
    res_n = analyze_building_ottv(str(native), "model.3dm", params)
    res_b = analyze_building_ottv(str(payload), "model.3dm", params)
    assert abs(float(res_b["ottv_total_wm2"]) - float(res_n["ottv_total_wm2"])) <= 0.01
    assert len(res_b.get("panels") or []) == len(res_n.get("panels") or [])
