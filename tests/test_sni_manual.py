"""
Hand-calculated verification tests for SNI 6389:2020 Compliance Mode (Fase 3).
Tolerance: <= 0.01 W/m2 against manual substitution using SNI 6389:2020 tables:
  - Tabel 7  (TD_ek wall from massa_kg_m2)
  - Tabel 8  (SF 54 cities x 8 orientations + Roof/Horisontal)
  - Tabel 9  (TD_eq roof from massa_kg_m2)
  - Tabel A.5-A.8 (SC_eff horizontal overhang)
"""

import io
import json
import os
import sys
import tempfile

import openpyxl
import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import CustomMaterialSpec, ProjectConfig, SettingsConfig
from materials_and_epw import BUILTIN_MATERIALS
from ottv_engine import analyze_building_ottv
from report_exporter import generate_excel_report
from sni_tables import (
    SNI_TABLE_8_SOLAR_FACTOR,
    get_sceff_horizontal,
    get_sf_table8,
    get_tdek_roof,
    get_tdek_wall,
)


def _write_box_hbjson(path: str, overhang_depth_m: float = 0.0) -> str:
    """
    Creates an exact 10m x 10m x 4m 4-sided box (N, E, S, W) in meters with:
      - Total area per side Ao = 10 * 4 = 40.0 m2
      - Window aperture per side = 8m wide x 2m tall (Z = 1..3m) -> Ag = 16.0 m2 -> exact WWR = 40.0%
      - Opaque wall per side Aw = 24.0 m2 (60.0%)
      - Roof = 10m x 10m = 100.0 m2 at Z = 4.0m
      - Optional horizontal overhang of depth `overhang_depth_m` at Z = 3.0m directly above each window
        (R1 = overhang_depth_m / 2.0, tilt = 0 deg).
    """
    def _face_dict(pts):
        return {"type": "Face3D", "boundary": pts}

    # Outward normals (right-hand rule CCW viewed from outside):
    # North (+Y, y=10): (10,10,0)->(0,10,0)->(0,10,4)->(10,10,4)
    # East  (+X, x=10): (10,0,0)->(10,10,0)->(10,10,4)->(10,0,4)
    # South (-Y, y=0):  (0,0,0)->(10,0,0)->(10,0,4)->(0,0,4)
    # West  (-X, x=0):  (0,10,0)->(0,0,0)->(0,0,4)->(0,10,4)
    walls_spec = [
        (
            "Wall_North",
            [[10, 10, 0], [0, 10, 0], [0, 10, 4], [10, 10, 4]],
            [[9, 10, 1], [1, 10, 1], [1, 10, 3], [9, 10, 3]],
            [[9, 10, 3], [1, 10, 3], [1, 10 + overhang_depth_m, 3], [9, 10 + overhang_depth_m, 3]],
        ),
        (
            "Wall_East",
            [[10, 0, 0], [10, 10, 0], [10, 10, 4], [10, 0, 4]],
            [[10, 1, 1], [10, 9, 1], [10, 9, 3], [10, 1, 3]],
            [[10, 1, 3], [10, 9, 3], [10 + overhang_depth_m, 9, 3], [10 + overhang_depth_m, 1, 3]],
        ),
        (
            "Wall_South",
            [[0, 0, 0], [10, 0, 0], [10, 0, 4], [0, 0, 4]],
            [[1, 0, 1], [9, 0, 1], [9, 0, 3], [1, 0, 3]],
            [[1, 0, 3], [9, 0, 3], [9, -overhang_depth_m, 3], [1, -overhang_depth_m, 3]],
        ),
        (
            "Wall_West",
            [[0, 10, 0], [0, 0, 0], [0, 0, 4], [0, 10, 4]],
            [[0, 9, 1], [0, 1, 1], [0, 1, 3], [0, 9, 3]],
            [[0, 9, 3], [0, 1, 3], [-overhang_depth_m, 1, 3], [-overhang_depth_m, 9, 3]],
        ),
    ]

    faces = []
    for wid, w_pts, ap_pts, sh_pts in walls_spec:
        ap_obj = {"identifier": f"Ap_{wid}", "geometry": _face_dict(ap_pts)}
        if overhang_depth_m > 0.0:
            ap_obj["outdoor_shades"] = [{"identifier": f"Overhang_{wid}", "geometry": _face_dict(sh_pts)}]
        faces.append({
            "identifier": wid,
            "face_type": "Wall",
            "geometry": _face_dict(w_pts),
            "apertures": [ap_obj],
        })

    # Roof at Z=4.0m (upward normal +Z) & Floor at Z=0.0m (downward normal -Z)
    faces.append({
        "identifier": "Roof_Top",
        "face_type": "RoofCeiling",
        "geometry": _face_dict([[0, 0, 4], [10, 0, 4], [10, 10, 4], [0, 10, 4]]),
    })
    faces.append({
        "identifier": "Floor_Bottom",
        "face_type": "Floor",
        "geometry": _face_dict([[0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0]]),
    })

    hb_doc = {
        "type": "Model",
        "identifier": "SNI_Manual_Box_40WWR",
        "units": "Meters",
        "rooms": [{"identifier": "Room_1", "faces": faces}],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(hb_doc, f)
    return path


def _manual_sni_config(city: str, mode: str = "sni") -> ProjectConfig:
    return ProjectConfig(
        settings=SettingsConfig(
            city_preset=city,
            mode=mode,
            wall_material_id="test_wall_160",
            glazing_material_id="test_glz_igu",
            roof_material_id="rf_dak_beton_120_insulasi",
            custom_materials=[
                CustomMaterialSpec(
                    id="test_wall_160",
                    name="Dinding Uji AAC 160 kg/m2",
                    category="wall",
                    u_value=1.40,
                    alpha=0.50,
                    massa_kg_m2=160.0,  # Tabel 7: 126..195 -> TD_ek = 12 K
                    sumber="Uji Manual SNI 6389:2020",
                    status="datasheet",
                ),
                CustomMaterialSpec(
                    id="test_glz_igu",
                    name="Kaca Uji IGU U=1.90 SC=0.35",
                    category="glazing",
                    u_value=1.90,
                    sc=0.35,
                    massa_kg_m2=30.0,
                    sumber="Uji Manual SNI 6389:2020",
                    status="datasheet",
                ),
            ],
        )
    )


def test_sni_tables_completeness_and_material_metadata():
    assert len(SNI_TABLE_8_SOLAR_FACTOR) == 54
    assert get_sf_table8("jakarta", "U") == 148.0
    assert get_sf_table8("jakarta", "B") == 197.0
    assert get_sf_table8("jakarta", "ROOF") == 427.0
    assert get_sf_table8("surabaya", "T") == 194.0
    assert get_sf_table8("surabaya", "B") == 211.0
    assert get_tdek_wall(100.0) == 15.0
    assert get_tdek_wall(160.0) == 12.0
    assert get_tdek_wall(250.0) == 10.0
    assert get_tdek_roof(30.0) == 24.0
    assert get_tdek_roof(150.0) == 20.0
    assert get_tdek_roof(288.0) == 16.0
    # Every built-in material must carry massa_kg_m2, sumber, status (and no fake 'Terverifikasi')
    for mat in BUILTIN_MATERIALS:
        assert "massa_kg_m2" in mat and mat["massa_kg_m2"] > 0
        assert "sumber" in mat
        assert mat["status"] in ("datasheet", "nilai_tipikal")
        if not mat["sumber"]:
            assert mat["status"] == "nilai_tipikal"


def test_case1_box_wwr40_jakarta_matches_manual_calculation():
    """Case 1: 10x10x4m box, WWR 40%, Jakarta (no shading)."""
    # Manual calculation (SNI 6389:2020 Tabel 7 & Tabel 8):
    # alpha=0.50, Uw=1.40, TDek=12.0, WWR=0.40, Uf=1.90, deltaT=5.0, SC=0.35*1.0=0.35
    # Q_wall  = 0.50 * 1.40 * 0.60 * 12.0 = 5.04 W/m2
    # Q_glass = 1.90 * 0.40 * 5.0         = 3.80 W/m2
    # SF Jakarta: U=148, T=171, S=112, B=197
    # OTTV_U = 5.04 + 3.80 + 148*0.40*0.35 = 29.56
    # OTTV_T = 5.04 + 3.80 + 171*0.40*0.35 = 32.78
    # OTTV_S = 5.04 + 3.80 + 112*0.40*0.35 = 24.52
    # OTTV_B = 5.04 + 3.80 + 197*0.40*0.35 = 36.42
    # OTTV_total = (29.56 + 32.78 + 24.52 + 36.42) / 4 = 30.82 W/m2
    expected_by_ori = {"U": 29.56, "T": 32.78, "S": 24.52, "B": 36.42}
    expected_total = 30.82
    expected_rttv = 0.50 * 0.58 * 16.0  # 4.64 W/m2 (opaque roof <= 10 W/m2)

    fd, tmp_path = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        _write_box_hbjson(tmp_path, overhang_depth_m=0.0)
        cfg = _manual_sni_config("jakarta", mode="sni")
        res = analyze_building_ottv(tmp_path, "box_jakarta.hbjson", cfg.to_envelope_parameters())

        assert res["calculation_mode"] == "sni"
        assert res["is_compliance"] is True
        assert res["summary"]["is_provisional"] is False
        assert abs(res["summary"]["total_envelope_area_m2"] - 160.0) <= 0.05
        assert abs(res["summary"]["effective_wwr"] - 0.40) <= 0.002
        assert abs(res["ottv_total_wm2"] - expected_total) <= 0.01

        ori_map = {r["code"]: r for r in res["orientation_breakdown"]}
        for code, exp_val in expected_by_ori.items():
            assert abs(ori_map[code]["ottv_orientation_wm2"] - exp_val) <= 0.01, f"{code}: got {ori_map[code]['ottv_orientation_wm2']} vs {exp_val}"

        # RTTV Pasal 4.4 check
        rttv = res["rttv"]
        assert rttv["applicable"] is True
        assert abs(rttv["opaque_roof_area_m2"] - 100.0) <= 0.05
        assert abs(rttv["rttv_wm2"] - expected_rttv) <= 0.01
        assert rttv["limit_wm2"] == 10.0
        assert rttv["compliant"] is True

        # Excel report check: new title + 'Hitungan Manual' sheet
        xlsx_bytes = generate_excel_report(res)
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        assert "Hitungan Manual" in wb.sheetnames
        ws_man = wb["Hitungan Manual"]
        assert "Laporan Perhitungan OTTV mengacu SNI 6389:2020" in str(ws_man["B1"].value)
        assert "29.56" in str(ws_man["R5"].value)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_case2_box_wwr40_surabaya_matches_manual_calculation():
    """Case 2: 10x10x4m box, WWR 40%, Surabaya (no shading)."""
    # SF Surabaya (Tabel 8, hlm. 11): U=155, T=194, S=110, B=211
    # OTTV_U = 8.84 + 155*0.14 = 30.54
    # OTTV_T = 8.84 + 194*0.14 = 36.00
    # OTTV_S = 8.84 + 110*0.14 = 24.24
    # OTTV_B = 8.84 + 211*0.14 = 38.38
    # OTTV_total = (30.54 + 36.00 + 24.24 + 38.38) / 4 = 32.29 W/m2
    expected_by_ori = {"U": 30.54, "T": 36.00, "S": 24.24, "B": 38.38}
    expected_total = 32.29

    fd, tmp_path = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        _write_box_hbjson(tmp_path, overhang_depth_m=0.0)
        cfg = _manual_sni_config("surabaya", mode="sni")
        res = analyze_building_ottv(tmp_path, "box_surabaya.hbjson", cfg.to_envelope_parameters())

        assert res["is_compliance"] is True
        assert abs(res["ottv_total_wm2"] - expected_total) <= 0.01
        ori_map = {r["code"]: r for r in res["orientation_breakdown"]}
        for code, exp_val in expected_by_ori.items():
            assert abs(ori_map[code]["ottv_orientation_wm2"] - exp_val) <= 0.01
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_case3_box_wwr40_jakarta_with_overhang_matches_manual_calculation():
    """Case 3: 10x10x4m box, WWR 40%, Jakarta WITH 1.0m horizontal overhang (R1 = 1.0/2.0 = 0.5, Phi1 = 0 deg)."""
    # Tabel A.5 (U, S) R1=0.5, 0 deg -> SC_eff = 0.7210
    # Tabel A.6 (T, B) R1=0.5, 0 deg -> SC_eff = 0.7248
    sceff_us = get_sceff_horizontal("U", 0.5, 0.0)
    sceff_tb = get_sceff_horizontal("T", 0.5, 0.0)
    assert sceff_us == pytest.approx(0.7210, abs=1e-4)
    assert sceff_tb == pytest.approx(0.7248, abs=1e-4)

    expected_by_ori = {
        "U": 8.84 + 148.0 * 0.40 * (0.35 * sceff_us),
        "T": 8.84 + 171.0 * 0.40 * (0.35 * sceff_tb),
        "S": 8.84 + 112.0 * 0.40 * (0.35 * sceff_us),
        "B": 8.84 + 197.0 * 0.40 * (0.35 * sceff_tb),
    }
    expected_total = sum(expected_by_ori.values()) / 4.0  # 24.7365 W/m2

    fd, tmp_path = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        _write_box_hbjson(tmp_path, overhang_depth_m=1.0)
        cfg = _manual_sni_config("jakarta", mode="sni")
        res = analyze_building_ottv(tmp_path, "box_overhang.hbjson", cfg.to_envelope_parameters())

        assert res["is_compliance"] is True
        assert abs(res["ottv_total_wm2"] - expected_total) <= 0.01
        ori_map = {r["code"]: r for r in res["orientation_breakdown"]}
        for code, exp_val in expected_by_ori.items():
            assert abs(ori_map[code]["ottv_orientation_wm2"] - exp_val) <= 0.01
            assert abs(ori_map[code]["manual_calc"]["r1_horizontal"] - 0.50) <= 0.01

        # Verify 'simulasi' mode sets is_compliance=False and exploration label
        cfg_sim = _manual_sni_config("jakarta", mode="simulasi")
        res_sim = analyze_building_ottv(tmp_path, "box_overhang.hbjson", cfg_sim.to_envelope_parameters())
        assert res_sim["calculation_mode"] == "simulasi"
        assert res_sim["is_compliance"] is False
        assert "bukan untuk kepatuhan" in res_sim["mode_label"].lower()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
