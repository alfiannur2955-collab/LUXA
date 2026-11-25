"""
Uji C10 — Paritas rematerial_analysis vs analyze_building_ottv saat frame_width_mm berubah
==========================================================================================
Memastikan jalur cepat `rematerial_analysis` dan `browser_api.rematerial` dengan
`frame_width_mm` baru (0, 90, 150 mm) menghasilkan angka OTTV, U_f, A_frame, A_edge,
A_cog, breakdown per orientasi (termasuk q_wall/q_glass/q_solar_conduction_wm2),
breakdown per lantai, peringatan, dan panel aktif yang identik dengan hitung penuh.
"""

from __future__ import annotations

import os
import sys

import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import browser_api  # noqa: E402
from config_schema import ProjectConfig, SettingsConfig  # noqa: E402
from ottv_engine import analyze_building_ottv  # noqa: E402
from recommender import rematerial_analysis  # noqa: E402


@pytest.mark.parametrize(
    "rel_path,new_fw_mm",
    [
        ("fixtures/Honeybee_MultiZone_Office_3F.hbjson", 90.0),
        ("fixtures/Honeybee_MultiZone_Office_3F.hbjson", 0.0),
        ("fixtures/Honeybee_MultiZone_Office_3F.hbjson", 150.0),
        ("fixtures/synthetic/01_kotak_m/model.3dm", 110.0),
        ("fixtures/archicad_bim_curtainwall.ifc", 90.0),
    ],
)
def test_c10_rematerial_frame_width_identik_dengan_analyze_penuh(rel_path, new_fw_mm):
    """Mengubah frame_width_mm lewat rematerial_analysis harus identik dengan analyze_building_ottv penuh."""
    path = os.path.join(ROOT_DIR, rel_path)
    if not os.path.isfile(path):
        pytest.skip(f"fixture tidak ditemukan: {rel_path}")
    fn = os.path.basename(path)

    cfg_base = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=50.0))
    cfg_new = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=new_fw_mm))

    base = analyze_building_ottv(path, fn, cfg_base.to_envelope_parameters())
    fast = rematerial_analysis(base, frame_width_mm=new_fw_mm, materials_confirmed=True)
    full = analyze_building_ottv(path, fn, cfg_new.to_envelope_parameters())

    # 1. OTTV total & verdict
    assert abs(fast["ottv_total_wm2"] - full["ottv_total_wm2"]) <= 0.01
    assert fast["verdict"] == full["verdict"]

    # 2. Ringkasan 3-zona & komponen panas
    sf, sl = fast["summary"], full["summary"]
    for k, tol in (
        ("avg_u_fen_wm2k", 0.001),
        ("avg_u_cog_wm2k", 0.001),
        ("u_frame_eff_wm2k", 0.001),
        ("total_a_frame_m2", 0.05),
        ("total_a_edge_m2", 0.05),
        ("total_a_cog_m2", 0.05),
        ("frame_width_mm", 0.1),
        ("edge_frame_width_mm", 0.1),
        ("q_wall_conduction_wm2", 0.01),
        ("q_glass_conduction_wm2", 0.01),
        ("q_solar_radiation_wm2", 0.01),
    ):
        assert abs(float(sf[k]) - float(sl[k])) <= tol, f"{rel_path} fw={new_fw_mm} {k}: remat={sf[k]} vs full={sl[k]}"

    # 3. Breakdown per orientasi (termasuk key kanonik q_*_conduction_wm2 & manual_calc.u_f)
    ob_fast = {o["code"]: o for o in fast["orientation_breakdown"]}
    ob_full = {o["code"]: o for o in full["orientation_breakdown"]}
    for code, o_full in ob_full.items():
        o_fast = ob_fast[code]
        assert abs(o_fast["ottv_orientation_wm2"] - o_full["ottv_orientation_wm2"]) <= 0.01, (code, o_fast, o_full)
        assert abs(o_fast["q_wall_conduction_wm2"] - o_full["q_wall_conduction_wm2"]) <= 0.01, code
        assert abs(o_fast["q_glass_conduction_wm2"] - o_full["q_glass_conduction_wm2"]) <= 0.01, code
        assert abs(o_fast["q_solar_radiation_wm2"] - o_full["q_solar_radiation_wm2"]) <= 0.01, code
        assert abs(o_fast["manual_calc"]["u_f"] - o_full["manual_calc"]["u_f"]) <= 0.001, code

    # 4. Breakdown per lantai
    fb_fast = {f["floor_number"]: f for f in fast["floor_breakdown"]}
    fb_full = {f["floor_number"]: f for f in full["floor_breakdown"]}
    for fnum, f_full in fb_full.items():
        assert abs(fb_fast[fnum]["ottv_floor_wm2"] - f_full["ottv_floor_wm2"]) <= 0.01

    # 5. Kode peringatan & per-panel aktif
    w_fast = {w["code"] for w in sf["warnings"]}
    w_full = {w["code"] for w in sl["warnings"]}
    assert w_fast == w_full

    act_fast = [p for p in fast["panels"] if p.get("active")]
    act_full = [p for p in full["panels"] if p.get("active")]
    assert len(act_fast) == len(act_full)
    for pf, pl in zip(act_fast, act_full):
        assert abs(pf["u_fen_eff"] - pl["u_fen_eff"]) <= 1e-4
        assert abs(pf["a_frame_m2"] - pl["a_frame_m2"]) <= 0.01
        assert abs(pf["a_edge_m2"] - pl["a_edge_m2"]) <= 0.01
        assert abs(pf["ottv_panel_wm2"] - pl["ottv_panel_wm2"]) <= 0.02


def test_c10_browser_api_rematerial_frame_width_parity():
    """Jalur browser_api.rematerial (payload ramping) dengan frame_width_mm baru identik dengan analyze penuh."""
    path = os.path.join(ROOT_DIR, "fixtures", "Honeybee_MultiZone_Office_3F.hbjson")
    fn = os.path.basename(path)
    mid = "c10_hb_parity"
    browser_api.register_upload(mid, path, fn, path)

    cfg50 = browser_api.default_config(fn)
    cfg50["settings"]["materials_confirmed"] = True
    cfg50["settings"]["frame_width_mm"] = 50.0
    slim_base = browser_api.analyze(mid, cfg50)

    slim_rem = browser_api.rematerial(
        slim_base["analysis_id"],
        {"frame_width_mm": 120.0, "materials_confirmed": True},
    )

    cfg120 = browser_api.default_config(fn)
    cfg120["settings"]["materials_confirmed"] = True
    cfg120["settings"]["frame_width_mm"] = 120.0
    slim_full = browser_api.analyze(mid, cfg120)

    assert abs(slim_rem["ottv_total_wm2"] - slim_full["ottv_total_wm2"]) <= 0.01
    assert abs(slim_rem["summary"]["avg_u_fen_wm2k"] - slim_full["summary"]["avg_u_fen_wm2k"]) <= 0.001
    assert slim_rem["summary"]["frame_width_mm"] == 120.0
    assert abs(slim_rem["summary"]["total_a_frame_m2"] - slim_full["summary"]["total_a_frame_m2"]) <= 0.05
    assert abs(slim_rem["summary"]["total_a_edge_m2"] - slim_full["summary"]["total_a_edge_m2"]) <= 0.05
