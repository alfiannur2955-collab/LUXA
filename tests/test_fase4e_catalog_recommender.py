"""
Comprehensive Fase 4e Backend Tests (`docs/RENCANA.md` Tes 4e):
1. Brand material library JSON validation (62 entries, official URL, SC 0.05..1, VLT 0..1, SHGC ~= SC*0.87 +-0.03, no prices).
2. Stateless `/api/materials/validate` and removal of global `CUSTOM_MATERIALS` & `generate_material_recommendations`.
3. `POST /api/analyses/{id}/rematerial` parity <= 0.01 W/m² vs full `analyze_building_ottv` across 5 fixtures (< 300 ms).
4. Per-group recommendation ranking accuracy (glazing_all, glazing_orientation, wall_all, filters).
5. `optimize_material_combinations` exact match vs exhaustive brute-force on a small multi-orientation case.
"""

from __future__ import annotations

import itertools
import json
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main as api_main
import materials_and_epw as me
from config_schema import ProjectConfig, SettingsConfig
from ottv_engine import analyze_building_ottv
from recommender import (
    optimize_material_combinations,
    recommend_for_target,
    rematerial_analysis,
)

LIB_PATH = BACKEND_DIR / "data" / "material_library.json"
SYNTH_DIR = ROOT_DIR / "fixtures" / "synthetic"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    uploads_dir = str(tmp_path / "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    monkeypatch.setattr(api_main, "UPLOADS_DIR", uploads_dir)
    api_main.ANALYSIS_STORE.clear()
    with TestClient(api_main.app) as c:
        yield c


def test_brand_material_library_json_validation() -> None:
    assert LIB_PATH.is_file(), "backend/data/material_library.json must exist"
    assert not (ROOT_DIR / "docs" / "fase4" / "material_library.json").exists(), (
        "docs/fase4/material_library.json should be moved to backend/data/"
    )

    raw = json.loads(LIB_PATH.read_text(encoding="utf-8"))
    mats = raw["materials"]
    assert len(mats) == 62

    seen_ids: set[str] = set()
    for m in mats:
        mid = m["id"]
        assert mid not in seen_ids, f"Duplicate ID: {mid}"
        seen_ids.add(mid)
        assert m["origin"] == "brand_reference"
        url = str(m.get("sumber") or "")
        assert url.startswith(("http://", "https://")), f"{mid}: brand_reference must have http(s) URL"
        assert m.get("tanggal_akses"), f"{mid}: missing tanggal_akses"
        assert "price" not in m and "harga" not in m, f"{mid}: built-in data must never include price"

        sc = float(m["sc"])
        shgc = float(m["shgc"])
        vlt = float(m["vlt"])
        assert 0.05 <= sc <= 1.0, f"{mid}: SC out of range ({sc})"
        assert 0.0 <= vlt <= 1.0, f"{mid}: VLT out of range ({vlt})"
        expected_shgc = sc * 0.87
        assert abs(shgc - expected_shgc) <= 0.03 + 1e-6, (
            f"{mid}: SHGC={shgc} deviates >0.03 from SC*0.87={expected_shgc:.4f}"
        )

    # Merged catalog contains generic SNI + all 62 brand materials
    all_mats = me.get_all_materials()
    assert len(all_mats) >= len(me.BUILTIN_MATERIALS) + 62
    assert any(m.get("origin") == "sni_generic" for m in all_mats)
    assert sum(1 for m in all_mats if m.get("origin") == "brand_reference") == 62


def test_custom_materials_removed_and_stateless_validate_works(client) -> None:
    assert not hasattr(me, "CUSTOM_MATERIALS")
    assert not hasattr(me, "generate_material_recommendations")

    # Old /api/materials/custom is gone (404 or 405 from SPA fallback)
    r_old = client.post("/api/materials/custom", json={"name": "X", "category": "glazing", "u_value": 2.0})
    assert r_old.status_code in (404, 405)

    # New /api/materials/validate computes TD_EK and SHGC without mutating server catalog
    before_count = len(client.get("/api/materials").json()["materials"])

    r_glz = client.post(
        "/api/materials/validate",
        json={"name": "Kaca Uji", "category": "glazing", "u_value": 1.6, "sc": 0.40, "vlt": 0.55},
    )
    assert r_glz.status_code == 200, r_glz.text
    d_glz = r_glz.json()
    assert d_glz["sc"] == pytest.approx(0.40, abs=1e-4)
    assert d_glz["shgc"] == pytest.approx(0.40 * 0.87, abs=1e-4)
    assert d_glz["material"]["origin"] == "user"

    r_wall = client.post(
        "/api/materials/validate",
        json={"name": "Dinding Bata Uji", "category": "wall", "u_value": 1.4, "alpha": 0.55, "massa_kg_m2": 180.0},
    )
    assert r_wall.status_code == 200, r_wall.text
    assert r_wall.json()["td_ek"] == 12.0

    after_count = len(client.get("/api/materials").json()["materials"])
    assert after_count == before_count, "validate endpoint must remain strictly stateless"


@pytest.mark.parametrize(
    "rel_path,new_glz_id,new_wall_id,ori_overrides",
    [
        ("01_kotak_m/model.3dm", "glz_asahimas_stopsol_classic_dark_blue_single6", "wal_bata_ringan_aac_100", {}),
        ("02_kotak_mm/model.3dm", "glz_kaca_elektrokromik", "wal_spandrel_insulasi_50", {"B": "glz_igu_triple_silver"}),
        ("05_denah_L/model.3dm", "glz_kaca_lowe_single_8", "wal_acp_insulasi_aac", {"T": "glz_kaca_elektrokromik"}),
        ("06_courtyard/model.3dm", "glz_igu_lowe_selektif", "wal_beton_pracetak_120", {}),
        ("07_silinder/model.3dm", "glz_kaca_tinted_hijau_8", "wal_spandrel_insulasi_50", {"B": "glz_kaca_elektrokromik"}),
    ],
)
def test_rematerial_matches_full_analysis_within_001_wm2_across_5_fixtures(
    rel_path: str,
    new_glz_id: str,
    new_wall_id: str,
    ori_overrides: dict,
) -> None:
    fpath = SYNTH_DIR / rel_path
    assert fpath.is_file(), f"Missing synthetic fixture: {fpath}"

    base_cfg = ProjectConfig()
    base_res = analyze_building_ottv(str(fpath), fpath.name, base_cfg.to_envelope_parameters())

    t0 = time.perf_counter()
    fast_res = rematerial_analysis(
        base_res,
        glazing_material_id=new_glz_id,
        wall_material_id=new_wall_id,
        orientation_material_overrides=ori_overrides,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    assert elapsed_ms < 300.0, f"rematerial took {elapsed_ms:.1f} ms (limit < 300 ms)"

    full_cfg = ProjectConfig(
        settings=SettingsConfig(
            glazing_material_id=new_glz_id,
            wall_material_id=new_wall_id,
            orientation_material_overrides=ori_overrides,
        )
    )
    full_res = analyze_building_ottv(str(fpath), fpath.name, full_cfg.to_envelope_parameters())

    assert abs(float(fast_res["ottv_total_wm2"]) - float(full_res["ottv_total_wm2"])) <= 0.01 + 1e-9, (
        f"{rel_path}: rematerial={fast_res['ottv_total_wm2']} vs full={full_res['ottv_total_wm2']}"
    )
    fast_ori = {o["code"]: o["ottv_orientation_wm2"] for o in fast_res["orientation_breakdown"] if o["total_area_m2"] > 0.1}
    full_ori = {o["code"]: o["ottv_orientation_wm2"] for o in full_res["orientation_breakdown"] if o["total_area_m2"] > 0.1}
    for code in full_ori:
        assert abs(fast_ori[code] - full_ori[code]) <= 0.02, (
            f"{rel_path} [{code}]: rematerial={fast_ori[code]} vs full={full_ori[code]}"
        )


def test_recommender_per_group_ranking_and_endpoint(client) -> None:
    fpath = SYNTH_DIR / "01_kotak_m" / "model.3dm"
    with open(fpath, "rb") as f:
        up = client.post("/api/models", files={"file": ("01_kotak_m.3dm", f, "application/octet-stream")})
    assert up.status_code == 200
    model_id = up.json()["model_id"]

    # Analyze with high-SC clear glass so OTTV is high and recommendations clearly reduce it
    cfg = ProjectConfig(settings=SettingsConfig(glazing_material_id="glz_kaca_polos_8")).model_dump(mode="json")
    r_ana = client.post(f"/api/models/{model_id}/analyze", json=cfg)
    assert r_ana.status_code == 200
    aid = r_ana.json()["analysis_id"]
    cur_ottv = float(r_ana.json()["ottv_total_wm2"])
    assert cur_ottv > 35.0

    # Per-group ranking for glazing_all with VLT >= 0.40
    r_rec = client.post(
        f"/api/analyses/{aid}/recommend",
        json={"mode": "target", "target_type": "glazing_all", "filters": {"min_vlt": 0.40}},
    )
    assert r_rec.status_code == 200, r_rec.text
    cands = r_rec.json()["candidates"]
    assert len(cands) >= 10
    # Must be sorted ascending by new_ottv_wm2 and respect min_vlt >= 0.40
    for i in range(len(cands) - 1):
        assert cands[i]["new_ottv_wm2"] <= cands[i + 1]["new_ottv_wm2"] + 1e-6
    for c in cands:
        assert c["vlt"] is not None and c["vlt"] >= 0.40 - 1e-9

    # Verify top candidate matches exact rematerial endpoint!
    top = cands[0]
    r_rem = client.post(
        f"/api/analyses/{aid}/rematerial",
        json={"glazing_material_id": top["material_id"]},
    )
    assert r_rem.status_code == 200
    assert abs(float(r_rem.json()["ottv_total_wm2"]) - float(top["new_ottv_wm2"])) <= 0.01


def test_optimize_combinations_matches_bruteforce_on_small_case() -> None:
    """
    Constructs a small 3-orientation synthetic analysis with 4 glazing candidates & prices
    and verifies `optimize_material_combinations` matches exhaustive brute-force across all
    3 criteria: least_changes, lowest_ottv, and lowest_cost.
    """
    synthetic_analysis = {
        "calculation_mode": "sni",
        "sf_source": "sni2020",
        "parameters_used": {
            "glazing_material_id": "m_base",
            "wall_material_id": "wal_spandrel_insulasi_50",
            "orientation_material_overrides": {},
        },
        "panels": [
            # North (100 m2 glazing, SF=130)
            {
                "id": "p_u",
                "active": True,
                "orientation_code": "U",
                "element_type": "glazing",
                "area_m2": 100.0,
                "wwr_panel": 1.0,
                "sf_wm2": 130.0,
                "sc_shading_multiplier": 1.0,
                "sc_glass": 0.80,
                "u_fen_eff": 5.6,
                "u_wall_eff": 0.6,
                "alpha_wall_eff": 0.4,
                "td_ek_eff": 15.0,
            },
            # East (100 m2 glazing, SF=180)
            {
                "id": "p_t",
                "active": True,
                "orientation_code": "T",
                "element_type": "glazing",
                "area_m2": 100.0,
                "wwr_panel": 1.0,
                "sf_wm2": 180.0,
                "sc_shading_multiplier": 1.0,
                "sc_glass": 0.80,
                "u_fen_eff": 5.6,
                "u_wall_eff": 0.6,
                "alpha_wall_eff": 0.4,
                "td_ek_eff": 15.0,
            },
            # West (100 m2 glazing, SF=220)
            {
                "id": "p_b",
                "active": True,
                "orientation_code": "B",
                "element_type": "glazing",
                "area_m2": 100.0,
                "wwr_panel": 1.0,
                "sf_wm2": 220.0,
                "sc_shading_multiplier": 1.0,
                "sc_glass": 0.80,
                "u_fen_eff": 5.6,
                "u_wall_eff": 0.6,
                "alpha_wall_eff": 0.4,
                "td_ek_eff": 15.0,
            },
        ],
    }

    extra = [
        {"id": "m_a", "name": "A", "brand": "TestBrand", "category": "glazing", "u_value": 4.0, "sc": 0.50, "vlt": 0.65, "origin": "user"},
        {"id": "m_b", "name": "B", "brand": "TestBrand", "category": "glazing", "u_value": 2.2, "sc": 0.30, "vlt": 0.50, "origin": "user"},
        {"id": "m_c", "name": "C", "brand": "TestBrand", "category": "glazing", "u_value": 1.4, "sc": 0.18, "vlt": 0.35, "origin": "user"},
    ]
    prices = {"m_a": 400_000.0, "m_b": 900_000.0, "m_c": 1_800_000.0}
    target = 85.0  # Current OTTV = (5.6*5 + 0.8*(130+180+220)/3) = 28 + 141.33 = 169.33 W/m2

    opt = optimize_material_combinations(
        synthetic_analysis,
        target_ottv_wm2=target,
        extra_materials=extra,
        prices_map=prices,
        constraints={"brands": ["TestBrand"]},
    )
    by_id = {o["option_id"]: o for o in opt["options"]}
    assert "least_changes" in by_id
    assert "lowest_ottv" in by_id
    assert "lowest_cost" in by_id

    # Exhaustive brute force over (keep, m_a, m_b, m_c)^3 = 64 combinations
    choices = [None, "m_a", "m_b", "m_c"]
    mat_lookup = {m["id"]: m for m in extra}
    sf_by_o = {"U": 130.0, "T": 180.0, "B": 220.0}

    bf_lowest_ottv = float("inf")
    bf_min_changes = 99
    bf_min_cost = float("inf")

    for combo in itertools.product(choices, repeat=3):
        ottv_sum = 0.0
        cost = 0.0
        changed = 0
        for code, mid in zip(("U", "T", "B"), combo):
            if mid is None:
                ottv_sum += 5.6 * 5.0 + 0.80 * sf_by_o[code]
            else:
                changed += 1
                m = mat_lookup[mid]
                ottv_sum += m["u_value"] * 5.0 + m["sc"] * sf_by_o[code]
                cost += prices[mid] * 100.0
        avg_ottv = ottv_sum / 3.0
        if avg_ottv < bf_lowest_ottv:
            bf_lowest_ottv = avg_ottv
        if avg_ottv <= target + 1e-6:
            if changed < bf_min_changes:
                bf_min_changes = changed
            if cost < bf_min_cost:
                bf_min_cost = cost

    assert abs(by_id["lowest_ottv"]["new_ottv_wm2"] - bf_lowest_ottv) <= 0.02
    assert by_id["least_changes"]["changed_count"] == bf_min_changes
    assert by_id["least_changes"]["meets_target"] is True
    assert by_id["lowest_cost"]["meets_target"] is True
    assert abs(by_id["lowest_cost"]["estimated_cost_rp"] - bf_min_cost) <= 1.0
