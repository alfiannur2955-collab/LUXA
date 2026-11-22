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

from config_schema import CustomMaterialSpec, ProjectConfig, RolesConfig, SettingsConfig
from materials_and_epw import BUILTIN_MATERIALS, LEGACY_MATERIAL_ID_MAP, migrate_material_id
from ottv_engine import analyze_building_ottv
from report_exporter import generate_excel_report
from sni_tables import (
    SCEFF_1D_ANGLES_DEG,
    SNI_SCEFF_ERRATA,
    SNI_TABLE_8_SOLAR_FACTOR,
    SNI_TABLE_HORIZONTAL_SCEFF,
    SNI_TABLE_VERTICAL_SCEFF,
    TEMPLATE_PRODI_SF_TABLE,
    _get_cell_value_with_errata,
    get_sceff_horizontal,
    get_sceff_vertical,
    get_sceff_eggcrate,
    get_sf_for_source,
    get_sf_table8,
    get_tdek_roof,
    get_tdek_wall,
    lookup_sceff_detailed,
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


def _manual_sni_config(
    city: str,
    mode: str = "sni",
    sf_source: str = "sni2020",
    sceff_table_mode: str = "terkoreksi",
) -> ProjectConfig:
    return ProjectConfig(
        settings=SettingsConfig(
            city_preset=city,
            mode=mode,
            sf_source=sf_source,
            sceff_table_mode=sceff_table_mode,
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

        # Excel report check: new title + 'Hitungan Manual' sheet with exact SC = SCk * SCeff & recomputed OTTV_i
        xlsx_bytes = generate_excel_report(res)
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        assert "Hitungan Manual" in wb.sheetnames
        ws_man = wb["Hitungan Manual"]
        assert "Laporan Perhitungan OTTV mengacu SNI 6389:2020" in str(ws_man["B1"].value)
        assert "Tabel 8 SNI 6389:2020" in str(ws_man["B2"].value)
        assert "29.56" in str(ws_man["S5"].value)
        # Verify SC == SCk * SCeff and recomputed OTTV_i == engine ottv_orientation_wm2 within 0.01
        for row_idx in range(5, 13):
            ori_lbl = str(ws_man[f"B{row_idx}"].value or "")
            ao_v = float(ws_man[f"D{row_idx}"].value or 0.0)
            wwr_v = float(ws_man[f"E{row_idx}"].value or 0.0)
            alpha_v = float(ws_man[f"F{row_idx}"].value or 0.0)
            uw_v = float(ws_man[f"G{row_idx}"].value or 0.0)
            tdek_v = float(ws_man[f"H{row_idx}"].value or 0.0)
            uf_v = float(ws_man[f"I{row_idx}"].value or 0.0)
            dt_v = float(ws_man[f"J{row_idx}"].value or 0.0)
            sck_v = float(ws_man[f"K{row_idx}"].value or 0.0)
            sceff_v = float(ws_man[f"L{row_idx}"].value or 0.0)
            sc_v = float(ws_man[f"M{row_idx}"].value or 0.0)
            sf_v = float(ws_man[f"N{row_idx}"].value or 0.0)
            ottv_sheet = float(ws_man[f"R{row_idx}"].value or 0.0)
            assert abs(sc_v - (sck_v * sceff_v)) <= 1e-6
            recalc = alpha_v * uw_v * (1.0 - wwr_v) * tdek_v + uf_v * wwr_v * dt_v + sf_v * wwr_v * sc_v
            assert abs(recalc - ottv_sheet) <= 0.01
            code = ori_lbl.split()[0]
            if ao_v > 0:
                assert abs(ottv_sheet - ori_map[code]["ottv_orientation_wm2"]) <= 0.01
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


def test_sf_source_template_prodi_default_and_honest_labeling():
    """Default sf_source='template_prodi' uses 'ref.'!A5:J22 and NEVER claims 'Tabel 8 SNI 6389:2020'."""
    cfg_def = ProjectConfig()
    assert cfg_def.settings.sf_source == "template_prodi"
    assert cfg_def.settings.sceff_table_mode == "terkoreksi"

    # Generic catalog check: all built-ins have shgc on glazing and status='nilai_tipikal'
    for m in BUILTIN_MATERIALS:
        assert m["status"] == "nilai_tipikal"
        if m["category"] == "glazing":
            assert m.get("shgc") is not None and 0.05 <= m["shgc"] <= 1.0
    assert migrate_material_id("glz_saint_gobain_xtreme_60_28") == "glz_igu_triple_silver"
    assert len(LEGACY_MATERIAL_ID_MAP) >= 20

    fd, tmp_path = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        _write_box_hbjson(tmp_path, overhang_depth_m=0.0)
        cfg = _manual_sni_config("jakarta", mode="sni", sf_source="template_prodi")
        res = analyze_building_ottv(tmp_path, "box_tpl_sf.hbjson", cfg.to_envelope_parameters())

        assert res["sf_source"] == "template_prodi"
        assert "Template Prodi" in res["sf_source_label"]
        assert "Tabel 8" not in res["sf_source_label"]

        # Jakarta template_prodi SF: U=152, T=179, S=111, B=219
        ori_map = {r["code"]: r for r in res["orientation_breakdown"]}
        assert ori_map["U"]["sni_sf_wm2"] == 152.0
        assert ori_map["T"]["sni_sf_wm2"] == 179.0
        assert ori_map["S"]["sni_sf_wm2"] == 111.0
        assert ori_map["B"]["sni_sf_wm2"] == 219.0
        # SC_TO_SHGC_RATIO = 0.87 derives SHGC = 0.35 * 0.87, while template_prodi.xlsx divides D32 / 0.86
        exp_u = 8.84 + 152.0 * 0.40 * (round(0.35 * 0.87, 4) / 0.86)
        assert abs(ori_map["U"]["ottv_orientation_wm2"] - exp_u) <= 0.01

        xlsx_bytes = generate_excel_report(res)
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        ws_man = wb["Hitungan Manual"]
        assert "Template Prodi" in str(ws_man["B2"].value)
        assert "Tabel 8" not in str(ws_man["B2"].value)

        # Non-template city ('medan') resolves to nearest template city ('Pekanbaru') + SF_CITY_FALLBACK warning
        cfg_medan = _manual_sni_config("medan", mode="sni", sf_source="template_prodi")
        res_m = analyze_building_ottv(tmp_path, "box_medan.hbjson", cfg_medan.to_envelope_parameters())
        assert res_m["location_info"]["city"] == "Pekanbaru"
        assert any(w["code"] == "SF_CITY_FALLBACK" for w in res_m["warnings"])
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_hitungan_manual_multi_glass_shading_combos_not_averaged():
    """
    When one orientation has multiple glazing/shading combinations, 'Hitungan Manual'
    MUST emit one row per combination (not average them), with exact SC = SCk * SCeff
    and area-weighted recomputed OTTV_i matching engine ottv_orientation_wm2 <= 0.01 W/m2.
    """
    fd, tmp_path = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        # North wall (y=10) split into 2 apertures with different overhangs (0.0m vs 1.0m)
        def _fd(pts):
            return {"type": "Face3D", "boundary": pts}

        faces = [
            {
                "identifier": "Wall_North",
                "face_type": "Wall",
                "geometry": _fd([[10, 10, 0], [0, 10, 0], [0, 10, 4], [10, 10, 4]]),
                "apertures": [
                    {
                        "identifier": "Ap_North_Unshaded",
                        "display_name": "Glazing_Unshaded",
                        "geometry": _fd([[9, 10, 1], [5.5, 10, 1], [5.5, 10, 3], [9, 10, 3]]),
                    },
                    {
                        "identifier": "Ap_North_Shaded",
                        "display_name": "Glazing_Shaded",
                        "geometry": _fd([[4.5, 10, 1], [1, 10, 1], [1, 10, 3], [4.5, 10, 3]]),
                        "outdoor_shades": [
                            {
                                "identifier": "Overhang_N2",
                                "geometry": _fd([[4.5, 10, 3], [1, 10, 3], [1, 11.0, 3], [4.5, 11.0, 3]]),
                            }
                        ],
                    },
                ],
            },
            {
                "identifier": "Wall_South",
                "face_type": "Wall",
                "geometry": _fd([[0, 0, 0], [10, 0, 0], [10, 0, 4], [0, 0, 4]]),
            },
            {
                "identifier": "Wall_East",
                "face_type": "Wall",
                "geometry": _fd([[10, 0, 0], [10, 10, 0], [10, 10, 4], [10, 0, 4]]),
            },
            {
                "identifier": "Wall_West",
                "face_type": "Wall",
                "geometry": _fd([[0, 10, 0], [0, 0, 0], [0, 0, 4], [0, 10, 4]]),
            },
        ]
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump({"type": "Model", "identifier": "MultiCombo", "units": "Meters", "rooms": [{"identifier": "R1", "faces": faces}]}, f)

        cfg = _manual_sni_config("jakarta", mode="sni", sf_source="sni2020")
        res = analyze_building_ottv(tmp_path, "multi_combo.hbjson", cfg.to_envelope_parameters())
        ori_map = {r["code"]: r for r in res["orientation_breakdown"]}
        u_rows = ori_map["U"]["manual_calc"]["rows"]
        # North MUST have 2 distinct combination rows (SCeff=1.0 vs SCeff=0.7210)
        assert len(u_rows) == 2
        sceffs = sorted(r["sc_eff"] for r in u_rows)
        assert sceffs[0] == pytest.approx(0.7210, abs=0.002)
        assert sceffs[1] == pytest.approx(1.0000, abs=0.002)

        xlsx_bytes = generate_excel_report(res)
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        ws_man = wb["Hitungan Manual"]

        # Read all North rows (U #1, U #2) and Subtotal U
        u_sheet_rows = []
        sub_ottv = None
        for r_idx in range(5, 30):
            lbl = str(ws_man[f"B{r_idx}"].value or "")
            if lbl.startswith("U #"):
                ao_v = float(ws_man[f"D{r_idx}"].value)
                wwr_v = float(ws_man[f"E{r_idx}"].value)
                a_v = float(ws_man[f"F{r_idx}"].value)
                uw_v = float(ws_man[f"G{r_idx}"].value)
                td_v = float(ws_man[f"H{r_idx}"].value)
                uf_v = float(ws_man[f"I{r_idx}"].value)
                dt_v = float(ws_man[f"J{r_idx}"].value)
                sck_v = float(ws_man[f"K{r_idx}"].value)
                sceff_v = float(ws_man[f"L{r_idx}"].value)
                sc_v = float(ws_man[f"M{r_idx}"].value)
                sf_v = float(ws_man[f"N{r_idx}"].value)
                ottv_r = float(ws_man[f"R{r_idx}"].value)
                assert abs(sc_v - sck_v * sceff_v) <= 1e-6
                recalc = a_v * uw_v * (1.0 - wwr_v) * td_v + uf_v * wwr_v * dt_v + sf_v * wwr_v * sc_v
                assert abs(recalc - ottv_r) <= 0.01
                u_sheet_rows.append((ao_v, ottv_r))
            elif lbl.startswith("Subtotal U"):
                sub_ottv = float(ws_man[f"R{r_idx}"].value)

        assert len(u_sheet_rows) == 2
        weighted_u = sum(a * o for a, o in u_sheet_rows) / sum(a for a, _ in u_sheet_rows)
        assert sub_ottv is not None
        assert abs(weighted_u - ori_map["U"]["ottv_orientation_wm2"]) <= 0.01
        assert abs(sub_ottv - ori_map["U"]["ottv_orientation_wm2"]) <= 0.01
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_sceff_errata_smoothness_ketat_pdf_and_overhang_difference():
    """
    Tests all 3 SCeff errata invariants from docs/verifikasi_tabel_sni.md:
      (a) All horizontal & vertical table columns after errata have zero non-monotonic increases
          and zero upward jumps > 0.006 vs neighbor average.
      (b) table_mode='ketat_pdf' returns exact printed PDF values.
      (c) An overhang hitting a corrected cell (e.g. Tabel A.5 R1=1.2, 20 deg) gives different
          SCeff and OTTV between 'terkoreksi' and 'ketat_pdf', and records errata notes.
    """
    assert len(SNI_SCEFF_ERRATA) == 36

    # (a) Smoothness & monotonicity across ALL A.5..A.12 columns after errata
    for kind, tables_dict in (
        ("horizontal", SNI_TABLE_HORIZONTAL_SCEFF),
        ("vertical", SNI_TABLE_VERTICAL_SCEFF),
    ):
        for pair_key, tbl in tables_dict.items():
            rs = sorted(tbl.keys())
            for col_idx, ang in enumerate(SCEFF_1D_ANGLES_DEG):
                vals = [
                    _get_cell_value_with_errata(kind, pair_key, r, None, ang, tbl[r][col_idx], "terkoreksi")
                    for r in rs
                ]
                for i in range(1, len(vals)):
                    assert vals[i] <= vals[i - 1] + 1e-4, f"Non-monotonic {kind} {pair_key} R={rs[i]} {ang}°"
                for i in range(1, len(vals) - 1):
                    avg = 0.5 * (vals[i - 1] + vals[i + 1])
                    assert (vals[i] - avg) <= 0.006, f"Jump >0.006 at {kind} {pair_key} R={rs[i]} {ang}°"

    # (b) ketat_pdf returns exact printed values; terkoreksi returns corrected values
    assert get_sceff_horizontal("U", 1.2, 20.0, table_mode="ketat_pdf") == pytest.approx(0.6685, abs=1e-4)
    assert get_sceff_horizontal("U", 1.2, 20.0, table_mode="terkoreksi") == pytest.approx(0.6625, abs=1e-4)
    assert get_sceff_horizontal("T", 0.7, 50.0, table_mode="ketat_pdf") == pytest.approx(0.4581, abs=1e-4)
    assert get_sceff_horizontal("T", 0.7, 50.0, table_mode="terkoreksi") == pytest.approx(0.4851, abs=1e-4)
    assert get_sceff_vertical("U", 0.4, 30.0, table_mode="ketat_pdf") == pytest.approx(0.9325, abs=1e-4)
    assert get_sceff_vertical("U", 0.4, 30.0, table_mode="terkoreksi") == pytest.approx(0.8325, abs=1e-4)
    assert get_sceff_eggcrate("T", 1.8, 0.6, 20.0, table_mode="ketat_pdf") == pytest.approx(0.7065, abs=1e-4)
    assert get_sceff_eggcrate("T", 1.8, 0.6, 20.0, table_mode="terkoreksi") == pytest.approx(0.4065, abs=1e-4)

    det_corr = lookup_sceff_detailed("T", r1_horizontal=0.7, tilt_deg=50.0, table_mode="terkoreksi")
    assert det_corr["used_errata"] is True
    assert det_corr["sc_eff"] == pytest.approx(0.4851, abs=1e-4)
    assert det_corr["corrections"][0]["table"] == "A.6"

    det_pdf = lookup_sceff_detailed("T", r1_horizontal=0.7, tilt_deg=50.0, table_mode="ketat_pdf")
    assert det_pdf["used_errata"] is False
    assert det_pdf["sc_eff"] == pytest.approx(0.4581, abs=1e-4)

    # (c) End-to-end model with parametric overhang hitting Tabel A.6 R1=0.5, tilt=20° (0.6550 -> 0.6500)
    fd, tmp_path = tempfile.mkstemp(suffix=".hbjson")
    os.close(fd)
    try:
        _write_box_hbjson(tmp_path, overhang_depth_m=0.0)
        cfg_corr = _manual_sni_config("jakarta", mode="sni", sf_source="sni2020", sceff_table_mode="terkoreksi")
        cfg_corr.advanced.enable_parametric_louvers = True
        cfg_corr.advanced.louver_depth_m = 0.50
        cfg_corr.advanced.louver_spacing_m = 1.00  # R1 = 0.50
        cfg_corr.advanced.louver_tilt_deg = 20.0   # hits Tabel A.6 R1=0.5, 20° (0.6550 -> 0.6500)

        cfg_pdf = _manual_sni_config("jakarta", mode="sni", sf_source="sni2020", sceff_table_mode="ketat_pdf")
        cfg_pdf.advanced.enable_parametric_louvers = True
        cfg_pdf.advanced.louver_depth_m = 0.50
        cfg_pdf.advanced.louver_spacing_m = 1.00
        cfg_pdf.advanced.louver_tilt_deg = 20.0

        res_corr = analyze_building_ottv(tmp_path, "box_errata.hbjson", cfg_corr.to_envelope_parameters())
        res_pdf = analyze_building_ottv(tmp_path, "box_errata.hbjson", cfg_pdf.to_envelope_parameters())

        ori_corr = {r["code"]: r for r in res_corr["orientation_breakdown"]}
        ori_pdf = {r["code"]: r for r in res_pdf["orientation_breakdown"]}
        assert ori_corr["T"]["manual_calc"]["sc_eff"] == pytest.approx(0.6500, abs=1e-4)
        assert ori_pdf["T"]["manual_calc"]["sc_eff"] == pytest.approx(0.6550, abs=1e-4)
        assert ori_corr["T"]["ottv_orientation_wm2"] != ori_pdf["T"]["ottv_orientation_wm2"]
        assert len(res_corr["sceff_errata_applied"]) >= 1
        assert any(e["table"] == "A.6" for e in res_corr["sceff_errata_applied"])
        assert len(res_pdf["sceff_errata_applied"]) == 0

        # Confirm errata note appears in Hitungan Manual sheet
        xlsx_bytes = generate_excel_report(res_corr)
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        ws_man = wb["Hitungan Manual"]
        all_txt = " ".join(str(cell.value) for row in ws_man.iter_rows() for cell in row if cell.value is not None)
        assert "Tabel A.6" in all_txt
        assert "0.655 -> 0.65" in all_txt or "0.6550 -> 0.6500" in all_txt
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
