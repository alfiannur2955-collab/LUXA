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


def _write_box_3dm(
    path: str,
    *,
    with_mullions: bool,
    frame_w: float = 0.05,
    window_size: Tuple[float, float] = (8.0, 2.0),
    continuous_glass: bool = True,
    glz_subdiv: Tuple[int, int] = (1, 1),
    add_wall_trim: bool = False,
) -> str:
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

        def _add_glz_grid(ua, ub, za, zb):
            nu, nz = glz_subdiv
            du = (ub - ua) / nu
            dz = (zb - za) / nz
            for iu in range(nu):
                for iz in range(nz):
                    _side_quad(
                        m_glz, ox, oy, tx, ty, nx, ny,
                        ua + iu * du, ua + (iu + 1) * du,
                        za + iz * dz, za + (iz + 1) * dz,
                    )

        if not with_mullions:
            _add_glz_grid(u0, u1, z0, z1)
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
            if add_wall_trim:
                # Batang profil aluminium di depan dinding/spandrel bawah (Z = 0,20..0,40 m) -> masuk dinding, bukan fenestrasi
                _side_box(m_frm, ox, oy, tx, ty, nx, ny, 0.5, W - 0.5, 0.20, 0.30, d_in=0.0, d_out=0.06)
            if continuous_glass:
                # Panel kaca menerus di belakang mullion (muka rangka menggantikan luas kaca di belakangnya)
                _add_glz_grid(u0, u1, z0, z1)
            else:
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
            glass_module_width_mm=4000.0,  # samakan modul asumsi (4 m) dengan 1 mullion tengah di box_with_mullion
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

    # OTTV dekat (modul virtual 4 m pada bukaan 8 m memberi 2 modul yang sangat dekat dengan 1 mullion tengah terukur)
    assert abs(r_yes["ottv_total_wm2"] - r_no["ottv_total_wm2"]) <= 0.5


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
    assert "U kaca → U_f" in ring_text
    assert "4.3.2.2" in ring_text
    assert "Tabel 3" in ring_text
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


def test_kaca_menerus_di_belakang_mullion_ao_sama_dan_r_tepat(tmp_path):
    """Panel kaca menerus penuh di belakang mullion 3D (dengan sisi samping & kedalaman dalam):
    A_o harus sama persis dengan tanpa mullion, sisi samping dibuang, dan r = luas muka depan mullion / luas fasad."""
    W, H = 10.0, 4.0
    mull_w = 0.10
    mull_d = 0.18  # kedalaman besar supaya jelas sisi sampingnya dibuang

    def _build_full_glz_box(path: str, with_mull: bool) -> str:
        model = rhino3dm.File3dm()
        model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

        def _add_layer(m_obj, name: str) -> int:
            lyr = rhino3dm.Layer()
            lyr.Name = name
            return m_obj.Layers.Add(lyr)

        l_glz = _add_layer(model, "01_Vision_Glass")
        l_rf = _add_layer(model, "02_Roof")
        m_glz, m_rf = rhino3dm.Mesh(), rhino3dm.Mesh()
        ag, ar = rhino3dm.ObjectAttributes(), rhino3dm.ObjectAttributes()
        ag.LayerIndex, ar.LayerIndex = l_glz, l_rf
        m_frm, af = (rhino3dm.Mesh(), rhino3dm.ObjectAttributes()) if with_mull else (None, None)
        if with_mull:
            af.LayerIndex = _add_layer(model, "03_Frame_Mullion")

        sides = [
            (0.0, 0.0, 1.0, 0.0, 0.0, -1.0),
            (W, 0.0, 0.0, 1.0, 1.0, 0.0),
            (W, W, -1.0, 0.0, 0.0, 1.0),
            (0.0, W, 0.0, -1.0, -1.0, 0.0),
        ]

        def _pt(ox, oy, tx, ty, nx, ny, u, z, off=0.0):
            return (ox + tx * u + nx * off, oy + ty * u + ny * off, z)

        for ox, oy, tx, ty, nx, ny in sides:
            # 1 lembar kaca penuh 10 x 4 m per sisi (total A_o = 160 m2)
            _add_quad(m_glz, [
                _pt(ox, oy, tx, ty, nx, ny, 0.0, 0.0),
                _pt(ox, oy, tx, ty, nx, ny, W, 0.0),
                _pt(ox, oy, tx, ty, nx, ny, W, H),
                _pt(ox, oy, tx, ty, nx, ny, 0.0, H),
            ])
            if with_mull:
                # 4 mullion vertikal 0,10 x 4,0 m per sisi (muka depan = 1,6 m2/sisi, 6,4 m2 total;
                # sisi samping/kedalaman = 4 * 2 * 0,18 * 4,0 = 5,76 m2/sisi yang HARUS dibuang!)
                for u_mid in (1.5, 4.0, 6.0, 8.5):
                    ua, ub = u_mid - 0.5 * mull_w, u_mid + 0.5 * mull_w
                    p00 = _pt(ox, oy, tx, ty, nx, ny, ua, 0.0, mull_d)
                    p10 = _pt(ox, oy, tx, ty, nx, ny, ub, 0.0, mull_d)
                    p11 = _pt(ox, oy, tx, ty, nx, ny, ub, H, mull_d)
                    p01 = _pt(ox, oy, tx, ty, nx, ny, ua, H, mull_d)
                    q00 = _pt(ox, oy, tx, ty, nx, ny, ua, 0.0, 0.01)
                    q10 = _pt(ox, oy, tx, ty, nx, ny, ub, 0.0, 0.01)
                    q11 = _pt(ox, oy, tx, ty, nx, ny, ub, H, 0.01)
                    q01 = _pt(ox, oy, tx, ty, nx, ny, ua, H, 0.01)
                    _add_quad(m_frm, [p00, p10, p11, p01])
                    _add_quad(m_frm, [q10, q00, q01, q11])
                    _add_quad(m_frm, [q00, p00, p01, q01])
                    _add_quad(m_frm, [p10, q10, q11, p11])
                    _add_quad(m_frm, [p01, p11, q11, q01])
                    _add_quad(m_frm, [q00, q10, p10, p00])

        _add_quad(m_rf, [(0.0, 0.0, H), (W, 0.0, H), (W, W, H), (0.0, W, H)])
        for m, attr in ((m_glz, ag), (m_rf, ar)):
            m.Normals.ComputeNormals()
            model.Objects.AddMesh(m, attr)
        if with_mull and m_frm is not None and af is not None:
            m_frm.Normals.ComputeNormals()
            model.Objects.AddMesh(m_frm, af)
        model.Write(path, 7)
        return path

    p_no = _build_full_glz_box(str(tmp_path / "cw_no_mull.3dm"), with_mull=False)
    p_yes = _build_full_glz_box(str(tmp_path / "cw_with_mull.3dm"), with_mull=True)
    cfg = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_material_id="frm_aluminium_standar"))
    r_no = analyze_building_ottv(p_no, "cw_no_mull.3dm", cfg.to_envelope_parameters())
    r_yes = analyze_building_ottv(p_yes, "cw_with_mull.3dm", cfg.to_envelope_parameters())

    # A_o harus identik 160,00 m2 (mullion menggantikan kaca di belakang, bukan menambah)
    assert abs(r_yes["summary"]["total_envelope_area_m2"] - r_no["summary"]["total_envelope_area_m2"]) <= 0.05
    assert abs(r_yes["summary"]["total_envelope_area_m2"] - 160.0) <= 0.05

    # Hanya muka depan mullion (4 sisi * 4 batang * 0,10 * 4,0 = 6,40 m2) yang dihitung
    expected_front = 4 * 4 * mull_w * H
    assert abs(r_yes["summary"]["total_a_frame_m2"] - expected_front) <= 0.05
    expected_r = expected_front / 160.0  # 0,04 (4,0%)
    assert abs(r_yes["summary"]["frame_ratio"] - expected_r) <= 0.002
    assert abs(r_yes["summary"]["frame_width_mm"] - 100.0) <= 2.0
    # Karena r = 4,0% < 5%, peringatan review harus muncul
    assert "FRAME_REVIEW_NEEDED" in {w["code"] for w in r_yes["summary"]["warnings"]}


def test_uf_per_lembar_kaca_utuh_vs_dipotong_10_sama(tmp_path):
    """U_f dihitung per lembar kaca utuh (komponen tersambung): kaca 1 face vs dipotong 10 face -> U_f sama."""
    p_utuh = _write_box_3dm(str(tmp_path / "kaca_utuh.3dm"), with_mullions=False, glz_subdiv=(1, 1))
    p_10 = _write_box_3dm(str(tmp_path / "kaca_potong10.3dm"), with_mullions=False, glz_subdiv=(5, 2))
    cfg = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=50.0))

    r_utuh = analyze_building_ottv(p_utuh, "kaca_utuh.3dm", cfg.to_envelope_parameters())
    r_10 = analyze_building_ottv(p_10, "kaca_potong10.3dm", cfg.to_envelope_parameters())

    glz_10 = [p for p in r_10["panels"] if p["active"] and p["element_type"] == "glazing"]
    assert len(glz_10) == 40  # 4 sisi x 10 potongan
    assert abs(r_utuh["summary"]["avg_u_fen_wm2k"] - r_10["summary"]["avg_u_fen_wm2k"]) <= 1e-4
    assert abs(r_utuh["summary"]["total_a_frame_m2"] - r_10["summary"]["total_a_frame_m2"]) <= 0.01
    assert abs(r_utuh["summary"]["total_a_edge_m2"] - r_10["summary"]["total_a_edge_m2"]) <= 0.01
    assert abs(r_utuh["ottv_total_wm2"] - r_10["ottv_total_wm2"]) <= 0.01


def test_kusen_berbatasan_spandrel_dinding_masuk_dinding_bukan_fenestrasi(tmp_path):
    """Muka kusen di depan/berbatasan dinding atau spandrel masuk dinding, tidak menambah A_frame fenestrasi."""
    p_base = _write_box_3dm(str(tmp_path / "box_mull_only.3dm"), with_mullions=True, continuous_glass=True, add_wall_trim=False)
    p_trim = _write_box_3dm(str(tmp_path / "box_mull_and_walltrim.3dm"), with_mullions=True, continuous_glass=True, add_wall_trim=True)
    cfg = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni"))

    r_base = analyze_building_ottv(p_base, "box_mull_only.3dm", cfg.to_envelope_parameters())
    r_trim = analyze_building_ottv(p_trim, "box_mull_and_walltrim.3dm", cfg.to_envelope_parameters())

    assert abs(r_trim["summary"]["total_envelope_area_m2"] - r_base["summary"]["total_envelope_area_m2"]) <= 0.05
    assert abs(r_trim["summary"]["total_a_frame_m2"] - r_base["summary"]["total_a_frame_m2"]) <= 0.05
    assert r_trim["summary"]["total_opaque_frame_area_m2"] >= 3.0  # 4 sisi * 9 m * 0,10 m = 3,6 m2 masuk dinding
    assert abs(r_trim["summary"]["avg_u_fen_wm2k"] - r_base["summary"]["avg_u_fen_wm2k"]) <= 0.01


def test_peringatan_review_fraksi_rangka_dan_lebar_kusen(tmp_path):
    """Peringatan review FRAME_REVIEW_NEEDED muncul bila r < 5%, r > 30%, atau lebar kusen > 200 mm."""
    p_box = _write_box_3dm(str(tmp_path / "box_rev.3dm"), with_mullions=False, window_size=(8.0, 2.0))
    # 1. r < 5% (lebar 10 mm di jendela 8x2 m -> r ~ 1,2%)
    r_low = analyze_building_ottv(p_box, "box_rev.3dm", ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=10.0)).to_envelope_parameters())
    w_low = {w["code"]: w for w in r_low["summary"]["warnings"]}
    assert "FRAME_REVIEW_NEEDED" in w_low
    assert "ratio_low" in w_low["FRAME_REVIEW_NEEDED"]["detail"]["reasons"]

    # 2. Normal (50 mm di jendela 8x2 m -> r ~ 6,2%, lebar 50 mm) -> TIDAK ada FRAME_REVIEW_NEEDED
    r_ok = analyze_building_ottv(p_box, "box_rev.3dm", ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=50.0)).to_envelope_parameters())
    assert "FRAME_REVIEW_NEEDED" not in {w["code"] for w in r_ok["summary"]["warnings"]}

    # 3. lebar kusen > 200 mm + r > 30% (220 mm di jendela 8x2 m)
    r_hi = analyze_building_ottv(p_box, "box_rev.3dm", ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=220.0)).to_envelope_parameters())
    w_hi = {w["code"]: w for w in r_hi["summary"]["warnings"]}
    assert "FRAME_REVIEW_NEEDED" in w_hi
    assert "width_high" in w_hi["FRAME_REVIEW_NEEDED"]["detail"]["reasons"]

    # 4. r > 30% dengan lebar <= 200 mm (180 mm di jendela 1x1 m -> r ~ 59%)
    p_small = _write_box_3dm(str(tmp_path / "box_small.3dm"), with_mullions=False, window_size=(1.0, 1.0))
    r_rhi = analyze_building_ottv(p_small, "box_small.3dm", ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni", frame_width_mm=180.0)).to_envelope_parameters())
    w_rhi = {w["code"]: w for w in r_rhi["summary"]["warnings"]}
    assert "FRAME_REVIEW_NEEDED" in w_rhi
    assert "ratio_high" in w_rhi["FRAME_REVIEW_NEEDED"]["detail"]["reasons"]
    assert "width_high" not in w_rhi["FRAME_REVIEW_NEEDED"]["detail"]["reasons"]


def test_ao_dengan_dan_tanpa_rangka_beda_maks_3_persen_archicad_ifc():
    """Syarat lulus: A_o dengan rangka hanya boleh berbeda <= 3% dari A_o tanpa rangka."""
    ifc_path = os.path.join(ROOT_DIR, "fixtures", "archicad_bim_curtainwall.ifc")
    p_with = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni")).to_envelope_parameters()
    p_no = ProjectConfig(settings=SettingsConfig(materials_confirmed=True, mode="sni")).to_envelope_parameters()
    p_no.disabled_groups = ["IFC_Member :: IfcMember"]
    r_w = analyze_building_ottv(ifc_path, "archicad_bim_curtainwall.ifc", p_with)
    r_no = analyze_building_ottv(ifc_path, "archicad_bim_curtainwall.ifc", p_no)
    ao_w = r_w["summary"]["total_envelope_area_m2"]
    ao_no = r_no["summary"]["total_envelope_area_m2"]
    assert abs(ao_w - ao_no) / max(1e-6, ao_no) <= 0.03
    assert "FRAME_REVIEW_NEEDED" in {w["code"] for w in r_w["summary"]["warnings"]}


def test_c3_lebar_kusen_terukur_di_atas_200mm_pakai_frame_width_mm_untuk_pita_tepi(tmp_path):
    """C3: lebar kusen terukur > 200 mm tidak dipakai untuk pita tepi A_edge;
    pita tepi memakai params.frame_width_mm + peringatan FRAME_REVIEW_NEEDED."""
    path = _write_box_3dm(
        str(tmp_path / "box_wide_frame.3dm"),
        with_mullions=True,
        frame_w=0.25,
        window_size=(8.0, 2.0),
        continuous_glass=True,
    )
    cfg50 = ProjectConfig(
        settings=SettingsConfig(
            materials_confirmed=True,
            mode="sni",
            frame_material_id="frm_aluminium_standar",
            frame_width_mm=50.0,
        )
    )
    cfg80 = ProjectConfig(
        settings=SettingsConfig(
            materials_confirmed=True,
            mode="sni",
            frame_material_id="frm_aluminium_standar",
            frame_width_mm=80.0,
        )
    )
    r50 = analyze_building_ottv(path, "box_wide_frame.3dm", cfg50.to_envelope_parameters())
    r80 = analyze_building_ottv(path, "box_wide_frame.3dm", cfg80.to_envelope_parameters())

    assert r50["summary"]["frame_source"] == "terukur"
    assert r50["summary"]["frame_width_mm"] > 200.0
    assert r50["summary"]["edge_frame_width_mm"] == 50.0
    assert r80["summary"]["edge_frame_width_mm"] == 80.0

    # Dengan pita tepi 50 mm (bukan 250 mm), A_cog masih besar (> 20 m2) dan A_edge berubah saat frame_width_mm diubah
    assert r50["summary"]["total_a_cog_m2"] > 20.0
    assert r80["summary"]["total_a_edge_m2"] > r50["summary"]["total_a_edge_m2"] + 1.0

    # Peringatan FRAME_REVIEW_NEEDED muncul dan menjelaskan pemakaian lebar asumsi untuk pita tepi
    rev = [w for w in r50["summary"]["warnings"] if w.get("code") == "FRAME_REVIEW_NEEDED"]
    assert len(rev) == 1
    assert "pita tepi" in rev[0]["message"].lower()

    # Paritas rematerial saat frame_width_mm diubah pada kasus lebar terukur > 200 mm
    fast80 = rematerial_analysis(r50, frame_width_mm=80.0, materials_confirmed=True)
    assert abs(fast80["summary"]["total_a_edge_m2"] - r80["summary"]["total_a_edge_m2"]) <= 0.05
    assert abs(fast80["ottv_total_wm2"] - r80["ottv_total_wm2"]) <= 0.01

