"""
Mandatory Fase 4c comparison test (`docs/RENCANA.md` PROMPT FASE 4c & `docs/FASE4_UI_SPEC.md` §10):
- `corpus/real/Facade only to Alfian.3dm` with default ProjectConfig (SF SNI 2020 Tabel 8, SC=SHGC/0,87 sejak Fase 5c) -> 36.76 W/m2
  (dulu 38.79 dengan tabel SF lama dan 0,86)
- Alternative using `glz_kaca_elektrokromik` (cloned ProjectConfig, unchanged ground plane) -> 26.46 W/m2 (dulu 27.71)
"""

from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import main as api_main
from config_schema import ProjectConfig


@pytest.fixture()
def client(tmp_path, monkeypatch):
    uploads_dir = str(tmp_path / "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    monkeypatch.setattr(api_main, "UPLOADS_DIR", uploads_dir)
    api_main.ANALYSIS_STORE.clear()
    with TestClient(api_main.app) as c:
        yield c


def test_compare_electrochromic_alfian_3dm_gives_26_46_vs_36_76(client):
    alfian_path = os.path.join(ROOT_DIR, "corpus", "real", "Facade only to Alfian.3dm")
    if not os.path.isfile(alfian_path):
        pytest.skip("corpus/real/Facade only to Alfian.3dm not present")

    with open(alfian_path, "rb") as f:
        up = client.post(
            "/api/models",
            files={"file": ("Facade only to Alfian.3dm", f, "application/octet-stream")},
        )
    assert up.status_code == 200, up.text
    model_id = up.json()["model_id"]

    base_cfg = ProjectConfig().model_dump(mode="json")
    r_base = client.post(f"/api/models/{model_id}/analyze", json=base_cfg)
    assert r_base.status_code == 200, r_base.text
    d_base = r_base.json()
    assert abs(float(d_base["ottv_total_wm2"]) - 36.76) <= 0.05

    alt_cfg = ProjectConfig().model_dump(mode="json")
    alt_cfg["settings"]["glazing_material_id"] = "glz_kaca_elektrokromik"
    r_alt = client.post(f"/api/models/{model_id}/analyze", json=alt_cfg)
    assert r_alt.status_code == 200, r_alt.text
    d_alt = r_alt.json()
    assert abs(float(d_alt["ottv_total_wm2"]) - 26.46) <= 0.05
    assert d_alt["ottv_total_wm2"] < d_base["ottv_total_wm2"]
    assert d_alt["ottv_total_wm2"] <= 35.0

    # Verify every active orientation improves
    base_ori = {o["code"]: o["ottv_orientation_wm2"] for o in d_base["orientation_breakdown"] if o["total_area_m2"] > 0.1}
    alt_ori = {o["code"]: o["ottv_orientation_wm2"] for o in d_alt["orientation_breakdown"] if o["total_area_m2"] > 0.1}
    for code in ("U", "T", "S", "B"):
        assert code in base_ori and code in alt_ori
        assert alt_ori[code] < base_ori[code]
