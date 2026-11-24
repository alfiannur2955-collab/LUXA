"""
Suite Uji T5 (A3-11 & A3-13) — Fenestrasi = Kaca + Kusen & U_f Tiga Zona
========================================================================
Mengacu SNI 6389:2020 butir 3.15, 3.17, 4.3.2.2, Tabel 3, dan Lampiran C:
1. Contoh Lampiran C (bukaan 1x1 m, kusen 50 mm, U_cog 3,0, U_frame 8,0 -> U_f = 4,75).
2. Persegi panjang ekuivalen untuk panel tidak persegi (fasad twisted).
3. Kotak dengan dan tanpa mullion -> A_o sama dan OTTV dekat; muka luar rangka masuk A_f & A_o.
4. Tabel 3 U_frame (aluminium 8,0; kayu 3,0; vinyl 2,0); thermal break tidak menurunkan U_frame di mode SNI.
5. Mode simulasi memakai U_f 3-zona yang sama (tanpa frame_cond_adder lama) + paritas rematerial_analysis.
6. Laporan Excel & PDF memuat U_f, A_frame, A_edge, lebar kusen, sumber, dan catatan 'Lebar kusen asumsi'.
"""

from __future__ import annotations

import io
import json
import math
import os
import sys
import tempfile
from typing import List, Tuple

import openpyxl
import pytest
import rhino3dm

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config_schema import CustomMaterialSpec, ProjectConfig, SettingsConfig  # noqa: E402
from materials_and_epw import get_material_by_id, resolve_u_frame  # noqa: E402
from ottv_engine import (  # noqa: E402
    EnvelopeParameters,
    analyze_building_ottv,
    compute_three_zone_uf,
    equivalent_rectangle,
)
from recommender import rematerial_analysis  # noqa: E402
from report_exporter import generate_excel_report, generate_pdf_report  # noqa: E402


def _add_quad(mesh: rhino3dm.Mesh, pts: List[Tuple[float, float, float]]) -> None:
    i0 = len(mesh.Vertices)
    for x, y, z in pts:
        mesh.Vertices.Add(float(x), float(y), float(z))
    mesh.Faces.AddFace(i0, i0 + 1, i0 + 2, i0 + 3)


def _add_box(mesh: rhino3dm.Mesh, x0: float, y0: float, z0: float, x1: float, y1: float, z1: float) -> None:
    """Menambahkan kotak 3D tertutup dengan normal menghadap keluar."""
    # -Y (Selatan), +Y (Utara), -X (Barat), +X (Timur), +Z (Atas), -Z (Bawah)
    _add_quad(mesh, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)])
    _add_quad(mesh, [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)])
    _add_quad(mesh, [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)])
    _add_quad(mesh, [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)])
    _add_quad(mesh, [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])
    _add_quad(mesh, [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)])


def _write_box_3dm(path: str, *, with_mullions: bool, frame_w: float = 0.05, window_size: Tuple[float, float] = (8.0, 2.0)) -> str:
    """Membuat kotak 10x10x4 m dengan bukaan `window_size` di keempat sisi (U, T, S, B).
    - with_mullions=False: bukaan penuh sebagai 1 panel kaca (tidak ada grup rangka).
    - with_mullions=True: bukaan yang sama dibagi menjadi rangka kusen keliling + 1 mullion tengah
      (lebar `frame_w`, kedalaman 0,12 m) di grup 'Rangka Mullion' + 2 panel kaca bersih di dalam kusen.
    """
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

    def _add_layer_mat(name: str, transp: float = 0.0) -> rhino3dm.ObjectAttributes:
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

    aw = _add_layer_mat("Dinding Bata", 0.0)
    ag = _add_layer_mat("Kaca Jendela", 0.7)
    ar = _add_layer_mat("Atap Beton", 0.0)
    af = _add_layer_mat("Rangka Mullion", 0.0) if with_mullions else None

    m_wall = rhino3dm.Mesh()
    m_glz = rhino3dm.Mesh()
    m_roof = rhino3dm.Mesh()
    m_frm = rhino3dm.Mesh() if with_mullions else None

    W, H = 10.0, 4.0
    win_w, win_h = window_size
    u0 = 0.5 * (W - win_w)
    u1 = u0 + win_w
    z0 = 0.5 * (H - win_h)
    z1 = z0 + win_h
    depth = 0.12

    # 4 sisi: (origin_x, origin_y, tx, ty, nx, ny) dengan normal luar (nx, ny)
    sides = [
        (0.0, 0.0, 1.0, 0.0, 0.0, -1.0),   # S (-Y)
        (W, 0.0, 0.0, 1.0, 1.0, 0.0),      # T (+X)
        (W, W, -1.0, 0.0, 0.0, 1.0),       # U (+Y)
        (0.0, W, 0.0, -1.0, -1.0, 0.0),    # B (-X)
    ]

    def _pt(ox, oy, tx, ty, nx, ny, u, z, off=0.0):
        return (ox + tx * u + nx * off, oy + ty * u + ny * off, z)

    def _side_quad(mesh, ox, oy, tx, ty, nx, ny, ua, ub, za, zb, off=0.0):
        _add_quad(mesh, [
            _pt(ox, oy, tx, ty, nx, ny, ua, za, off),
            _pt(ox, oy, tx, ty, nx, ny, ub, za, off),
            _pt(ox, oy, tx, ty, nx, ny, ub, zb, off),
            _pt(ox, oy, tx, ty, nx, ny, ua, zb, off),
        ])

    def _side_box(mesh, ox, oy, tx, ty, nx, ny, ua, ub, za, zb, d_in=0.0, d_out=0.06):
        # Kotak batang rangka sepanjang (ua..ub) x (za..zb), dari offset -d_in hingga +d_out
        p00 = _pt(ox, oy, tx, ty, nx, ny, ua, za, d_out)
        p10 = _pt(ox, oy, tx, ty, nx, ny, ub, za, d_out)
        p11 = _pt(ox, oy, tx, ty, nx, ny, ub, zb, d_out)
        p01 = _pt(ox, oy, tx, ty, nx, ny, ua, zb, d_out)
        q00 = _pt(ox, oy, tx, ty, nx, ny, ua, za, -d_in)
        q10 = _pt(ox, oy, tx, ty, nx, ny, ub, za, -d_in)
        q11 = _pt(ox, oy, tx, ty, nx, ny, ub, zb, -d_in)
        q01 = _pt(ox, oy, tx, ty, nx, ny, ua, zb, -d_in)
        _add_quad(mesh, [p00, p10, p11, p01])  # muka depan (+n)
        _add_quad(mesh, [q10, q00, q01, q11])  # muka belakang (-n)
        _add_quad(mesh, [q00, p00, p01, q01])  # sisi kiri
        _add_quad(mesh, [p10, q10, q11, p11])  # sisi kanan
        _add_quad(mesh, [p01, p11, q11, q01])  # atas
        _add_quad(mesh, [q00, q10, p10, p00])  # bawah

    for ox, oy, tx, ty, nx, ny in sides:
        # Dinding sekeliling bukaan (bawah, atas, kiri, kanan)
        _side_quad(m_wall, ox, oy, tx, ty, nx, ny, 0.0, W, 0.0, z0)
        _side_quad(m_wall, ox, oy, tx, ty, nx, ny, 0.0, W, z1, H)
        _side_quad(m_wall, ox, oy, tx, ty, nx, ny, 0.0, u0, z0, z1)
        _side_quad(m_wall, ox, oy, tx, ty, nx, ny, u1, W, z0, z1)

        if not with_mullions:
            _side_quad(m_glz, ox, oy, tx, ty, nx, ny, u0, u1, z0, z1)
        else:
            # Kusen keliling lebar frame_w (tanpa tumpang tindih sudut) + 1 mullion vertikal tengah
            fw = frame_w
            um0 = 0.5 * (u0 + u1) - 0.5 * fw
            um1 = 0.5 * (u0 + u1) + 0.5 * fw
            _side_box(m_frm, ox, oy, tx, ty, nx, ny, u0, u1, z0, z0 + fw, d_in=depth * 0.5, d_out=depth * 0.5)
            _side_box(m_frm, ox, oy, tx, ty, nx, ny, u0, u1, z1 - fw, z1, d_in=depth * 0.5, d_out=depth * 0.5)
            _side_box(m_frm, ox, oy, tx, ty, nx, ny, u0, u0 + fw, z0 + fw, z1 - fw, d_in=depth * 0.5, d_out=depth * 0.5)
            _side_box(m_frm, ox, oy, tx, ty, nx, ny, u1 - fw, u1, z0 + fw, z1 - fw, d_in=depth * 0.5, d_out=depth * 0.5)
            _side_box(m_frm, ox, oy, tx, ty, nx, ny, um0, um1, z0 + fw, z1 - fw, d_in=depth * 0.5, d_out=depth * 0.5)
            # 2 panel kaca bersih di antara kusen & mullion
            _side_quad(m_glz, ox, oy, tx, ty, nx, ny, u0 + fw, um0, z0 + fw, z1 - fw)
            _side_quad(m_glz, ox, oy, tx, ty, nx, ny, um1, u1 - fw, z0 + fw, z1 - fw)

    # Atap
    _add_quad(m_roof, [(0.0, 0.0, H), (W, 0.0, H), (W, W, H), (0.0, W, H)])

    for m, attr in ((m_wall, aw), (m_glz, ag), (m_roof, ar)):
        m.Normals.ComputeNormals()
        model.Objects.AddMesh(m, attr)
    if with_mullions and m_frm is not None and af is not None:
        m_frm.Normals.ComputeNormals()
        model.Objects.AddMesh(m_frm, af)

    model.Write(path, 7)
    return path


def test_lampiran_c_exact_uf_4_75():
    """Contoh Lampiran C SNI 6389:2020: bukaan 1x1 m, kusen 50 mm, U_cog 3,0, U_frame 8,0 -> U_f = 4,75."""
    res = compute_three_zone_uf(
        area_m2=1.0,
        perimeter_m=4.0,
        u_cog=3.0,
        u_frame=8.0,
        frame_width_m=0.05,
    )
    assert abs(res["a_frame"] - 0.19) <= 1e-9
    assert abs(res["a_edge"] - 0.32) <= 1e-9
    assert abs(res["a_cog"] - 0.49) <= 1e-9
    assert abs(res["u_edge"] - 5.50) <= 1e-9
    assert abs(res["u_f"] - 4.75) <= 1e-9


def test_lampiran_c_end_to_end_3d_model(tmp_path):
    """Uji end-to-end 3D: jendela 1x1 m tanpa grup rangka (kusen asumsi 50 mm, U_cog 3,0, U_frame 8,0) -> U_f = 4,75."""
    path = _write_box_3dm(str(tmp_path / "lampiran_c.3dm"), with_mullions=False, window_size=(1.0, 1.0))
    cfg = ProjectConfig(
        settings=SettingsConfig(
            materials_confirmed=True,
            mode="sni",
            city_preset="jakarta",
            frame_material_id="frm_aluminium_standar",
            frame_width_mm=50.0,
            glazing_material_id="test_glz_u3",
            custom_materials=[
                CustomMaterialSpec(
                    id="test_glz_u3",
                    name="Kaca Uji Lampiran C U=3,0",
                    category="glazing",
                    u_value=3.0,
                    sc=0.50,
                    massa_kg_m2=25.0,
                    sumber="Uji Lampiran C",
                    status="datasheet",
                ),
            ],
        )
    )
    res = analyze_building_ottv(path, "lampiran_c.3dm", cfg.to_envelope_parameters())
    assert abs(res["summary"]["avg_u_fen_wm2k"] - 4.75) <= 0.005
    assert abs(res["summary"]["total_a_frame_m2"] - 0.76) <= 0.01  # 4 sisi * 0,19 m2
    assert abs(res["summary"]["total_a_edge_m2"] - 1.28) <= 0.01   # 4 sisi * 0,32 m2
    assert res["summary"]["frame_source"] == "asumsi pengguna"
    assert res["summary"]["frame_width_mm"] == 50.0
    warn_codes = {w["code"] for w in res["summary"]["warnings"]}
    assert "ASSUMED_FRAME_WIDTH" in warn_codes
    assert res["summary"]["is_provisional"] is False  # catatan informatif, bukan provisional

    glz_panels = [p for p in res["panels"] if p["active"] and p["element_type"] == "glazing"]
    assert len(glz_panels) == 4
    for p in glz_panels:
        assert abs(p["u_fen_eff"] - 4.75) <= 0.005
        assert abs(p["a_frame_m2"] - 0.19) <= 0.005
        assert abs(p["a_edge_m2"] - 0.32) <= 0.005


def test_equivalent_rectangle_non_rectangular_panel():
    """Panel miring / twisted memakai persegi panjang ekuivalen dari luas & keliling."""
    # Jajaran genjang alas 2 m, tinggi 1,5 m (luas 3,0 m2), sisi miring 1,8 m -> keliling 7,6 m
    w_eq, h_eq = equivalent_rectangle(3.0, 7.6)
    assert abs(w_eq * h_eq - 3.0) <= 1e-6
    assert abs(2.0 * (w_eq + h_eq) - 7.6) <= 1e-6
    tz = compute_three_zone_uf(3.0, 7.6, u_cog=1.6, u_frame=8.0, frame_width_m=0.05)
    assert abs((tz["a_cog"] + tz["a_edge"] + tz["a_frame"]) - 3.0) <= 1e-9
    assert 1.6 < tz["u_f"] < 8.0


def test_kotak_dengan_dan_tanpa_mullion_ao_sama_dan_ottv_dekat(tmp_path):
    """Kotak 10x10x4 m dengan vs tanpa mullion -> A_o sama, A_f sama, dan OTTV dekat."""
    p_no = _write_box_3dm(str(tmp_path / "box_no_mullion.3dm"), with_mullions=False, frame_w=0.05)
    p_yes = _write_box_3dm(str(tmp_path / "box_with_mullion.3dm"), with_mullions=True, frame_w=0.05)

    cfg = ProjectConfig(
        settings=SettingsConfig(
            materials_confirmed=True,
            mode="sni",
            city_preset="jakarta",
            frame_material_id="frm_aluminium_standar",
            frame_width_mm=50.0,
        )
    )
    r_no = analyze_building_ottv(p_no, "box_no_mullion.3dm", cfg.to_envelope_parameters())
    r_yes = analyze_building_ottv(p_yes, "box_with_mullion.3dm", cfg.to_envelope_parameters())

    assert r_no["summary"]["frame_source"] == "asumsi pengguna"
    assert r_yes["summary"]["frame_source"] == "terukur"
    assert abs(r_yes["summary"]["frame_width_mm"] - 50.0) <= 2.0
    assert "ASSUMED_FRAME_WIDTH" in {w["code"] for w in r_no["summary"]["warnings"]}
    assert "ASSUMED_FRAME_WIDTH" not in {w["code"] for w in r_yes["summary"]["warnings"]}

    # A_o dan A_f harus sama (muka luar rangka masuk A_f dan A_o!)
    assert abs(r_yes["summary"]["total_envelope_area_m2"] - r_no["summary"]["total_envelope_area_m2"]) <= 0.15
    assert abs(r_yes["summary"]["total_envelope_area_m2"] - 160.0) <= 0.15
    assert abs(r_yes["summary"]["total_glazing_area_m2"] - r_no["summary"]["total_glazing_area_m2"]) <= 0.15
    assert abs(r_yes["summary"]["total_glazing_area_m2"] - 64.0) <= 0.15

    # OTTV dekat (selisih kecil karena ada 1 mullion tengah tambahan di model dengan mullion)
    assert abs(r_yes["ottv_total_wm2"] - r_no["ottv_total_wm2"]) <= 1.2
    assert r_yes["ottv_total_wm2"] >= r_no["ottv_total_wm2"] - 0.1


def test_tabel3_u_frame_dan_thermal_break_tidak_menurunkan_di_mode_sni(tmp_path):
    """SNI Tabel 3: aluminium/metal 8,0; kayu 3,0; vinyl/plastik 2,0.
    Di mode SNI, thermal break TIDAK boleh menurunkan U_frame."""
    alu_std = get_material_by_id("frm_aluminium_standar")
    alu_tb = get_material_by_id("frm_aluminium_thermal_break")
    wood = get_material_by_id("frm_kayu")
    vinyl = get_material_by_id("frm_vinyl_plastik")
    assert alu_std is not None and alu_std["u_value"] == 8.0
    assert wood is not None and wood["u_value"] == 3.0
    assert vinyl is not None and vinyl["u_value"] == 2.0

    # Resolusi SNI vs Simulasi
    assert resolve_u_frame(alu_std, is_sni_mode=True) == 8.0
    assert resolve_u_frame(alu_tb, is_sni_mode=True) == 8.0
    assert resolve_u_frame(wood, is_sni_mode=True) == 3.0
    assert resolve_u_frame(vinyl, is_sni_mode=True) == 2.0
    assert resolve_u_frame(alu_tb, is_sni_mode=False) == 2.10

    path = _write_box_3dm(str(tmp_path / "box_frames.3dm"), with_mullions=False)
    results = {}
    for fid in ("frm_aluminium_standar", "frm_aluminium_thermal_break", "frm_kayu", "frm_vinyl_plastik"):
        cfg = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_material_id=fid, frame_width_mm=50.0))
        results[fid] = analyze_building_ottv(path, "box_frames.3dm", cfg.to_envelope_parameters())

    # Thermal break harus IDENTIK dengan aluminium standar di mode SNI
    assert results["frm_aluminium_thermal_break"]["summary"]["u_frame_eff_wm2k"] == 8.0
    assert results["frm_aluminium_thermal_break"]["ottv_total_wm2"] == results["frm_aluminium_standar"]["ottv_total_wm2"]
    assert results["frm_vinyl_plastik"]["ottv_total_wm2"] < results["frm_kayu"]["ottv_total_wm2"] < results["frm_aluminium_standar"]["ottv_total_wm2"]


def test_simulasi_pakai_uf_3zona_tanpa_frame_cond_adder_dan_paritas_rematerial(tmp_path):
    """A3-11: mode simulasi memakai U_f 3-zona yang sama (frame_cond_adder lama dihapus),
    dan rematerial_analysis cocok 0,00 W/m2 saat ganti material atau frame_width_mm."""
    path = _write_box_3dm(str(tmp_path / "box_sim.3dm"), with_mullions=False)
    cfg_sim = ProjectConfig(
        settings=SettingsConfig(
            materials_confirmed=True,
            mode="simulasi",
            frame_material_id="frm_aluminium_thermal_break",
            frame_width_mm=50.0,
        )
    )
    res_sim = analyze_building_ottv(path, "box_sim.3dm", cfg_sim.to_envelope_parameters())
    assert res_sim["summary"]["u_frame_eff_wm2k"] == 2.1
    # Verifikasi tidak ada frame_cond_adder tersembunyi pada q_glass_cond_wm2
    dt = float(res_sim["summary"]["active_materials"]["delta_t"])
    for p in res_sim["panels"]:
        if p["active"] and p["element_type"] == "glazing":
            expected_qg = round(p["u_fen_eff"] * p["wwr_panel"] * dt, 2)
            assert abs(p["q_glass_cond_wm2"] - expected_qg) <= 0.02

    # Paritas rematerial saat mengubah frame_width_mm (50 -> 100 mm) dan frame_material_id (kayu)
    cfg_sni = ProjectConfig(settings=SettingsConfig(materials_confirmed=False, mode="sni", frame_width_mm=50.0))
    base = analyze_building_ottv(path, "box_sim.3dm", cfg_sni.to_envelope_parameters())
    assert base["summary"]["is_provisional"] is True

    fast = rematerial_analysis(base, frame_material_id="frm_kayu", frame_width_mm=100.0, materials_confirmed=True)
    cfg_full = ProjectConfig(
        settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_material_id="frm_kayu", frame_width_mm=100.0)
    )
    full = analyze_building_ottv(path, "box_sim.3dm", cfg_full.to_envelope_parameters())

    assert fast["summary"]["is_provisional"] is False
    assert fast["summary"]["frame_width_mm"] == 100.0
    assert abs(fast["ottv_total_wm2"] - full["ottv_total_wm2"]) <= 0.01
    assert abs(fast["summary"]["avg_u_fen_wm2k"] - full["summary"]["avg_u_fen_wm2k"]) <= 0.002


def test_laporan_excel_dan_pdf_memuat_fenestrasi_3zona(tmp_path):
    """Laporan Excel dan PDF menampilkan U_f, A_frame, A_edge, lebar kusen, sumber, dan 'Lebar kusen asumsi'."""
    path = _write_box_3dm(str(tmp_path / "box_rpt.3dm"), with_mullions=False)
    cfg = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=60.0))
    res = analyze_building_ottv(path, "box_rpt.3dm", cfg.to_envelope_parameters())

    xlsx = generate_excel_report(res)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx))
    ring_text = " ".join(str(c.value) for row in wb["Ringkasan"].iter_rows() for c in row if c.value is not None)
    assert "U_f rata-rata tiga zona" in ring_text
    assert "Luas rangka A_frame" in ring_text
    assert "Luas tepi kaca A_edge" in ring_text
    assert "Lebar kusen" in ring_text
    assert "asumsi pengguna" in ring_text
    assert "Lebar kusen asumsi" in ring_text

    # Cek Excel vs aplikasi pada setiap lembar arah harus cocok 0,01 W/m2
    dt = float(wb["Referensi"]["B5"].value)
    for code, title in (("U", "U Utara"), ("T", "T Timur"), ("S", "S Selatan"), ("B", "B Barat")):
        ws = wb[title]
        heat = 0.0
        area = 0.0
        r = 11
        while ws[f"F{r}"].value is not None and not isinstance(ws[f"F{r}"].value, str):
            fv = lambda c: float(ws[f"{c}{r}"].value or 0.0)  # noqa: E731
            heat += fv("F") * fv("H") * fv("I") * fv("J") + fv("G") * fv("K") * dt + fv("G") * fv("M") * fv("O")
            area += fv("F") + fv("G")
            r += 1
        app_v = float(ws["K5"].value or 0.0)
        assert abs((heat / area) - app_v) <= 0.02

    pdf_bytes = generate_pdf_report(res)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 1500
