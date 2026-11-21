"""
Tests for Fase 4b-2:
- GET /api/analyses/{id}/exposure?date=YYYY-MM-DD (13 hourly solar vectors 06..18 + sunlit flags)
- Caching & error handling (404 unknown analysis, 400 invalid date)
- Mandatory acceptance verification with `corpus/real/Facade only to Alfian.3dm`:
  * West glass panel contribution == 56.44 W/m2
  * All West glass heat share ~= 32% of total building heat gain
  * Exposure on 23 Sep at 13:00 lights up West facade panels and does NOT light up South facade panels
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


def test_exposure_endpoint_basic_and_errors(client):
    ana_resp = client.post(
        "/api/models/contoh_kotak_m/analyze",
        json=ProjectConfig().model_dump(mode="json"),
    )
    assert ana_resp.status_code == 200, ana_resp.text
    aid = ana_resp.json()["analysis_id"]

    exp_resp = client.get(f"/api/analyses/{aid}/exposure?date=2026-09-23")
    assert exp_resp.status_code == 200, exp_resp.text
    exp = exp_resp.json()
    assert exp["analysis_id"] == aid
    assert exp["date"] == "2026-09-23"
    assert exp["hours"] == list(range(6, 19))
    assert len(exp["solar_vectors"]) == 13
    assert len(exp["panel_ids"]) == len(exp["sunlit_masks"])
    assert len(exp["panel_ids"]) > 0
    assert "13" in exp["sunlit_by_hour"]

    # Second call hits cache identically
    exp_resp2 = client.get(f"/api/analyses/{aid}/exposure?date=2026-09-23")
    assert exp_resp2.status_code == 200
    assert exp_resp2.json()["sunlit_masks"] == exp["sunlit_masks"]

    # Invalid analysis_id -> 404; invalid date -> 400
    assert client.get("/api/analyses/does_not_exist/exposure?date=2026-09-23").status_code == 404
    assert client.get(f"/api/analyses/{aid}/exposure?date=not-a-date").status_code == 400


def test_alfian_3dm_west_glass_56_44_heat_share_32_pct_and_sep23_13h_exposure(client):
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

    ana = client.post(
        f"/api/models/{model_id}/analyze",
        json=ProjectConfig().model_dump(mode="json"),
    )
    assert ana.status_code == 200, ana.text
    data = ana.json()
    aid = data["analysis_id"]

    active_panels = [p for p in data["panels"] if p.get("active")]
    total_heat_w = sum(float(p.get("heat_gain_w") or 0.0) for p in active_panels)
    assert total_heat_w > 0.0

    # 1. West glazing panels -> 56.44 W/m2 contribution
    west_glz = [
        p
        for p in active_panels
        if p.get("orientation_code") == "B" and p.get("element_type") == "glazing"
    ]
    assert len(west_glz) > 0
    west_glz_vals = [float(p["ottv_panel_wm2"]) for p in west_glz]
    assert any(abs(v - 56.44) <= 0.15 for v in west_glz_vals), (
        f"Expected West glass panel contribution ~56.44 W/m2, got min={min(west_glz_vals):.2f}, max={max(west_glz_vals):.2f}"
    )

    # 2. All West glazing heat share ~= 32% of total building heat gain
    west_glz_heat_w = sum(float(p.get("heat_gain_w") or 0.0) for p in west_glz)
    west_glz_share = west_glz_heat_w / total_heat_w
    assert 0.30 <= west_glz_share <= 0.34, f"Expected West glass heat share ~32%, got {west_glz_share*100:.2f}%"

    # 3. Exposure on 23 Sep at 13:00 lights up West facade and does NOT light up South facade
    exp_resp = client.get(f"/api/analyses/{aid}/exposure?date=2026-09-23")
    assert exp_resp.status_code == 200, exp_resp.text
    exp = exp_resp.json()
    sunlit_13 = set(exp["sunlit_by_hour"]["13"])

    west_ids = {p["id"] for p in active_panels if p.get("orientation_code") == "B"}
    south_ids = {p["id"] for p in active_panels if p.get("orientation_code") == "S"}
    assert len(west_ids) > 0
    assert len(south_ids) > 0

    west_lit_count = len(west_ids & sunlit_13)
    south_lit_count = len(south_ids & sunlit_13)
    assert west_lit_count > 0, "23 Sep 13:00 must light up West facade panels"
    assert south_lit_count == 0, f"23 Sep 13:00 must NOT light up South facade panels, got {south_lit_count} lit"
