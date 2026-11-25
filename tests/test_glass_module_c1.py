"""
Uji C1 — Modul Kaca Virtual untuk U_f Tiga Zona (Tanpa Rangka Terukur)
======================================================================
Bila model tidak memiliki grup rangka terukur, bukaan kaca sebidang yang lebar/tinggi
dipecah menjadi modul virtual (`settings.glass_module_width_mm`, bawaan 1500 mm,
tinggi = tinggi lantai) agar U_f tiga zona realistis.
"""

from __future__ import annotations

import os
import sys

import rhino3dm

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import ProjectConfig, SettingsConfig  # noqa: E402
from ottv_engine import analyze_building_ottv  # noqa: E402
from recommender import rematerial_analysis  # noqa: E402


def _add_quad(mesh: rhino3dm.Mesh, pts):
    i0 = len(mesh.Vertices)
    for x, y, z in pts:
        mesh.Vertices.Add(float(x), float(y), float(z))
    mesh.Faces.AddFace(i0, i0 + 1, i0 + 2, i0 + 3)


def _write_curtain_strip_3dm(path: str, *, n_panels: int, width_m: float = 30.0, height_m: float = 3.5) -> str:
    """Bangunan 30x10x3,5 m tanpa mullion: sisi Selatan (-Y) dan Utara (+Y) penuh kaca,
    sisi Timur (+X) dan Barat (-X) dinding masif.
    - n_panels=1: satu bidang kaca utuh 30x3,5 m per sisi.
    - n_panels=20: 20 panel terpisah 1,5x3,5 m (tiap panel beda grup agar benar-benar dihitung terpisah)."""
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

    def _attr(name: str, transp: float = 0.0) -> rhino3dm.ObjectAttributes:
        lyr = rhino3dm.Layer()
        lyr.Name = name
        li = model.Layers.Add(lyr)
        mat = rhino3dm.Material()
        mat.Name = name
        mat.Transparency = transp
        mi = model.Materials.Add(mat)
        a = rhino3dm.ObjectAttributes()
        a.LayerIndex = li
        a.MaterialIndex = mi
        a.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        return a

    D = 10.0
    aw = _attr("Dinding Bata", 0.0)
    ar = _attr("Atap Beton", 0.0)

    mw = rhino3dm.Mesh()
    # Barat (-X) dan Timur (+X)
    _add_quad(mw, [(0.0, D, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, height_m), (0.0, D, height_m)])
    _add_quad(mw, [(width_m, 0.0, 0.0), (width_m, D, 0.0), (width_m, D, height_m), (width_m, 0.0, height_m)])
    mw.Normals.ComputeNormals()
    model.Objects.AddMesh(mw, aw)

    mr = rhino3dm.Mesh()
    _add_quad(mr, [(0.0, 0.0, height_m), (width_m, 0.0, height_m), (width_m, D, height_m), (0.0, D, height_m)])
    mr.Normals.ComputeNormals()
    model.Objects.AddMesh(mr, ar)

    dx = width_m / n_panels
    for k in range(n_panels):
        ag = _attr(f"Kaca Jendela {k + 1:02d}" if n_panels > 1 else "Kaca Jendela", 0.7)
        mg = rhino3dm.Mesh()
        x0 = k * dx
        x1 = (k + 1) * dx
        # Selatan (-Y)
        _add_quad(mg, [(x0, 0.0, 0.0), (x1, 0.0, 0.0), (x1, 0.0, height_m), (x0, 0.0, height_m)])
        # Utara (+Y)
        _add_quad(mg, [(x1, D, 0.0), (x0, D, 0.0), (x0, D, height_m), (x1, D, height_m)])
        mg.Normals.ComputeNormals()
        model.Objects.AddMesh(mg, ag)

    model.Write(path, 7)
    return path


def test_satu_bidang_kaca_30x3_5_setara_20_panel_1_5x3_5(tmp_path):
    """Satu bidang kaca 30x3,5 m tanpa mullion dengan modul bawaan 1500 mm harus setara 20 panel 1,5x3,5 m."""
    p_one = _write_curtain_strip_3dm(str(tmp_path / "kaca_utuh_30m.3dm"), n_panels=1)
    p_20 = _write_curtain_strip_3dm(str(tmp_path / "kaca_20_panel.3dm"), n_panels=20)

    cfg = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=50.0))
    assert cfg.settings.glass_module_width_mm == 1500.0

    r_one = analyze_building_ottv(p_one, "kaca_utuh_30m.3dm", cfg.to_envelope_parameters())
    r_20 = analyze_building_ottv(p_20, "kaca_20_panel.3dm", cfg.to_envelope_parameters())

    assert r_one["summary"]["frame_source"] == "asumsi pengguna"
    assert r_one["summary"]["glass_module_width_mm"] == 1500.0
    assert abs(r_one["summary"]["avg_u_fen_wm2k"] - r_20["summary"]["avg_u_fen_wm2k"]) <= 0.02, (
        f"U_f 30m ({r_one['summary']['avg_u_fen_wm2k']}) != 20x1,5m ({r_20['summary']['avg_u_fen_wm2k']})"
    )
    assert abs(r_one["summary"]["total_a_frame_m2"] - r_20["summary"]["total_a_frame_m2"]) <= 0.2
    assert abs(r_one["ottv_total_wm2"] - r_20["ottv_total_wm2"]) <= 0.05


def test_rematerial_glass_module_width_matches_full_analyze(tmp_path):
    """Mengubah glass_module_width_mm lewat rematerial_analysis cocok dengan hitung penuh."""
    p_one = _write_curtain_strip_3dm(str(tmp_path / "kaca_utuh_30m.3dm"), n_panels=1)
    cfg_1500 = ProjectConfig(
        settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=50.0, glass_module_width_mm=1500.0)
    )
    base = analyze_building_ottv(p_one, "kaca_utuh_30m.3dm", cfg_1500.to_envelope_parameters())

    fast = rematerial_analysis(base, glass_module_width_mm=3000.0, materials_confirmed=True)
    cfg_3000 = ProjectConfig(
        settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=50.0, glass_module_width_mm=3000.0)
    )
    full = analyze_building_ottv(p_one, "kaca_utuh_30m.3dm", cfg_3000.to_envelope_parameters())

    assert fast["summary"]["glass_module_width_mm"] == 3000.0
    assert fast["summary"]["avg_u_fen_wm2k"] < base["summary"]["avg_u_fen_wm2k"]
    assert abs(fast["summary"]["avg_u_fen_wm2k"] - full["summary"]["avg_u_fen_wm2k"]) <= 0.002
    assert abs(fast["ottv_total_wm2"] - full["ottv_total_wm2"]) <= 0.01


def test_ui_wires_modul_kaca_next_to_lebar_kusen():
    """Isian 'Modul kaca' (glass_module_width_mm, bawaan 1500) tampil di samping 'Lebar kusen'."""
    state_js = open(os.path.join(ROOT_DIR, "frontend", "src", "state.js"), encoding="utf-8").read()
    main_js = open(os.path.join(ROOT_DIR, "frontend", "src", "main.js"), encoding="utf-8").read()
    rail_js = open(os.path.join(ROOT_DIR, "frontend", "src", "panels", "railPanels.js"), encoding="utf-8").read()

    assert "glass_module_width_mm: 1500" in state_js
    assert "glass_module_width_mm" in main_js
    assert "onChangeGlassModuleWidthMm" in main_js
    assert "Modul kaca" in rail_js
    assert "onChangeGlassModuleWidthMm" in rail_js
