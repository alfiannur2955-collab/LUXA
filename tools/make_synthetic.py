"""
OTTV 3D Parametric Studio — Generator 21 Kasus Sintetis (Fase 1c)
===============================================================
Membuat seluruh 21 kasus uji sintetis sesuai `docs/FASE1C_SPEC.md` ke
`fixtures/synthetic/<folder>/model.<ext>` (+ `model.mtl` untuk OBJ) dan
menghitung `expected.json` SECARA ANALITIS dari geometri yang dibangun.

PRINSIP KETAT:
  - Script ini TIDAK BOLEH memanggil `analyze_building_ottv`,
    `load_universal_model_stages_1_and_2`, atau fungsi klasifikasi/raycast engine.
  - Hanya membaca konstanta numerik dari `materials_and_epw`, `sni_tables`,
    dan `template_method` (tabel angka katalog & SNI/template prodi).
"""

from __future__ import annotations

import json
import math
import os
import shutil
import struct
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import rhino3dm

if os.name == "nt" and os.path.isdir(r"E:\APPS\QGIS\bin"):
    try:
        os.add_dll_directory(r"E:\APPS\QGIS\bin")
    except Exception:
        pass

import ifcopenshell
import ifcopenshell.api

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Hanya membaca tabel konstanta numerik (BUKAN fungsi analisis/raycast engine)
from materials_and_epw import SC_TO_SHGC_RATIO, get_material_by_id
from sni_tables import (
    SCEFF_1D_ANGLES_DEG,
    SNI_DELTA_T_K,
    SNI_TABLE_HORIZONTAL_SCEFF,
    SNI_TABLE_VERTICAL_SCEFF,
    SNI_TABLE_8_SOLAR_FACTOR,
    get_sceff_horizontal,
    get_sceff_vertical,
    get_tdek_roof,
    get_tdek_wall,
)

OUT_ROOT = os.path.join(ROOT_DIR, "fixtures", "synthetic")

# Konstanta default ProjectConfig() (Jakarta, mode sni, sf_source sni2020 sejak Fase 5c)
DEFAULT_CITY = "jakarta"
DEFAULT_WALL_MAT = get_material_by_id("wal_spandrel_insulasi_50")
DEFAULT_GLAZING_MAT = get_material_by_id("glz_igu_triple_silver")
DEFAULT_ROOF_MAT = get_material_by_id("rf_dak_beton_120_insulasi")

assert DEFAULT_WALL_MAT is not None
assert DEFAULT_GLAZING_MAT is not None
assert DEFAULT_ROOF_MAT is not None

U_WALL = float(DEFAULT_WALL_MAT["u_value"])
ALPHA_WALL = float(DEFAULT_WALL_MAT["alpha"])
MASS_WALL = float(DEFAULT_WALL_MAT["massa_kg_m2"])
TDEK_WALL = float(get_tdek_wall(MASS_WALL))

U_GLZ = float(DEFAULT_GLAZING_MAT["u_value"])
U_FRAME_SNI_ALU = 8.0  # SNI 6389:2020 Tabel 3 (aluminium/metal)
FRAME_WIDTH_DEFAULT_M = 0.05  # Bawaan settings.frame_width_mm = 50 mm
GLASS_MODULE_WIDTH_DEFAULT_M = 1.5  # Bawaan settings.glass_module_width_mm = 1500 mm (C1)
SHGC_GLZ = float(DEFAULT_GLAZING_MAT["shgc"])
SCK_GLZ = SHGC_GLZ / SC_TO_SHGC_RATIO  # 0.20 / 0.87

U_ROOF = float(DEFAULT_ROOF_MAT["u_value"])
ALPHA_ROOF = float(DEFAULT_ROOF_MAT["alpha"])
MASS_ROOF = float(DEFAULT_ROOF_MAT["massa_kg_m2"])
TDEQ_ROOF = float(get_tdek_roof(MASS_ROOF))

SF_JAKARTA = dict(SNI_TABLE_8_SOLAR_FACTOR[DEFAULT_CITY]["sf"])
DELTA_T = float(SNI_DELTA_T_K)  # 5.0 K

ORIENTATION_ORDER = ["U", "TL", "T", "TGR", "S", "BD", "B", "BL"]
ORIENT_TO_PAIR = {
    "U": "U_S",
    "S": "U_S",
    "T": "T_B",
    "B": "T_B",
    "TL": "TL_BL",
    "BL": "TL_BL",
    "TGR": "TGR_BD",
    "BD": "TGR_BD",
}

Point3 = Tuple[float, float, float]
Quad3 = Tuple[Point3, Point3, Point3, Point3]


@dataclass
class MeshPart:
    name: str
    material_name: str
    color_rgb: Tuple[float, float, float]
    transparency: float = 0.0  # 0.0 = opaque, 0.7 = glass
    quads: List[Quad3] = field(default_factory=list)
    tris: List[Tuple[Point3, Point3, Point3]] = field(default_factory=list)


# ============================================================================
# 1. PERHITUNGAN ANALITIS (TANPA MEMANGGIL ENGINE)
# ============================================================================

def analytical_orient_from_azimuth(az_deg: float) -> str:
    az = az_deg % 360.0
    idx = int(((az + 22.5) % 360.0) // 45.0)
    return ORIENTATION_ORDER[idx]


def _rounddown_1(val: float) -> float:
    return math.floor(val * 10.0 + 1e-12) / 10.0 if val > 0 else 0.0


def analytical_template_sceff(orient_code: str, r1: float = 0.0, r2: float = 0.0, tilt_deg: float = 0.0) -> float:
    pair = ORIENT_TO_PAIR[orient_code]
    tilt_i = int(round(max(0.0, min(50.0, abs(tilt_deg))) / 10.0) * 10)
    col_idx = SCEFF_1D_ANGLES_DEG.index(tilt_i) if tilt_i in SCEFF_1D_ANGLES_DEG else 0
    if r1 >= 0.10 - 1e-9 and r2 < 0.10 - 1e-9:
        r_bin = round(min(3.0, _rounddown_1(r1)), 1)
        tbl = SNI_TABLE_HORIZONTAL_SCEFF[pair]
        keys = [k for k in sorted(tbl.keys()) if k <= r_bin + 1e-9]
        return float(tbl[keys[-1]][col_idx]) if keys else 1.0
    if r2 >= 0.10 - 1e-9 and r1 < 0.10 - 1e-9:
        r_bin = round(min(3.0, _rounddown_1(r2)), 1)
        tbl = SNI_TABLE_VERTICAL_SCEFF[pair]
        keys = [k for k in sorted(tbl.keys()) if k <= r_bin + 1e-9]
        return float(tbl[keys[-1]][col_idx]) if keys else 1.0
    return 1.0


def analytical_sni_sceff(orient_code: str, r1: float = 0.0, r2: float = 0.0, tilt_deg: float = 0.0) -> float:
    """SCeff mode sni2020 (default sejak Fase 5c): interpolasi linear Tabel A.5-A.12 SNI 6389:2020."""
    if r1 >= 0.10 - 1e-9 and r2 < 0.10 - 1e-9:
        return float(get_sceff_horizontal(orient_code, r1, tilt_deg))
    if r2 >= 0.10 - 1e-9 and r1 < 0.10 - 1e-9:
        return float(get_sceff_vertical(orient_code, r2, tilt_deg))
    return 1.0


def analytical_three_zone_uf(
    w_m: float,
    h_m: float,
    *,
    u_cog: float = U_GLZ,
    u_frame: float = U_FRAME_SNI_ALU,
    fw_m: float = FRAME_WIDTH_DEFAULT_M,
    mod_w_m: float = GLASS_MODULE_WIDTH_DEFAULT_M,
    mod_h_m: float = 4.0,
    measured_ov_frame_m2: Optional[float] = None,
) -> float:
    """U_f tiga zona analitis SNI 6389:2020 Lampiran C + C1 modul virtual untuk bukaan W x H."""
    a_tot = w_m * h_m
    if a_tot <= 1e-12:
        return u_cog
    u_edge = 0.5 * (u_cog + u_frame)
    if measured_ov_frame_m2 is None:
        n_cols = max(1, int(round(w_m / mod_w_m))) if (mod_w_m > 1e-3 and w_m > mod_w_m) else 1
        n_rows = max(1, int(round(h_m / mod_h_m))) if (mod_h_m > 1e-3 and h_m > mod_h_m) else 1
        w_eff = w_m / n_cols
        h_eff = h_m / n_rows
        a_m = w_eff * h_eff
        w_g = max(0.0, w_eff - 2.0 * fw_m)
        h_g = max(0.0, h_eff - 2.0 * fw_m)
        a_g = min(a_m, w_g * h_g)
        a_f = max(0.0, a_m - a_g)
        w_c = max(0.0, w_g - 4.0 * fw_m)
        h_c = max(0.0, h_g - 4.0 * fw_m)
        a_c = min(a_g, w_c * h_c)
        a_e = max(0.0, a_g - a_c)
        return (u_cog * a_c + u_frame * a_f + u_edge * a_e) / a_m
    else:
        a_f = min(a_tot, max(0.0, measured_ov_frame_m2))
        a_g = max(0.0, a_tot - a_f)
        if a_f <= 1e-12 or a_g <= 1e-12:
            a_c, a_e = a_g, 0.0
        else:
            sc = math.sqrt(a_g / a_tot)
            w_g, h_g = w_m * sc, h_m * sc
            w_c = max(0.0, w_g - 4.0 * fw_m)
            h_c = max(0.0, h_g - 4.0 * fw_m)
            a_c = min(a_g, w_c * h_c)
            a_e = max(0.0, a_g - a_c)
    return (u_cog * a_c + u_frame * a_f + u_edge * a_e) / a_tot


def std_box_uf_by_orient(
    codes_20: Tuple[str, ...] = ("U", "S"),
    codes_30: Tuple[str, ...] = ("T", "B"),
) -> Dict[str, float]:
    uf20 = analytical_three_zone_uf(20.0, 1.6)
    uf30 = analytical_three_zone_uf(30.0, 1.6)
    out = {c: uf20 for c in codes_20}
    out.update({c: uf30 for c in codes_30})
    return out


def compute_analytical_expected(
    area_by_orient: Dict[str, Dict[str, float]],
    r1: float = 0.0,
    r2: float = 0.0,
    tilt_deg: float = 0.0,
    opaque_roof_area: float = 600.0,
    skylight_area: float = 0.0,
    is_provisional: bool = False,
    flags_expected: Optional[List[str]] = None,
    error_expected: bool = False,
    extra_notes: str = "",
    uf_by_orient: Optional[Dict[str, float]] = None,
) -> Tuple[Dict[str, Any], str]:
    clean_areas: Dict[str, Dict[str, float]] = {}
    ottv_by_orient: Dict[str, float] = {}
    eff_uf_map = uf_by_orient if uf_by_orient is not None else std_box_uf_by_orient()

    total_area = 0.0
    total_glz = 0.0
    total_heat = 0.0

    for code in ORIENTATION_ORDER:
        entry = area_by_orient.get(code)
        if not entry:
            continue
        a_g = float(entry.get("glazing", 0.0))
        a_w = float(entry.get("wall", 0.0))
        a_tot = a_g + a_w
        if a_tot <= 1e-9:
            continue
        wwr_o = a_g / a_tot
        sf_o = float(SF_JAKARTA[code])
        sceff_o = analytical_sni_sceff(code, r1=r1, r2=r2, tilt_deg=tilt_deg)
        sc_eff_total = SCK_GLZ * sceff_o
        uf_o = float(eff_uf_map.get(code, U_GLZ))
        q_w = ALPHA_WALL * U_WALL * (1.0 - wwr_o) * TDEK_WALL
        q_g = uf_o * wwr_o * DELTA_T
        q_s = sf_o * wwr_o * sc_eff_total
        ottv_o = q_w + q_g + q_s
        clean_areas[code] = {"glazing": round(a_g, 4), "wall": round(a_w, 4)}
        ottv_by_orient[code] = round(ottv_o, 4)
        total_area += a_tot
        total_glz += a_g
        total_heat += a_tot * ottv_o

    wwr_total = (total_glz / total_area) if total_area > 1e-9 else 0.0
    ottv_total = (total_heat / total_area) if total_area > 1e-9 else 0.0

    # RTTV analitis (Pasal 4.4 SNI 6389:2020)
    a_roof_tot = opaque_roof_area + skylight_area
    if a_roof_tot > 1e-6:
        q_rc = (opaque_roof_area * ALPHA_ROOF * U_ROOF * TDEQ_ROOF) / a_roof_tot
        q_sc = (skylight_area * U_GLZ * DELTA_T) / a_roof_tot
        q_ss = (skylight_area * float(SF_JAKARTA["ROOF"]) * SCK_GLZ) / a_roof_tot
        rttv_dict = {
            "applicable": True,
            "opaque_roof_area_m2": round(opaque_roof_area, 4),
            "skylight_area_m2": round(skylight_area, 4),
            "rttv_wm2": round(q_rc + q_sc + q_ss, 4),
        }
    else:
        rttv_dict = {
            "applicable": False,
            "opaque_roof_area_m2": 0.0,
            "skylight_area_m2": 0.0,
            "rttv_wm2": 0.0,
        }

    exp_obj = {
        "area_by_orientation": clean_areas,
        "total_envelope_area_m2": round(total_area, 4),
        "wwr_total": round(wwr_total, 4),
        "ottv_total_wm2": round(ottv_total, 4),
        "ottv_by_orientation": ottv_by_orient,
        "rttv": rttv_dict,
        "is_provisional": bool(is_provisional),
        "flags_expected": list(flags_expected or []),
        "error_expected": bool(error_expected),
    }

    sh_desc = f"R1={r1:.4g}, R2={r2:.4g} (SCeff interpolasi Tabel A.5-A.12)"
    derivation = (
        f"SNI 6389:2020 (sf_source=sni2020 Tabel 8, Jakarta; U_f 3-zona Tabel 3 & Lampiran C): "
        f"Uw={U_WALL}, alpha={ALPHA_WALL}, massa_w={MASS_WALL} kg/m2 -> TDek={TDEK_WALL} K; "
        f"U_cog={U_GLZ}, U_frame={U_FRAME_SNI_ALU}, kusen 50 mm, SHGC={SHGC_GLZ} -> SCk=SHGC/0.87={SCK_GLZ:.6f}, dT={DELTA_T} K; "
        f"Peneduh: {sh_desc}; "
        f"Atap: Ur={U_ROOF}, alpha_r={ALPHA_ROOF}, TDeq={TDEQ_ROOF} K, SF_roof={SF_JAKARTA['ROOF']}. "
        f"OTTV_i = alpha*Uw*(1-WWR)*TDek + Uf_3zona*WWR*dT + SF_i*WWR*(SCk*SCeff_i)."
    )
    if extra_notes:
        derivation += " " + extra_notes
    return exp_obj, derivation


# ============================================================================
# 2. UTILITAS GEOMETRI POLIGON & TRANSFORMASI
# ============================================================================

def make_vertical_quad(a: Tuple[float, float], b: Tuple[float, float], z0: float, z1: float) -> Quad3:
    """Quad vertikal dari a->b (normal ke kanan arah a->b; untuk poligon CCW = keluar)."""
    return (
        (float(a[0]), float(a[1]), float(z0)),
        (float(b[0]), float(b[1]), float(z0)),
        (float(b[0]), float(b[1]), float(z1)),
        (float(a[0]), float(a[1]), float(z1)),
    )


def make_horizontal_quad(pts_xy: Sequence[Tuple[float, float]], z: float, up: bool = True) -> Quad3:
    pts = list(pts_xy) if up else list(reversed(pts_xy))
    return tuple((float(x), float(y), float(z)) for x, y in pts)  # type: ignore[return-value]


def make_box_quads(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> List[Quad3]:
    """Kotak solid tertutup 6 sisi dengan normal keluar."""
    return [
        # Selatan (-Y)
        ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)),
        # Timur (+X)
        ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)),
        # Utara (+Y)
        ((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)),
        # Barat (-X)
        ((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)),
        # Atas (+Z)
        ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)),
        # Bawah (-Z)
        ((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)),
    ]


def make_prism_wall_band_quads(
    a_out: Tuple[float, float],
    b_out: Tuple[float, float],
    a_in: Tuple[float, float],
    b_in: Tuple[float, float],
    z0: float,
    z1: float,
) -> List[Quad3]:
    """Prisma trapesium tertutup (dinding tebal bermiter) antara sisi luar (a_out,b_out) dan dalam (a_in,b_in)."""
    return [
        # Sisi luar (normal keluar)
        make_vertical_quad(a_out, b_out, z0, z1),
        # Sisi dalam (normal ke dalam bangunan)
        make_vertical_quad(b_in, a_in, z0, z1),
        # Sisi ujung A
        make_vertical_quad(a_in, a_out, z0, z1),
        # Sisi ujung B
        make_vertical_quad(b_out, b_in, z0, z1),
        # Tutup atas (+Z)
        ((a_out[0], a_out[1], z1), (b_out[0], b_out[1], z1), (b_in[0], b_in[1], z1), (a_in[0], a_in[1], z1)),
        # Tutup bawah (-Z)
        ((a_in[0], a_in[1], z0), (b_in[0], b_in[1], z0), (b_out[0], b_out[1], z0), (a_out[0], a_out[1], z0)),
    ]


def offset_polygon_inward(poly: Sequence[Tuple[float, float]], thickness: float) -> List[Tuple[float, float]]:
    """Offset poligon CCW ke dalam sebesar `thickness` untuk dinding miter orthogonal/umum."""
    n = len(poly)
    out: List[Tuple[float, float]] = []
    for i in range(n):
        p_prev = poly[(i - 1) % n]
        p_curr = poly[i]
        p_next = poly[(i + 1) % n]
        e1 = np.array([p_curr[0] - p_prev[0], p_curr[1] - p_prev[1]], dtype=np.float64)
        e2 = np.array([p_next[0] - p_curr[0], p_next[1] - p_curr[1]], dtype=np.float64)
        e1 /= np.linalg.norm(e1)
        e2 /= np.linalg.norm(e2)
        # Inward normal for CCW polygon is left normal (-ey, ex)
        n1 = np.array([-e1[1], e1[0]], dtype=np.float64)
        n2 = np.array([-e2[1], e2[0]], dtype=np.float64)
        # Solve intersection of offset lines: (p - (p_curr + t*n1)) . n1 = 0 and ... n2 = 0
        mat = np.array([n1, n2], dtype=np.float64)
        rhs = np.array([thickness, thickness], dtype=np.float64)
        if abs(np.linalg.det(mat)) < 1e-8:
            delta = n1 * thickness
        else:
            delta = np.linalg.solve(mat, rhs)
        out.append((float(p_curr[0] + delta[0]), float(p_curr[1] + delta[1])))
    return out


def transform_point(pt: Point3, fn) -> Point3:
    return fn(pt)


def transform_parts(parts: List[MeshPart], fn) -> List[MeshPart]:
    out: List[MeshPart] = []
    for p in parts:
        out.append(
            MeshPart(
                name=p.name,
                material_name=p.material_name,
                color_rgb=p.color_rgb,
                transparency=p.transparency,
                quads=[tuple(fn(v) for v in q) for q in p.quads],  # type: ignore[misc]
                tris=[tuple(fn(v) for v in t) for t in p.tris],    # type: ignore[misc]
            )
        )
    return out


def rotate_cw_xy(deg: float):
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    # Clockwise in XY plan: (x', y') = (x cos + y sin, -x sin + y cos)
    def _fn(p: Point3) -> Point3:
        x, y, z = p
        return (x * c + y * s, -x * s + y * c, z)
    return _fn


def zup_to_yup(p: Point3) -> Point3:
    # Inverse of engine's (x_zup, y_zup, z_zup) = (x_yup, -z_yup, y_yup)
    return (p[0], p[2], -p[1])


def scale_pt(factor: float):
    def _fn(p: Point3) -> Point3:
        return (p[0] * factor, p[1] * factor, p[2] * factor)
    return _fn


def translate_pt(dx: float, dy: float, dz: float):
    def _fn(p: Point3) -> Point3:
        return (p[0] + dx, p[1] + dy, p[2] + dz)
    return _fn


# ============================================================================
# 3. PEMBANGUN GEOMETRI KOTAK STANDAR & VARIAN
# ============================================================================

STD_BOX_POLY: List[Tuple[float, float]] = [(-10.0, -15.0), (10.0, -15.0), (10.0, 15.0), (-10.0, 15.0)]


def build_ribbon_building_parts(
    polygons: Sequence[Sequence[Tuple[float, float]]],
    roof_quads: List[Quad3],
    floors: int = 4,
    fh: float = 4.0,
    sill: float = 1.2,
    win_h: float = 1.6,
    wall_name: str = "Dinding Bata",
    glz_name: str = "Kaca Jendela",
    roof_name: str = "Atap Beton",
    include_glazing: bool = True,
    wall_thickness: float = 0.0,
    glazing_thickness: float = 0.0,
    roof_tris: Optional[List[Tuple[Point3, Point3, Point3]]] = None,
) -> List[MeshPart]:
    wall_quads: List[Quad3] = []
    glz_quads: List[Quad3] = []

    for poly in polygons:
        n = len(poly)
        inner_poly = offset_polygon_inward(poly, wall_thickness) if wall_thickness > 1e-6 else None
        inner_glz_poly = offset_polygon_inward(poly, glazing_thickness) if glazing_thickness > 1e-6 else None
        for f in range(floors):
            z0 = f * fh
            z_w0 = z0 + sill
            z_w1 = z_w0 + win_h
            z1 = z0 + fh
            for i in range(n):
                a = poly[i]
                b = poly[(i + 1) % n]
                if include_glazing:
                    if inner_poly is not None:
                        ai, bi = inner_poly[i], inner_poly[(i + 1) % n]
                        wall_quads.extend(make_prism_wall_band_quads(a, b, ai, bi, z0, z_w0))
                        wall_quads.extend(make_prism_wall_band_quads(a, b, ai, bi, z_w1, z1))
                    else:
                        wall_quads.append(make_vertical_quad(a, b, z0, z_w0))
                        wall_quads.append(make_vertical_quad(a, b, z_w1, z1))
                    if inner_glz_poly is not None:
                        # Kotak kaca tebal 20 mm per sisi (offset ke dalam tegak lurus segmen)
                        dx, dy = b[0] - a[0], b[1] - a[1]
                        seg_len = math.hypot(dx, dy)
                        nx_in, ny_in = -dy / seg_len, dx / seg_len  # inward normal
                        ag = (a[0] + nx_in * glazing_thickness, a[1] + ny_in * glazing_thickness)
                        bg = (b[0] + nx_in * glazing_thickness, b[1] + ny_in * glazing_thickness)
                        glz_quads.extend(make_prism_wall_band_quads(a, b, ag, bg, z_w0, z_w1))
                    else:
                        glz_quads.append(make_vertical_quad(a, b, z_w0, z_w1))
                else:
                    if inner_poly is not None:
                        ai, bi = inner_poly[i], inner_poly[(i + 1) % n]
                        wall_quads.extend(make_prism_wall_band_quads(a, b, ai, bi, z0, z1))
                    else:
                        wall_quads.append(make_vertical_quad(a, b, z0, z1))

    parts: List[MeshPart] = []
    if wall_quads:
        parts.append(MeshPart(wall_name, wall_name, (0.76, 0.72, 0.68), transparency=0.0, quads=wall_quads))
    if glz_quads:
        parts.append(MeshPart(glz_name, glz_name, (0.48, 0.76, 0.92), transparency=0.7, quads=glz_quads))
    if roof_quads or roof_tris:
        parts.append(
            MeshPart(
                roof_name,
                roof_name,
                (0.55, 0.56, 0.58),
                transparency=0.0,
                quads=list(roof_quads),
                tris=list(roof_tris or []),
            )
        )
    return parts


def std_box_roof() -> List[Quad3]:
    return [make_horizontal_quad(STD_BOX_POLY, 16.0, up=True)]


def std_box_parts(**kwargs) -> List[MeshPart]:
    return build_ribbon_building_parts([STD_BOX_POLY], std_box_roof(), **kwargs)


def std_box_areas() -> Dict[str, Dict[str, float]]:
    return {
        "U": {"glazing": 128.0, "wall": 192.0},
        "T": {"glazing": 192.0, "wall": 288.0},
        "S": {"glazing": 128.0, "wall": 192.0},
        "B": {"glazing": 192.0, "wall": 288.0},
    }


# ============================================================================
# 4. EXPORTERS: .OBJ+.MTL, .GLB (glTF 2.0), .3DM (rhino3dm), .IFC (IFC4)
# ============================================================================

def write_obj_and_mtl(
    obj_path: str,
    parts: List[MeshPart],
    y_up: bool = False,
    with_mtl: bool = True,
    header_comment: Optional[str] = None,
) -> None:
    mtl_name = os.path.splitext(os.path.basename(obj_path))[0] + ".mtl"
    mtl_path = os.path.join(os.path.dirname(obj_path), mtl_name)

    if with_mtl:
        seen_mtls: Dict[str, MeshPart] = {}
        for p in parts:
            if p.material_name not in seen_mtls:
                seen_mtls[p.material_name] = p
        mtl_lines = ["# Synthetic OTTV test materials"]
        for mname, mp in seen_mtls.items():
            safe_m = mname.replace(" ", "_")
            r, g, b = mp.color_rgb
            d_val = max(0.0, min(1.0, 1.0 - mp.transparency))
            mtl_lines.append(f"newmtl {safe_m}")
            mtl_lines.append(f"Kd {r:.3f} {g:.3f} {b:.3f}")
            mtl_lines.append(f"d {d_val:.3f}")
            mtl_lines.append("")
        with open(mtl_path, "w", encoding="utf-8") as fm:
            fm.write("\n".join(mtl_lines))

    lines: List[str] = []
    if header_comment:
        lines.append(f"# {header_comment}")
    elif y_up:
        lines.append("# Synthetic OTTV model (Y-Up)")
    else:
        lines.append("# Synthetic OTTV model (Z-Up)")
    if with_mtl:
        lines.append(f"mtllib {mtl_name}")

    v_idx = 1
    for p in parts:
        safe_g = p.name.replace(" ", "_")
        safe_m = p.material_name.replace(" ", "_")
        lines.append(f"g {safe_g}")
        if with_mtl:
            lines.append(f"usemtl {safe_m}")
        for q in p.quads:
            for pt in q:
                pt_out = zup_to_yup(pt) if y_up else pt
                lines.append(f"v {pt_out[0]:.6f} {pt_out[1]:.6f} {pt_out[2]:.6f}")
            lines.append(f"f {v_idx} {v_idx+1} {v_idx+2} {v_idx+3}")
            v_idx += 4
        for t in p.tris:
            for pt in t:
                pt_out = zup_to_yup(pt) if y_up else pt
                lines.append(f"v {pt_out[0]:.6f} {pt_out[1]:.6f} {pt_out[2]:.6f}")
            lines.append(f"f {v_idx} {v_idx+1} {v_idx+2}")
            v_idx += 3

    with open(obj_path, "w", encoding="utf-8") as fo:
        fo.write("\n".join(lines) + "\n")


def _part_to_vf_arrays(part: MeshPart, convert_yup: bool = True) -> Tuple[np.ndarray, np.ndarray]:
    verts: List[Point3] = []
    indices: List[int] = []
    for q in part.quads:
        base = len(verts)
        for pt in q:
            verts.append(zup_to_yup(pt) if convert_yup else pt)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    for t in part.tris:
        base = len(verts)
        for pt in t:
            verts.append(zup_to_yup(pt) if convert_yup else pt)
        indices.extend([base, base + 1, base + 2])
    v_arr = np.asarray(verts, dtype=np.float32)
    i_arr = np.asarray(indices, dtype=np.uint32)
    return v_arr, i_arr


def write_glb(
    glb_path: str,
    parts: List[MeshPart],
    convert_yup: bool = True,
    merged_single_node_parts: Optional[List[MeshPart]] = None,
    merged_node_name: str = "Fasad_Gabungan",
    omit_materials: bool = False,
) -> None:
    """Menulis binary glTF 2.0 (.glb) presisi dengan alphaMode BLEND/OPAQUE dan dukungan multi-primitif."""
    chunks: List[bytes] = []
    bvs: List[Dict[str, Any]] = []
    accs: List[Dict[str, Any]] = []
    mats: List[Dict[str, Any]] = []
    meshes: List[Dict[str, Any]] = []
    nodes: List[Dict[str, Any]] = []
    offset = 0

    def _add_buf(arr: np.ndarray, target: int, comp_type: int, acc_type: str, with_minmax: bool = False) -> int:
        nonlocal offset
        raw = arr.tobytes()
        pad = (4 - (len(raw) % 4)) % 4
        chunks.append(raw + b"\x00" * pad)
        bv_idx = len(bvs)
        bvs.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": target})
        offset += len(raw) + pad
        acc: Dict[str, Any] = {
            "bufferView": bv_idx,
            "componentType": comp_type,
            "count": int(len(arr)),
            "type": acc_type,
        }
        if with_minmax and len(arr) > 0:
            acc["min"] = [float(x) for x in arr.min(axis=0)]
            acc["max"] = [float(x) for x in arr.max(axis=0)]
        accs.append(acc)
        return len(accs) - 1

    def _add_material(p: MeshPart) -> Optional[int]:
        if omit_materials:
            return None
        r, g, b = p.color_rgb
        alpha = max(0.0, min(1.0, 1.0 - p.transparency))
        mat_def: Dict[str, Any] = {
            "name": p.material_name,
            "alphaMode": "BLEND" if p.transparency > 0.15 else "OPAQUE",
            "pbrMetallicRoughness": {
                "baseColorFactor": [round(r, 3), round(g, 3), round(b, 3), round(alpha, 3)],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.6,
            },
            "doubleSided": False,
        }
        mats.append(mat_def)
        return len(mats) - 1

    # Opsional: satu node berisi beberapa primitif dengan material berbeda (Kasus 20)
    if merged_single_node_parts:
        prims = []
        for mp in merged_single_node_parts:
            v_arr, i_arr = _part_to_vf_arrays(mp, convert_yup=convert_yup)
            if len(v_arr) == 0 or len(i_arr) == 0:
                continue
            pos_acc = _add_buf(v_arr, 34962, 5126, "VEC3", with_minmax=True)
            idx_acc = _add_buf(i_arr, 34963, 5125, "SCALAR", with_minmax=False)
            prim: Dict[str, Any] = {"attributes": {"POSITION": pos_acc}, "indices": idx_acc}
            mat_i = _add_material(mp)
            if mat_i is not None:
                prim["material"] = mat_i
            prims.append(prim)
        if prims:
            m_idx = len(meshes)
            meshes.append({"name": merged_node_name, "primitives": prims})
            nodes.append({"name": merged_node_name, "mesh": m_idx})

    for p in parts:
        v_arr, i_arr = _part_to_vf_arrays(p, convert_yup=convert_yup)
        if len(v_arr) == 0 or len(i_arr) == 0:
            continue
        pos_acc = _add_buf(v_arr, 34962, 5126, "VEC3", with_minmax=True)
        idx_acc = _add_buf(i_arr, 34963, 5125, "SCALAR", with_minmax=False)
        prim = {"attributes": {"POSITION": pos_acc}, "indices": idx_acc}
        mat_i = _add_material(p)
        if mat_i is not None:
            prim["material"] = mat_i
        m_idx = len(meshes)
        meshes.append({"name": p.name, "primitives": [prim]})
        nodes.append({"name": p.name, "mesh": m_idx})

    bin_blob = b"".join(chunks)
    gltf: Dict[str, Any] = {
        "asset": {"version": "2.0", "generator": "OTTV-Synthetic-Generator"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accs,
        "bufferViews": bvs,
        "buffers": [{"byteLength": len(bin_blob)}],
    }
    if mats:
        gltf["materials"] = mats

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    jpad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b" " * jpad
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    with open(glb_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_blob), b"BIN\x00"))
        f.write(bin_blob)


def _meshpart_to_rhino_mesh(p: MeshPart) -> rhino3dm.Mesh:
    rm = rhino3dm.Mesh()
    for q in p.quads:
        base = len(rm.Vertices)
        for pt in q:
            rm.Vertices.Add(float(pt[0]), float(pt[1]), float(pt[2]))
        rm.Faces.AddFace(base, base + 1, base + 2, base + 3)
    for t in p.tris:
        base = len(rm.Vertices)
        for pt in t:
            rm.Vertices.Add(float(pt[0]), float(pt[1]), float(pt[2]))
        rm.Faces.AddFace(base, base + 1, base + 2)
    rm.Normals.ComputeNormals()
    return rm


def write_3dm(
    path_3dm: str,
    parts: List[MeshPart],
    unit_system: Any = rhino3dm.UnitSystem.Meters,
    omit_materials: bool = False,
) -> None:
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = unit_system

    layer_cache: Dict[str, int] = {}
    mat_cache: Dict[str, int] = {}

    for p in parts:
        if p.name not in layer_cache:
            lyr = rhino3dm.Layer()
            lyr.Name = p.name
            r, g, b = p.color_rgb
            lyr.Color = (int(r * 255), int(g * 255), int(b * 255), 255)
            layer_cache[p.name] = model.Layers.Add(lyr)

        mat_idx = -1
        if not omit_materials:
            if p.material_name not in mat_cache:
                rmat = rhino3dm.Material()
                rmat.Name = p.material_name
                r, g, b = p.color_rgb
                rmat.DiffuseColor = (int(r * 255), int(g * 255), int(b * 255), 255)
                rmat.Transparency = float(p.transparency)
                mat_cache[p.material_name] = model.Materials.Add(rmat)
            mat_idx = mat_cache[p.material_name]

        rm = _meshpart_to_rhino_mesh(p)
        attr = rhino3dm.ObjectAttributes()
        attr.LayerIndex = layer_cache[p.name]
        if mat_idx >= 0:
            attr.MaterialIndex = mat_idx
            attr.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        model.Objects.AddMesh(rm, attr)

    model.Write(path_3dm, 8)


# ============================================================================
# 5. IFC4 BUILDER (ifcopenshell.api — IfcWall + IfcOpeningElement + IfcWindow)
# ============================================================================

def _ifc_add_style(ifc, name: str, rgb: Tuple[float, float, float], transparency: float = 0.0):
    style = ifcopenshell.api.run("style.add_style", ifc, name=name)
    ifcopenshell.api.run(
        "style.add_surface_style",
        ifc,
        style=style,
        ifc_class="IfcSurfaceStyleRendering",
        attributes={
            "SurfaceColour": {"Name": name, "Red": float(rgb[0]), "Green": float(rgb[1]), "Blue": float(rgb[2])},
            "Transparency": float(transparency),
            "ReflectanceMethod": "NOTDEFINED",
        },
    )
    return style


def _ifc_make_extruded_rep(
    ifc,
    body_ctx,
    poly_2d: Sequence[Tuple[float, float]],
    z0: float,
    depth: float,
    style=None,
    unit_scale: float = 1.0,
):
    pts_scaled = [(float(x) * unit_scale, float(y) * unit_scale) for x, y in poly_2d]
    # Close polyline if not already closed
    if pts_scaled[0] != pts_scaled[-1]:
        pts_scaled.append(pts_scaled[0])
    ifc_pts = [ifc.create_entity("IfcCartesianPoint", Coordinates=pt) for pt in pts_scaled]
    pline = ifc.create_entity("IfcPolyline", Points=ifc_pts)
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=pline)
    pos = ifc.create_entity(
        "IfcAxis2Placement3D",
        Location=ifc.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, float(z0) * unit_scale)),
        Axis=ifc.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        RefDirection=ifc.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0)),
    )
    solid = ifc.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=pos,
        ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
        Depth=float(depth) * unit_scale,
    )
    if style is not None:
        ifc.create_entity("IfcStyledItem", Item=solid, Styles=[style])
    return ifc.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_ctx,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )


def _ifc_make_facebased_rep(
    ifc,
    body_ctx,
    quads: Sequence[Quad3],
    style=None,
    unit_scale: float = 1.0,
):
    faces = []
    for q in quads:
        pts = [
            ifc.create_entity(
                "IfcCartesianPoint",
                Coordinates=(float(p[0]) * unit_scale, float(p[1]) * unit_scale, float(p[2]) * unit_scale),
            )
            for p in q
        ]
        loop = ifc.create_entity("IfcPolyLoop", Polygon=pts)
        bound = ifc.create_entity("IfcFaceOuterBound", Bound=loop, Orientation=True)
        faces.append(ifc.create_entity("IfcFace", Bounds=[bound]))
    fset = ifc.create_entity("IfcConnectedFaceSet", CfsFaces=faces)
    sb = ifc.create_entity("IfcFaceBasedSurfaceModel", FbsmFaces=[fset])
    if style is not None:
        ifc.create_entity("IfcStyledItem", Item=sb, Styles=[style])
    return ifc.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_ctx,
        RepresentationIdentifier="Body",
        RepresentationType="SurfaceModel",
        Items=[sb],
    )


def _ifc_set_placement(ifc, elem, origin: Tuple[float, float, float] = (0.0, 0.0, 0.0)):
    plc = ifc.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc.create_entity("IfcCartesianPoint", Coordinates=origin),
        ),
    )
    elem.ObjectPlacement = plc


def write_ifc4_ribbon_building(
    ifc_path: str,
    polygons: Sequence[Sequence[Tuple[float, float]]],
    roof_polys: Sequence[Sequence[Tuple[float, float]]],
    floors: int = 4,
    fh: float = 4.0,
    sill: float = 1.2,
    win_h: float = 1.6,
    wall_thickness: float = 0.20,
    unit_mm: bool = False,
    rotate_cw_deg: float = 0.0,
    shift_xyz: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    overhang_depth: float = 0.0,
    fin_depth: float = 0.0,
    fin_spacing: float = 1.5,
    interior_walls: Optional[List[Tuple[Tuple[float, float], Tuple[float, float]]]] = None,
    skylight_poly: Optional[Sequence[Tuple[float, float]]] = None,
    explicit_is_external: bool = False,
    include_glazing: bool = True,
) -> None:
    """Membuat model IFC4 valid dengan IfcWall + IfcOpeningElement + IfcWindow + IfcRoof (+ IfcShadingDevice)."""
    ifc = ifcopenshell.api.run("project.create_file", version="IFC4")
    project = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcProject", name="OTTV_Synthetic_IFC4")
    unit_scale = 1000.0 if unit_mm else 1.0
    ifcopenshell.api.run(
        "unit.assign_unit",
        ifc,
        length={"is_metric": True, "raw": "MILLIMETERS" if unit_mm else "METERS"},
    )
    model_ctx = ifcopenshell.api.run("context.add_context", ifc, context_type="Model")
    body_ctx = ifcopenshell.api.run(
        "context.add_context",
        ifc,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_ctx,
    )

    site = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuilding", name="Synthetic_Building")
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=project, products=[site])
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=site, products=[building])

    st_wall = _ifc_add_style(ifc, "Dinding Bata", (0.76, 0.72, 0.68), transparency=0.0)
    st_glass = _ifc_add_style(ifc, "Kaca Jendela", (0.48, 0.76, 0.92), transparency=0.7)
    st_roof = _ifc_add_style(ifc, "Atap Beton", (0.55, 0.56, 0.58), transparency=0.0)
    st_shade = _ifc_add_style(ifc, "Peneduh", (0.62, 0.44, 0.25), transparency=0.0)

    rot_fn = rotate_cw_xy(rotate_cw_deg) if abs(rotate_cw_deg) > 1e-6 else None
    sx, sy, sz = shift_xyz

    def _xform_xy(pt: Tuple[float, float]) -> Tuple[float, float]:
        x, y = pt
        if rot_fn is not None:
            x, y, _ = rot_fn((x, y, 0.0))
        return (x + sx, y + sy)

    def _xform_poly(poly: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
        return [_xform_xy(p) for p in poly]

    storeys = []
    for f in range(floors):
        st = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuildingStorey", name=f"Lantai {f+1}")
        st.Elevation = float(f * fh + sz) * unit_scale
        ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=building, products=[st])
        storeys.append(st)

    for poly_raw in polygons:
        poly = _xform_poly(poly_raw)
        inner_poly = offset_polygon_inward(poly, wall_thickness)
        n = len(poly)
        for f in range(floors):
            z0 = f * fh + sz
            z_w0 = z0 + sill
            z_w1 = z_w0 + win_h
            storey = storeys[f]
            for i in range(n):
                a_out = poly[i]
                b_out = poly[(i + 1) % n]
                a_in = inner_poly[i]
                b_in = inner_poly[(i + 1) % n]

                # Dinding solid bermiter (IfcWall) dengan bukaan penuh IfcOpeningElement + IfcWindow
                wall_fp = [a_out, b_out, b_in, a_in]
                wall = ifcopenshell.api.run(
                    "root.create_entity", ifc, ifc_class="IfcWall", name=f"Dinding_L{f+1}_S{i+1}"
                )
                _ifc_set_placement(ifc, wall)
                w_rep = _ifc_make_extruded_rep(ifc, body_ctx, wall_fp, z0, fh, style=st_wall, unit_scale=unit_scale)
                wall.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[w_rep])
                ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[wall])
                if explicit_is_external:
                    pset = ifcopenshell.api.run("pset.add_pset", ifc, product=wall, name="Pset_WallCommon")
                    ifcopenshell.api.run("pset.edit_pset", ifc, pset=pset, properties={"IsExternal": True})

                if not include_glazing:
                    continue

                # Opening sedikit lebih tebal dari dinding agar boolean OpenCASCADE bersih sempurna
                dx, dy = b_out[0] - a_out[0], b_out[1] - a_out[1]
                seg_len = math.hypot(dx, dy)
                nx_out, ny_out = dy / seg_len, -dx / seg_len
                tx, ty = dx / seg_len, dy / seg_len
                # Perpanjang opening 0.05m keluar & ke dalam dinding dan sedikit melewati miter
                ext_t = 0.05
                op_fp = [
                    (a_out[0] + nx_out * ext_t - tx * ext_t, a_out[1] + ny_out * ext_t - ty * ext_t),
                    (b_out[0] + nx_out * ext_t + tx * ext_t, b_out[1] + ny_out * ext_t + ty * ext_t),
                    (b_in[0] - nx_out * ext_t + tx * ext_t, b_in[1] - ny_out * ext_t + ty * ext_t),
                    (a_in[0] - nx_out * ext_t - tx * ext_t, a_in[1] - ny_out * ext_t - ty * ext_t),
                ]
                opening = ifcopenshell.api.run(
                    "root.create_entity", ifc, ifc_class="IfcOpeningElement", name=f"Bukaan_L{f+1}_S{i+1}"
                )
                _ifc_set_placement(ifc, opening)
                op_rep = _ifc_make_extruded_rep(ifc, body_ctx, op_fp, z_w0, win_h, style=None, unit_scale=unit_scale)
                opening.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[op_rep])
                ifcopenshell.api.run("feature.add_feature", ifc, feature=opening, element=wall)

                # IfcWindow tipis 0.02 m rata dengan bidang luar (agar luas luar = tepat panjang segmen x 1.6 m)
                glz_t = 0.02
                win_fp = [
                    a_out,
                    b_out,
                    (b_out[0] - nx_out * glz_t, b_out[1] - ny_out * glz_t),
                    (a_out[0] - nx_out * glz_t, a_out[1] - ny_out * glz_t),
                ]
                window = ifcopenshell.api.run(
                    "root.create_entity", ifc, ifc_class="IfcWindow", name=f"Kaca_L{f+1}_S{i+1}"
                )
                _ifc_set_placement(ifc, window)
                win_rep = _ifc_make_extruded_rep(ifc, body_ctx, win_fp, z_w0, win_h, style=st_glass, unit_scale=unit_scale)
                window.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[win_rep])
                ifcopenshell.api.run("feature.add_filling", ifc, opening=opening, element=window)
                ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[window])

                # Overhang horizontal (Kasus 8)
                if overhang_depth > 1e-4:
                    ov_fp = [
                        a_out,
                        (a_out[0] + nx_out * overhang_depth, a_out[1] + ny_out * overhang_depth),
                        (b_out[0] + nx_out * overhang_depth, b_out[1] + ny_out * overhang_depth),
                        b_out,
                    ]
                    sh = ifcopenshell.api.run(
                        "root.create_entity", ifc, ifc_class="IfcShadingDevice", name=f"Overhang_L{f+1}_S{i+1}"
                    )
                    _ifc_set_placement(ifc, sh)
                    sh_rep = _ifc_make_extruded_rep(ifc, body_ctx, ov_fp, z_w1, 0.04, style=st_shade, unit_scale=unit_scale)
                    sh.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[sh_rep])
                    ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[sh])

                # Sirip vertikal (Kasus 9)
                if fin_depth > 1e-4:
                    n_bays = int(round(seg_len / fin_spacing))
                    fin_t = 0.02
                    for k in range(n_bays + 1):
                        s_pos = min(seg_len, k * fin_spacing)
                        # Letakkan sirip menempel di s_pos sepanjang segmen
                        cx_f = a_out[0] + tx * s_pos
                        cy_f = a_out[1] + ty * s_pos
                        ht = 0.5 * fin_t
                        fin_fp = [
                            (cx_f - tx * ht, cy_f - ty * ht),
                            (cx_f + tx * ht, cy_f + ty * ht),
                            (cx_f + tx * ht + nx_out * fin_depth, cy_f + ty * ht + ny_out * fin_depth),
                            (cx_f - tx * ht + nx_out * fin_depth, cy_f - ty * ht + ny_out * fin_depth),
                        ]
                        sh = ifcopenshell.api.run(
                            "root.create_entity", ifc, ifc_class="IfcShadingDevice", name=f"Sirip_L{f+1}_S{i+1}_{k}"
                        )
                        _ifc_set_placement(ifc, sh)
                        sh_rep = _ifc_make_extruded_rep(ifc, body_ctx, fin_fp, z_w0, win_h, style=st_shade, unit_scale=unit_scale)
                        sh.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[sh_rep])
                        ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[sh])

    # Partisi interior (Kasus 14: IsExternal=False)
    if interior_walls:
        for idx_iw, (pa_raw, pb_raw) in enumerate(interior_walls):
            pa = _xform_xy(pa_raw)
            pb = _xform_xy(pb_raw)
            dx, dy = pb[0] - pa[0], pb[1] - pa[1]
            ln = math.hypot(dx, dy)
            nx, ny = -dy / ln * 0.075, dx / ln * 0.075
            iw_fp = [
                (pa[0] - nx, pa[1] - ny),
                (pb[0] - nx, pb[1] - ny),
                (pb[0] + nx, pb[1] + ny),
                (pa[0] + nx, pa[1] + ny),
            ]
            iw = ifcopenshell.api.run(
                "root.create_entity", ifc, ifc_class="IfcWall", name=f"Partisi_Dalam_{idx_iw+1}"
            )
            _ifc_set_placement(ifc, iw)
            iw_rep = _ifc_make_extruded_rep(ifc, body_ctx, iw_fp, sz, floors * fh, style=st_wall, unit_scale=unit_scale)
            iw.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[iw_rep])
            ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storeys[0], products=[iw])
            pset = ifcopenshell.api.run("pset.add_pset", ifc, product=iw, name="Pset_WallCommon")
            ifcopenshell.api.run("pset.edit_pset", ifc, pset=pset, properties={"IsExternal": False})

    # Atap datar (IfcRoof)
    z_roof = floors * fh + sz
    for r_i, r_poly_raw in enumerate(roof_polys):
        r_poly = _xform_poly(r_poly_raw)
        roof = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcRoof", name=f"Atap Beton {r_i+1}")
        _ifc_set_placement(ifc, roof)
        r_rep = _ifc_make_extruded_rep(ifc, body_ctx, r_poly, z_roof, 0.15, style=st_roof, unit_scale=unit_scale)
        roof.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[r_rep])
        ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storeys[-1], products=[roof])

    # Skylight datar di atap (Kasus 16)
    if skylight_poly:
        sp = _xform_poly(skylight_poly)
        sky = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcWindow", name="Kaca Skylight")
        _ifc_set_placement(ifc, sky)
        # Gunakan permukaan tunggal (FaceBasedSurfaceModel) agar sisi atas = 16 m2 tepat
        sky_quad: Quad3 = tuple((p[0], p[1], z_roof) for p in sp)  # type: ignore[assignment]
        s_rep = _ifc_make_facebased_rep(ifc, body_ctx, [sky_quad], style=st_glass, unit_scale=unit_scale)
        sky.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[s_rep])
        ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storeys[-1], products=[sky])

    ifc.write(ifc_path)


# ============================================================================
# 6. GENERATOR KHUSUS KASUS 11 (BLOK BERSARANG), 12 (BREP), 21 (IFC CW OPAK)
# ============================================================================

def write_case11_nested_blocks_3dm(path_3dm: str) -> None:
    """
    Kasus 11: Panel jendela sebagai blok `Panel_Jendela` di dalam blok `Lantai`,
    diinstans 4x (tiap lantai). Definisi kedua blok berada di sekitar (1000, 1000, 0)
    agar teruji bahwa definisi blok tidak ikut dihitung ganda di titik asalnya.
    """
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

    def _add_layer(name: str, rgb: Tuple[int, int, int]) -> int:
        lyr = rhino3dm.Layer()
        lyr.Name = name
        lyr.Color = (rgb[0], rgb[1], rgb[2], 255)
        return model.Layers.Add(lyr)

    idx_wall = _add_layer("Dinding Bata", (194, 184, 173))
    idx_glz = _add_layer("Kaca Jendela", (122, 194, 235))
    idx_roof = _add_layer("Atap Beton", (140, 143, 148))
    idx_blk = _add_layer("Default", (128, 128, 128))

    mat_w = rhino3dm.Material()
    mat_w.Name = "Dinding Bata"
    mat_w.Transparency = 0.0
    im_w = model.Materials.Add(mat_w)

    mat_g = rhino3dm.Material()
    mat_g.Name = "Kaca Jendela"
    mat_g.Transparency = 0.7
    im_g = model.Materials.Add(mat_g)

    mat_r = rhino3dm.Material()
    mat_r.Name = "Atap Beton"
    mat_r.Transparency = 0.0
    im_r = model.Materials.Add(mat_r)

    def _attr(l_idx: int, m_idx: int) -> rhino3dm.ObjectAttributes:
        a = rhino3dm.ObjectAttributes()
        a.LayerIndex = l_idx
        a.MaterialIndex = m_idx
        a.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        return a

    # Blok dalam `Panel_Jendela`: quad kaca 10m x 1.6m menghadap -Y, didefinisikan di (1000, 1000, 0)
    def _make_panel_mesh(width: float) -> rhino3dm.Mesh:
        m = rhino3dm.Mesh()
        bx, by, bz = 1000.0, 1000.0, 0.0
        m.Vertices.Add(bx, by, bz)
        m.Vertices.Add(bx + width, by, bz)
        m.Vertices.Add(bx + width, by, bz + 1.6)
        m.Vertices.Add(bx, by, bz + 1.6)
        m.Faces.AddFace(0, 1, 2, 3)
        m.Normals.ComputeNormals()
        return m

    idef_panel_idx = model.InstanceDefinitions.Add(
        "Panel_Jendela",
        "Panel jendela kaca 10x1.6m di (1000,1000,0)",
        "",
        "",
        rhino3dm.Point3d(1000.0, 1000.0, 0.0),
        (_make_panel_mesh(10.0),),
        (_attr(idx_glz, im_g),),
    )
    idef_panel = model.InstanceDefinitions[idef_panel_idx]

    # Blok luar `Lantai`: 1 lantai dinding + 10 instans `Panel_Jendela` (2 di S, 3 di T, 2 di U, 3 di B),
    # seluruh geometri didefinisikan relatif terhadap titik asal (1000, 1000, 0).
    ox, oy, oz = 1000.0, 1000.0, 0.0
    poly_shifted = [(p[0] + ox, p[1] + oy) for p in STD_BOX_POLY]
    wall_quads_1fl: List[Quad3] = []
    for i in range(4):
        a = poly_shifted[i]
        b = poly_shifted[(i + 1) % 4]
        wall_quads_1fl.append(make_vertical_quad(a, b, oz, oz + 1.2))
        wall_quads_1fl.append(make_vertical_quad(a, b, oz + 2.8, oz + 4.0))
    wall_mesh_1fl = _meshpart_to_rhino_mesh(MeshPart("Dinding Bata", "Dinding Bata", (0.76, 0.72, 0.68), 0.0, wall_quads_1fl))

    lantai_geoms: List[Any] = [wall_mesh_1fl]
    lantai_attrs: List[Any] = [_attr(idx_wall, im_w)]

    def _xform_panel(target_start: Point3, rot_z_deg: float) -> rhino3dm.Transform:
        # Panel idef memiliki basePoint di (1000,1000,0), jadi Transform.Translation(target - (0,0,0))
        # setelah rotasi di sekitar (0,0,0) karena rhino3dm menggeser geometri idef dengan -basePoint?
        # Verifikasi: saat InstanceDefinitions.Add(..., basePoint=(1000,1000,0)), Rhino menyimpan objek
        # di koordinat (1000,1000,0) atau sudah digeser ke origin idef. Kita pakai basePoint=(0,0,0)
        # agar koordinat definisi benar-benar di (1000,1000,0) dan transform menggeser (-1000,-1000,0) -> target!
        t_to_origin = rhino3dm.Transform.Translation(-1000.0, -1000.0, 0.0)
        t_rot = rhino3dm.Transform.Rotation(math.radians(rot_z_deg), rhino3dm.Vector3d(0, 0, 1), rhino3dm.Point3d(0, 0, 0))
        t_to_target = rhino3dm.Transform.Translation(target_start[0], target_start[1], target_start[2])
        return rhino3dm.Transform.Multiply(t_to_target, rhino3dm.Transform.Multiply(t_rot, t_to_origin))

    # Recreate Panel_Jendela with basePoint=(0,0,0) so its vertices physically sit at (1000,1000,0)
    model2 = rhino3dm.File3dm()
    model2.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters
    idx_wall = model2.Layers.Add(model.Layers[idx_wall])
    idx_glz = model2.Layers.Add(model.Layers[idx_glz])
    idx_roof = model2.Layers.Add(model.Layers[idx_roof])
    idx_blk = model2.Layers.Add(model.Layers[idx_blk])
    im_w = model2.Materials.Add(mat_w)
    im_g = model2.Materials.Add(mat_g)
    im_r = model2.Materials.Add(mat_r)

    idef_panel_idx = model2.InstanceDefinitions.Add(
        "Panel_Jendela",
        "Definisi panel jendela di (1000,1000,0)",
        "",
        "",
        rhino3dm.Point3d(0.0, 0.0, 0.0),
        (_make_panel_mesh(10.0),),
        (_attr(idx_glz, im_g),),
    )
    idef_panel = model2.InstanceDefinitions[idef_panel_idx]

    # Tempatkan 10 panel jendela pada 4 sisi blok Lantai (yang juga berada di sekitar 1000, 1000, 0)
    placements = [
        # Selatan (rot 0 deg): x = -10..0, 0..10 at y = -15
        ((ox - 10.0, oy - 15.0, oz + 1.2), 0.0),
        ((ox + 0.0, oy - 15.0, oz + 1.2), 0.0),
        # Timur (rot 90 deg CCW): y = -15..-5, -5..5, 5..15 at x = +10
        ((ox + 10.0, oy - 15.0, oz + 1.2), 90.0),
        ((ox + 10.0, oy - 5.0, oz + 1.2), 90.0),
        ((ox + 10.0, oy + 5.0, oz + 1.2), 90.0),
        # Utara (rot 180 deg): x = +10..0, 0..-10 at y = +15
        ((ox + 10.0, oy + 15.0, oz + 1.2), 180.0),
        ((ox + 0.0, oy + 15.0, oz + 1.2), 180.0),
        # Barat (rot 270 deg): y = +15..5, 5..-5, -5..-15 at x = -10
        ((ox - 10.0, oy + 15.0, oz + 1.2), 270.0),
        ((ox - 10.0, oy + 5.0, oz + 1.2), 270.0),
        ((ox - 10.0, oy - 5.0, oz + 1.2), 270.0),
    ]
    for tgt, rot_deg in placements:
        iref = rhino3dm.InstanceReference(idef_panel.Id, _xform_panel(tgt, rot_deg))
        lantai_geoms.append(iref)
        a_blk = rhino3dm.ObjectAttributes()
        a_blk.LayerIndex = idx_blk
        lantai_attrs.append(a_blk)

    idef_lantai_idx = model2.InstanceDefinitions.Add(
        "Lantai",
        "Blok lantai di (1000,1000,0) berisi dinding & instans Panel_Jendela",
        "",
        "",
        rhino3dm.Point3d(0.0, 0.0, 0.0),
        tuple(lantai_geoms),
        tuple(lantai_attrs),
    )
    idef_lantai = model2.InstanceDefinitions[idef_lantai_idx]

    # Instans 4 lantai ke posisi bangunan sebenarnya (0, 0, 4*f)
    for f in range(4):
        xf = rhino3dm.Transform.Translation(-1000.0, -1000.0, float(f * 4.0))
        a_fl = rhino3dm.ObjectAttributes()
        a_fl.LayerIndex = idx_blk
        model2.Objects.AddInstanceObject(rhino3dm.InstanceReference(idef_lantai.Id, xf), a_fl)

    # Atap datar
    roof_mesh = _meshpart_to_rhino_mesh(MeshPart("Atap Beton", "Atap Beton", (0.55, 0.56, 0.58), 0.0, std_box_roof()))
    model2.Objects.AddMesh(roof_mesh, _attr(idx_roof, im_r))
    model2.Write(path_3dm, 8)


def write_case12_brep_no_mesh_3dm(path_3dm: str) -> None:
    """Kasus 12: Dinding sebagai Brep tanpa render mesh; kaca dan atap sebagai Mesh."""
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters

    def _add_layer(name: str, rgb: Tuple[int, int, int]) -> int:
        lyr = rhino3dm.Layer()
        lyr.Name = name
        lyr.Color = (rgb[0], rgb[1], rgb[2], 255)
        return model.Layers.Add(lyr)

    idx_wall = _add_layer("Dinding Bata", (194, 184, 173))
    idx_glz = _add_layer("Kaca Jendela", (122, 194, 235))
    idx_roof = _add_layer("Atap Beton", (140, 143, 148))

    mat_w = rhino3dm.Material()
    mat_w.Name = "Dinding Bata"
    im_w = model.Materials.Add(mat_w)
    mat_g = rhino3dm.Material()
    mat_g.Name = "Kaca Jendela"
    mat_g.Transparency = 0.7
    im_g = model.Materials.Add(mat_g)
    mat_r = rhino3dm.Material()
    mat_r.Name = "Atap Beton"
    im_r = model.Materials.Add(mat_r)

    # Dinding sebagai Brep tanpa render mesh (8 kotak spandrel per lantai -> 32 Brep * 6 faces = 192 faces tanpa mesh)
    for f in range(4):
        z0 = f * 4.0
        for zb0, zb1 in ((z0, z0 + 1.2), (z0 + 2.8, z0 + 4.0)):
            boxes = [
                rhino3dm.BoundingBox(rhino3dm.Point3d(-10.0, -15.0, zb0), rhino3dm.Point3d(10.0, -14.8, zb1)),
                rhino3dm.BoundingBox(rhino3dm.Point3d(-10.0, 14.8, zb0), rhino3dm.Point3d(10.0, 15.0, zb1)),
                rhino3dm.BoundingBox(rhino3dm.Point3d(9.8, -14.8, zb0), rhino3dm.Point3d(10.0, 14.8, zb1)),
                rhino3dm.BoundingBox(rhino3dm.Point3d(-10.0, -14.8, zb0), rhino3dm.Point3d(-9.8, 14.8, zb1)),
            ]
            for bb in boxes:
                brep = rhino3dm.Brep.CreateFromBox(rhino3dm.Box(bb))
                attr = rhino3dm.ObjectAttributes()
                attr.LayerIndex = idx_wall
                attr.MaterialIndex = im_w
                attr.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
                model.Objects.AddBrep(brep, attr)

    # Kaca & atap sebagai Mesh
    parts = std_box_parts()
    for p in parts:
        if p.name == "Dinding Bata":
            continue
        rm = _meshpart_to_rhino_mesh(p)
        attr = rhino3dm.ObjectAttributes()
        attr.LayerIndex = idx_glz if p.name == "Kaca Jendela" else idx_roof
        attr.MaterialIndex = im_g if p.name == "Kaca Jendela" else im_r
        attr.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        model.Objects.AddMesh(rm, attr)

    model.Write(path_3dm, 8)


def write_case21_ifc_cw_opak(ifc_path: str, obj_path: str) -> None:
    """
    Kasus 21: IFC4 curtain wall berisi IfcPlate kaca transparan ("Glass - Clear")
    + IfcPlate opak bercat ("Paint - Orange", tinggi 1,2 m -> spandrel), plus versi .obj
    dengan geometri dan material yang sama (B1 regression test).
    """
    ifc = ifcopenshell.api.run("project.create_file", version="IFC4")
    project = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcProject", name="Case21_IFC_CW_Opak")
    ifcopenshell.api.run("unit.assign_unit", ifc, length={"is_metric": True, "raw": "METERS"})
    model_ctx = ifcopenshell.api.run("context.add_context", ifc, context_type="Model")
    body_ctx = ifcopenshell.api.run(
        "context.add_context",
        ifc,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_ctx,
    )

    site = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuilding", name="CW_Building")
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=project, products=[site])
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=site, products=[building])

    st_glass = _ifc_add_style(ifc, "Glass - Clear", (0.48, 0.76, 0.92), transparency=0.7)
    st_orange = _ifc_add_style(ifc, "Paint - Orange", (0.88, 0.42, 0.14), transparency=0.0)
    st_roof = _ifc_add_style(ifc, "Atap Beton", (0.55, 0.56, 0.58), transparency=0.0)

    storeys = []
    for f in range(4):
        st = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuildingStorey", name=f"Lantai {f+1}")
        st.Elevation = float(f * 4.0)
        ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=building, products=[st])
        storeys.append(st)

    cw = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcCurtainWall", name="CurtainWall_Facade")
    _ifc_set_placement(ifc, cw)
    ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storeys[0], products=[cw])

    cw_children = []
    poly = STD_BOX_POLY
    plate_t = 0.03
    for f in range(4):
        z0 = f * 4.0
        for i in range(4):
            a = poly[i]
            b = poly[(i + 1) % 4]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            nx_in, ny_in = -dy / ln, dx / ln
            fp = [
                a,
                b,
                (b[0] + nx_in * plate_t, b[1] + ny_in * plate_t),
                (a[0] + nx_in * plate_t, a[1] + ny_in * plate_t),
            ]
            # 2 spandrel opak bercat oranye (0..1.2 dan 2.8..4.0) + 1 plate kaca (1.2..2.8)
            for tag, za, zb, style in (
                ("Spandrel_Bot", z0, z0 + 1.2, st_orange),
                ("Vision_Glass", z0 + 1.2, z0 + 2.8, st_glass),
                ("Spandrel_Top", z0 + 2.8, z0 + 4.0, st_orange),
            ):
                pl = ifcopenshell.api.run(
                    "root.create_entity", ifc, ifc_class="IfcPlate", name=f"{tag}_L{f+1}_S{i+1}"
                )
                _ifc_set_placement(ifc, pl)
                rep = _ifc_make_extruded_rep(ifc, body_ctx, fp, za, zb - za, style=style)
                pl.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[rep])
                cw_children.append(pl)

    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=cw, products=cw_children)

    roof = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcRoof", name="Atap Beton")
    _ifc_set_placement(ifc, roof)
    r_rep = _ifc_make_extruded_rep(ifc, body_ctx, poly, 16.0, 0.15, style=st_roof)
    roof.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[r_rep])
    ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storeys[-1], products=[roof])
    ifc.write(ifc_path)

    # Versi .obj dengan material & geometri yang sama (A-WALL Paint_-_Orange + A-WALL Glass_-_Clear)
    obj_parts = build_ribbon_building_parts(
        [STD_BOX_POLY],
        std_box_roof(),
        wall_name="A-WALL Paint_-_Orange",
        glz_name="A-WALL Glass_-_Clear",
        roof_name="Atap Beton",
    )
    obj_parts[0].material_name = "Paint_-_Orange"
    obj_parts[0].color_rgb = (0.88, 0.42, 0.14)
    obj_parts[1].material_name = "Glass_-_Clear"
    write_obj_and_mtl(obj_path, obj_parts, y_up=False, with_mtl=True)


def write_case22_ifc_covering_and_instance_ids(ifc_path: str) -> None:
    """
    Kasus 22 (regresi Tingkat B — B6 & B7):
      - Kotak standar IFC4 dengan dinding tanpa IfcSurfaceStyle dan nama bersufiks ID instans
        ArchiCAD (`Dinding Bata_(#100001)`..`_(#100016)`), yang harus digabung ke 1 grup `IFC_Wall :: Dinding Bata`.
      - Ditambah 4 elemen interior `IfcCovering` bertipe `CEILING` & `FLOORING` (seperti Duplex_A),
        yang harus diklasifikasikan sebagai `ignore` (bukan `unknown`).
    """
    ifc = ifcopenshell.api.run("project.create_file", version="IFC4")
    project = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcProject", name="Case22_Covering_IDs")
    ifcopenshell.api.run("unit.assign_unit", ifc, length={"is_metric": True, "raw": "METERS"})
    model_ctx = ifcopenshell.api.run("context.add_context", ifc, context_type="Model")
    body_ctx = ifcopenshell.api.run(
        "context.add_context",
        ifc,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_ctx,
    )
    site = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuilding", name="Building")
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=project, products=[site])
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=site, products=[building])

    st_glass = _ifc_add_style(ifc, "Kaca Jendela", (0.48, 0.76, 0.92), transparency=0.7)
    st_roof = _ifc_add_style(ifc, "Atap Beton", (0.55, 0.56, 0.58), transparency=0.0)

    storeys = []
    for f in range(4):
        st = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcBuildingStorey", name=f"Lantai {f+1}")
        st.Elevation = float(f * 4.0)
        ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=building, products=[st])
        storeys.append(st)

    poly = STD_BOX_POLY
    inner_poly = offset_polygon_inward(poly, 0.20)
    inst_id = 100000
    for f in range(4):
        z0 = f * 4.0
        z_w0, z_w1 = z0 + 1.2, z0 + 2.8
        storey = storeys[f]
        for i in range(4):
            inst_id += 1
            a_out, b_out = poly[i], poly[(i + 1) % 4]
            a_in, b_in = inner_poly[i], inner_poly[(i + 1) % 4]
            dx, dy = b_out[0] - a_out[0], b_out[1] - a_out[1]
            ln = math.hypot(dx, dy)
            nx_out, ny_out = dy / ln, -dx / ln
            tx, ty = dx / ln, dy / ln

            # Dinding tanpa surface style, nama membawa sufiks ID instans ArchiCAD `_(#100001)`
            wall = ifcopenshell.api.run(
                "root.create_entity", ifc, ifc_class="IfcWall", name=f"Dinding Bata_(#{inst_id})"
            )
            _ifc_set_placement(ifc, wall)
            w_rep = _ifc_make_extruded_rep(ifc, body_ctx, [a_out, b_out, b_in, a_in], z0, 4.0, style=None)
            wall.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[w_rep])
            ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[wall])

            ext_t = 0.05
            op_fp = [
                (a_out[0] + nx_out * ext_t - tx * ext_t, a_out[1] + ny_out * ext_t - ty * ext_t),
                (b_out[0] + nx_out * ext_t + tx * ext_t, b_out[1] + ny_out * ext_t + ty * ext_t),
                (b_in[0] - nx_out * ext_t + tx * ext_t, b_in[1] - ny_out * ext_t + ty * ext_t),
                (a_in[0] - nx_out * ext_t - tx * ext_t, a_in[1] - ny_out * ext_t - ty * ext_t),
            ]
            opening = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcOpeningElement", name=f"Op_{inst_id}")
            _ifc_set_placement(ifc, opening)
            op_rep = _ifc_make_extruded_rep(ifc, body_ctx, op_fp, z_w0, 1.6, style=None)
            opening.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[op_rep])
            ifcopenshell.api.run("feature.add_feature", ifc, feature=opening, element=wall)

            win_fp = [
                a_out,
                b_out,
                (b_out[0] - nx_out * 0.02, b_out[1] - ny_out * 0.02),
                (a_out[0] - nx_out * 0.02, a_out[1] - ny_out * 0.02),
            ]
            window = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcWindow", name=f"Kaca_(#{inst_id})")
            _ifc_set_placement(ifc, window)
            win_rep = _ifc_make_extruded_rep(ifc, body_ctx, win_fp, z_w0, 1.6, style=st_glass)
            window.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[win_rep])
            ifcopenshell.api.run("feature.add_filling", ifc, opening=opening, element=window)
            ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[window])

        # Interior IfcCovering (CEILING & FLOORING) dengan nama generik (tanpa style) -> harus 'ignore'
        cov_fp = [(-9.5, -14.5), (9.5, -14.5), (9.5, 14.5), (-9.5, 14.5)]
        ceil_el = ifcopenshell.api.run(
            "root.create_entity", ifc, ifc_class="IfcCovering", name=f"Finish_Atas_(#{200000+f})", predefined_type="CEILING"
        )
        _ifc_set_placement(ifc, ceil_el)
        ceil_el.Representation = ifc.create_entity(
            "IfcProductDefinitionShape",
            Representations=[_ifc_make_extruded_rep(ifc, body_ctx, cov_fp, z0 + 3.7, 0.05, style=None)],
        )
        ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[ceil_el])

        flr_el = ifcopenshell.api.run(
            "root.create_entity", ifc, ifc_class="IfcCovering", name=f"Finish_Bawah_(#{300000+f})", predefined_type="FLOORING"
        )
        _ifc_set_placement(ifc, flr_el)
        flr_el.Representation = ifc.create_entity(
            "IfcProductDefinitionShape",
            Representations=[_ifc_make_extruded_rep(ifc, body_ctx, cov_fp, z0 + 0.05, 0.05, style=None)],
        )
        ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storey, products=[flr_el])

    roof = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcRoof", name="Atap Beton")
    _ifc_set_placement(ifc, roof)
    roof.Representation = ifc.create_entity(
        "IfcProductDefinitionShape",
        Representations=[_ifc_make_extruded_rep(ifc, body_ctx, poly, 16.0, 0.15, style=st_roof)],
    )
    ifcopenshell.api.run("spatial.assign_container", ifc, relating_structure=storeys[-1], products=[roof])
    ifc.write(ifc_path)


# ============================================================================
# 7. OVERHANG & SIRIP HELPER UNTUK FORMAT NON-IFC
# ============================================================================

def build_overhang_part(poly: Sequence[Tuple[float, float]], depth: float = 1.0, floors: int = 4, fh: float = 4.0) -> MeshPart:
    quads: List[Quad3] = []
    n = len(poly)
    for f in range(floors):
        z_top = f * fh + 2.8
        for i in range(n):
            a = poly[i]
            b = poly[(i + 1) % n]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            nx_out, ny_out = dy / ln, -dx / ln
            ao = (a[0] + nx_out * depth, a[1] + ny_out * depth)
            bo = (b[0] + nx_out * depth, b[1] + ny_out * depth)
            quads.append(((a[0], a[1], z_top), (ao[0], ao[1], z_top), (bo[0], bo[1], z_top), (b[0], b[1], z_top)))
    return MeshPart("Peneduh Overhang", "Peneduh Overhang", (0.62, 0.44, 0.25), transparency=0.0, quads=quads)


def build_fins_part(
    poly: Sequence[Tuple[float, float]],
    depth: float = 0.6,
    spacing: float = 1.5,
    floors: int = 4,
    fh: float = 4.0,
) -> MeshPart:
    quads: List[Quad3] = []
    n = len(poly)
    for f in range(floors):
        z_w0 = f * fh + 1.2
        z_w1 = z_w0 + 1.6
        for i in range(n):
            a = poly[i]
            b = poly[(i + 1) % n]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            tx, ty = dx / ln, dy / ln
            nx_out, ny_out = dy / ln, -dx / ln
            n_bays = int(round(ln / spacing))
            for k in range(n_bays + 1):
                s_pos = min(ln, k * spacing)
                p_in = (a[0] + tx * s_pos, a[1] + ty * s_pos)
                p_out = (p_in[0] + nx_out * depth, p_in[1] + ny_out * depth)
                quads.append(make_vertical_quad(p_in, p_out, z_w0, z_w1))
    return MeshPart("Peneduh Sirip", "Peneduh Sirip", (0.62, 0.44, 0.25), transparency=0.0, quads=quads)


# ============================================================================
# 8. PENULISAN SATU KASUS + EXPECTED.JSON
# ============================================================================

def save_expected(
    case_dir: str,
    case_id: str,
    formats: List[str],
    expected: Dict[str, Any],
    derivation: str,
    config_overrides: Optional[Dict[str, Any]] = None,
    per_format_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
) -> None:
    payload: Dict[str, Any] = {
        "case": case_id,
        "formats": formats,
        "config_overrides": config_overrides or {},
        "expected": expected,
        "tolerance": {"area_rel": 0.005, "ottv_abs": 0.1},
        "derivation": derivation,
    }
    if per_format_overrides:
        payload["per_format_overrides"] = per_format_overrides
    with open(os.path.join(case_dir, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def export_standard_formats(
    case_dir: str,
    formats: List[str],
    parts: List[MeshPart],
    ifc_kwargs: Optional[Dict[str, Any]] = None,
    unit_3dm: Any = rhino3dm.UnitSystem.Meters,
    obj_yup: bool = False,
    omit_materials: bool = False,
    glb_convert_yup: bool = True,
) -> None:
    if "3dm" in formats:
        write_3dm(os.path.join(case_dir, "model.3dm"), parts, unit_system=unit_3dm, omit_materials=omit_materials)
    if "obj" in formats:
        write_obj_and_mtl(
            os.path.join(case_dir, "model.obj"),
            parts,
            y_up=obj_yup,
            with_mtl=not omit_materials,
        )
    if "glb" in formats:
        write_glb(
            os.path.join(case_dir, "model.glb"),
            parts,
            convert_yup=glb_convert_yup,
            omit_materials=omit_materials,
        )
    if "ifc" in formats and ifc_kwargs is not None:
        write_ifc4_ribbon_building(os.path.join(case_dir, "model.ifc"), **ifc_kwargs)


# ============================================================================
# 9. GENERATE ALL 21 CASES
# ============================================================================

def generate_all() -> None:
    os.makedirs(OUT_ROOT, exist_ok=True)
    # Bersihkan folder kasus lama bila ada
    for name in os.listdir(OUT_ROOT):
        p = os.path.join(OUT_ROOT, name)
        if os.path.isdir(p):
            shutil.rmtree(p)

    # Catatan M10: file .obj tidak memiliki header satuan sehingga selalu memicu
    # UNIT_NEEDS_CONFIRMATION + is_provisional=True pada unit_mode='auto'.
    obj_unit_warn = {"is_provisional": True, "flags_expected": ["UNIT_NEEDS_CONFIRMATION"]}

    # ------------------------------------------------------------------
    # Kasus 1: 01_kotak_m
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "01_kotak_m")
    os.makedirs(cdir, exist_ok=True)
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        std_box_parts(),
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY]},
    )
    exp, drv = compute_analytical_expected(std_box_areas())
    save_expected(cdir, "01_kotak_m", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 2: 02_kotak_mm (koordinat x1000; header mm pada 3dm & IFC; OBJ/GLB unit_needs_confirmation)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "02_kotak_mm")
    os.makedirs(cdir, exist_ok=True)
    parts_mm = transform_parts(std_box_parts(), scale_pt(1000.0))
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_mm,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "unit_mm": True},
        unit_3dm=rhino3dm.UnitSystem.Millimeters,
    )
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="Koordinat dalam mm; 3dm & IFC memiliki header satuan mm, OBJ & GLB memicu UNIT_NEEDS_CONFIRMATION.",
    )
    save_expected(
        cdir,
        "02_kotak_mm",
        ["3dm", "obj", "glb", "ifc"],
        exp,
        drv,
        per_format_overrides={"obj": obj_unit_warn, "glb": obj_unit_warn},
    )

    # ------------------------------------------------------------------
    # Kasus 3: 03_kotak_yup (obj, glb dengan sumbu Y ke atas)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "03_kotak_yup")
    os.makedirs(cdir, exist_ok=True)
    export_standard_formats(
        cdir,
        ["obj", "glb"],
        std_box_parts(),
        obj_yup=True,
        glb_convert_yup=True,
    )
    exp, drv = compute_analytical_expected(std_box_areas(), extra_notes="Sumbu Y-Up dikonversi ke Z-Up.")
    save_expected(cdir, "03_kotak_yup", ["obj", "glb"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 4: 04_kotak_putar30 (diputar 30 deg CW di denah -> TL/TGR/BD/BL)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "04_kotak_putar30")
    os.makedirs(cdir, exist_ok=True)
    parts_rot30 = transform_parts(std_box_parts(), rotate_cw_xy(30.0))
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_rot30,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "rotate_cw_deg": 30.0},
    )
    areas_rot30 = {
        "TL": {"glazing": 128.0, "wall": 192.0},
        "TGR": {"glazing": 192.0, "wall": 288.0},
        "BD": {"glazing": 128.0, "wall": 192.0},
        "BL": {"glazing": 192.0, "wall": 288.0},
    }
    exp, drv = compute_analytical_expected(
        areas_rot30,
        uf_by_orient=std_box_uf_by_orient(codes_20=("TL", "BD"), codes_30=("TGR", "BL")),
        extra_notes="Bangunan diputar 30 deg CW: U->TL(30), T->TGR(120), S->BD(210), B->BL(300). "
        "Ekuivalen dengan Kasus 1 + north_angle_deg=330 (Utara sejati diputar 30 deg CCW).",
    )
    save_expected(cdir, "04_kotak_putar30", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 5: 05_denah_L (30x30 dikurangi kuadran NE 15x15)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "05_denah_L")
    os.makedirs(cdir, exist_ok=True)
    poly_L = [(0.0, 0.0), (30.0, 0.0), (30.0, 15.0), (15.0, 15.0), (15.0, 30.0), (0.0, 30.0)]
    roof_L_polys = [
        [(0.0, 0.0), (30.0, 0.0), (30.0, 15.0), (0.0, 15.0)],
        [(0.0, 15.0), (15.0, 15.0), (15.0, 30.0), (0.0, 30.0)],
    ]
    roof_L_quads = [make_horizontal_quad(rp, 16.0, up=True) for rp in roof_L_polys]
    parts_L = build_ribbon_building_parts([poly_L], roof_L_quads)
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_L,
        ifc_kwargs={"polygons": [poly_L], "roof_polys": roof_L_polys},
    )
    areas_L = {
        "U": {"glazing": 192.0, "wall": 288.0},
        "T": {"glazing": 192.0, "wall": 288.0},
        "S": {"glazing": 192.0, "wall": 288.0},
        "B": {"glazing": 192.0, "wall": 288.0},
    }
    uf_15 = analytical_three_zone_uf(15.0, 1.6)
    uf_30 = analytical_three_zone_uf(30.0, 1.6)
    exp, drv = compute_analytical_expected(
        areas_L,
        opaque_roof_area=675.0,
        uf_by_orient={"U": uf_15, "T": uf_15, "S": uf_30, "B": uf_30},
        extra_notes="Denah L 6 sisi, total selubung 1920 m2, atap 675 m2.",
    )
    save_expected(cdir, "05_denah_L", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 6: 06_courtyard (30x30 dengan void 10x10 terbuka ke langit)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "06_courtyard")
    os.makedirs(cdir, exist_ok=True)
    poly_outer = [(-15.0, -15.0), (15.0, -15.0), (15.0, 15.0), (-15.0, 15.0)]
    # Void CW agar normal menghadap ke dalam courtyard (ke langit terbuka)
    poly_void = [(-5.0, -5.0), (-5.0, 5.0), (5.0, 5.0), (5.0, -5.0)]
    roof_cy_polys = [
        [(-15.0, -15.0), (15.0, -15.0), (15.0, -5.0), (-15.0, -5.0)],
        [(-15.0, 5.0), (15.0, 5.0), (15.0, 15.0), (-15.0, 15.0)],
        [(-15.0, -5.0), (-5.0, -5.0), (-5.0, 5.0), (-15.0, 5.0)],
        [(5.0, -5.0), (15.0, -5.0), (15.0, 5.0), (5.0, 5.0)],
    ]
    roof_cy_quads = [make_horizontal_quad(rp, 16.0, up=True) for rp in roof_cy_polys]
    parts_cy = build_ribbon_building_parts([poly_outer, poly_void], roof_cy_quads)
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_cy,
        ifc_kwargs={"polygons": [poly_outer, poly_void], "roof_polys": roof_cy_polys},
    )
    areas_cy = {
        "U": {"glazing": 256.0, "wall": 384.0},
        "T": {"glazing": 256.0, "wall": 384.0},
        "S": {"glazing": 256.0, "wall": 384.0},
        "B": {"glazing": 256.0, "wall": 384.0},
    }
    uf_cy = 0.75 * analytical_three_zone_uf(30.0, 1.6) + 0.25 * analytical_three_zone_uf(10.0, 1.6)
    exp, drv = compute_analytical_expected(
        areas_cy,
        opaque_roof_area=800.0,
        uf_by_orient={c: uf_cy for c in ("U", "T", "S", "B")},
        extra_notes="Luar 30x30 (480 m2/sisi) + courtyard 10x10 (160 m2/sisi) = 640 m2/arah, total 2560 m2.",
    )
    save_expected(cdir, "06_courtyard", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 7: 07_silinder (r=10m, 36 segmen, 16m, jendela pita)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "07_silinder")
    os.makedirs(cdir, exist_ok=True)
    R_cyl = 10.0
    N_seg = 36
    # CCW circle: theta(k) dari +X berlawanan jarum jam; untuk memastikan azimut normal = 5, 15, ..., 355
    # Azimut 0 = +Y = (0, R); berjalan CW dari +Y => untuk poligon CCW berjalan CCW dari +Y:
    # sudut azimuth titik k: az_k = -k * 10 deg -> (R sin(az), R cos(az))
    poly_cyl = [
        (R_cyl * math.sin(math.radians(-k * 10.0)), R_cyl * math.cos(math.radians(-k * 10.0)))
        for k in range(N_seg)
    ]
    roof_cyl_tris: List[Tuple[Point3, Point3, Point3]] = []
    center_top: Point3 = (0.0, 0.0, 16.0)
    for k in range(N_seg):
        p0 = poly_cyl[k]
        p1 = poly_cyl[(k + 1) % N_seg]
        roof_cyl_tris.append((center_top, (p0[0], p0[1], 16.0), (p1[0], p1[1], 16.0)))
    parts_cyl = build_ribbon_building_parts([poly_cyl], [], roof_tris=roof_cyl_tris)
    export_standard_formats(cdir, ["3dm", "obj", "glb"], parts_cyl)

    # Hitung analitis 36 segmen dikelompokkan ke 8 arah
    areas_cyl: Dict[str, Dict[str, float]] = {c: {"glazing": 0.0, "wall": 0.0} for c in ORIENTATION_ORDER}
    w_seg = 2.0 * R_cyl * math.sin(math.radians(5.0))
    for k in range(N_seg):
        a = poly_cyl[k]
        b = poly_cyl[(k + 1) % N_seg]
        dx, dy = b[0] - a[0], b[1] - a[1]
        nx_out, ny_out = dy, -dx
        az = math.degrees(math.atan2(nx_out, ny_out)) % 360.0
        oc = analytical_orient_from_azimuth(az)
        areas_cyl[oc]["glazing"] += w_seg * (4 * 1.6)
        areas_cyl[oc]["wall"] += w_seg * (4 * 2.4)
    roof_cyl_area = 0.5 * N_seg * (R_cyl ** 2) * math.sin(math.radians(10.0))
    # Silinder menerus 36 segmen = 1 pita kaca melingkar keliling 36*w_seg tanpa kusen vertikal di antaranya
    uf_cyl = analytical_three_zone_uf(N_seg * w_seg, 1.6)
    exp, drv = compute_analytical_expected(
        areas_cyl,
        opaque_roof_area=roof_cyl_area,
        uf_by_orient={c: uf_cyl for c in ORIENTATION_ORDER},
        extra_notes=f"Silinder r=10m, 36 segmen (lebar chord={w_seg:.6f}m); 4 segmen untuk U/T/S/B, 5 segmen untuk TL/TGR/BD/BL.",
    )
    save_expected(cdir, "07_silinder", ["3dm", "obj", "glb"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 8: 08_overhang (Kasus 1 + overhang horizontal 1.0 m di atas setiap jendela)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "08_overhang")
    os.makedirs(cdir, exist_ok=True)
    parts_ov = std_box_parts() + [build_overhang_part(STD_BOX_POLY, depth=1.0)]
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_ov,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "overhang_depth": 1.0},
    )
    r1_ov = 1.0 / 1.6  # 0.625 -> bin template 0.6
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        r1=r1_ov,
        r2=0.0,
        tilt_deg=0.0,
        extra_notes="Overhang 1.0 m di atas jendela tinggi 1.6 m -> R1=0.625 (SCeff diinterpolasi).",
    )
    save_expected(cdir, "08_overhang", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 9: 09_sirip (Kasus 1 + sirip vertikal kedalaman 0.6 m, jarak 1.5 m)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "09_sirip")
    os.makedirs(cdir, exist_ok=True)
    parts_fin = std_box_parts() + [build_fins_part(STD_BOX_POLY, depth=0.6, spacing=1.5)]
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_fin,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "fin_depth": 0.6, "fin_spacing": 1.5},
    )
    r2_fin = 0.6 / 1.5  # 0.4
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        r1=0.0,
        r2=r2_fin,
        tilt_deg=0.0,
        extra_notes="Sirip vertikal kedalaman 0.6 m, jarak 1.5 m -> R2=0.4.",
    )
    save_expected(cdir, "09_sirip", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 10: 10_double_skin (kotak opak + kulit kaca penuh 0.8 m di luar)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "10_double_skin")
    os.makedirs(cdir, exist_ok=True)
    inner_opaque = build_ribbon_building_parts([STD_BOX_POLY], std_box_roof(), include_glazing=False)
    outer_skin_poly = [(-10.8, -15.8), (10.8, -15.8), (10.8, 15.8), (-10.8, 15.8)]
    outer_glz_quads = []
    for f in range(4):
        z0, z1 = f * 4.0, (f + 1) * 4.0
        for i in range(4):
            outer_glz_quads.append(make_vertical_quad(outer_skin_poly[i], outer_skin_poly[(i + 1) % 4], z0, z1))
    outer_glass = MeshPart("Kaca Jendela", "Kaca Jendela", (0.48, 0.76, 0.92), transparency=0.7, quads=outer_glz_quads)
    export_standard_formats(cdir, ["3dm", "obj", "glb"], inner_opaque + [outer_glass])

    areas_ds = {
        "U": {"glazing": 21.6 * 16.0, "wall": 0.0},
        "T": {"glazing": 31.6 * 16.0, "wall": 0.0},
        "S": {"glazing": 21.6 * 16.0, "wall": 0.0},
        "B": {"glazing": 31.6 * 16.0, "wall": 0.0},
    }
    uf_ds_us = analytical_three_zone_uf(21.6, 16.0)
    uf_ds_tb = analytical_three_zone_uf(31.6, 16.0)
    exp, drv = compute_analytical_expected(
        areas_ds,
        opaque_roof_area=600.0,
        uf_by_orient={"U": uf_ds_us, "S": uf_ds_us, "T": uf_ds_tb, "B": uf_ds_tb},
        extra_notes="Double-skin: kulit kaca luar 21.6x31.6x16 m (1702.4 m2, WWR=100%); dinding dalam 20x30x16 tertutup sehingga tidak dihitung.",
    )
    save_expected(cdir, "10_double_skin", ["3dm", "obj", "glb"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 11: 11_blok_bersarang (3dm)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "11_blok_bersarang")
    os.makedirs(cdir, exist_ok=True)
    write_case11_nested_blocks_3dm(os.path.join(cdir, "model.3dm"))
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="Blok bersarang Panel_Jendela dalam Lantai (definisi di 1000,1000,0), diinstans 4x -> hasil = Kasus 1.",
    )
    save_expected(cdir, "11_blok_bersarang", ["3dm"], exp, drv)

    # ------------------------------------------------------------------
    # Kasus 12: 12_brep_tanpa_mesh (3dm)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "12_brep_tanpa_mesh")
    os.makedirs(cdir, exist_ok=True)
    write_case12_brep_no_mesh_3dm(os.path.join(cdir, "model.3dm"))
    areas_glz_only = {
        "U": {"glazing": 128.0, "wall": 0.0},
        "T": {"glazing": 192.0, "wall": 0.0},
        "S": {"glazing": 128.0, "wall": 0.0},
        "B": {"glazing": 192.0, "wall": 0.0},
    }
    exp, drv = compute_analytical_expected(
        areas_glz_only,
        opaque_roof_area=600.0,
        is_provisional=True,
        flags_expected=["MISSING_MESH"],
        extra_notes="Dinding berupa Brep tanpa render mesh (missing_mesh > 0, tidak dihitung); hanya kaca 640 m2 yang terhitung.",
    )
    save_expected(cdir, "12_brep_tanpa_mesh", ["3dm"], exp, drv)

    # ------------------------------------------------------------------
    # Kasus 13: 13_konteks (Kasus 1 + 5 Pohon + Tanah 100x100 di z=-0.5 + Bangunan Tetangga di Barat)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "13_konteks")
    os.makedirs(cdir, exist_ok=True)
    pohon_quads: List[Quad3] = []
    for tx, ty in ((18.0, -10.0), (18.0, 0.0), (18.0, 10.0), (0.0, 22.0), (0.0, -22.0)):
        pohon_quads.extend(make_box_quads(tx - 1.0, tx + 1.0, ty - 1.0, ty + 1.0, 0.0, 6.0))
    pohon_part = MeshPart("Pohon", "Pohon", (0.20, 0.55, 0.22), transparency=0.0, quads=pohon_quads)
    tanah_part = MeshPart(
        "Tanah",
        "Tanah",
        (0.45, 0.40, 0.32),
        transparency=0.0,
        quads=[make_horizontal_quad([(-50.0, -50.0), (50.0, -50.0), (50.0, 50.0), (-50.0, 50.0)], -0.5, up=True)],
    )
    tetangga_part = MeshPart(
        "Bangunan Tetangga",
        "Bangunan Tetangga",
        (0.65, 0.65, 0.68),
        transparency=0.0,
        quads=make_box_quads(-50.0, -30.0, -10.0, 10.0, 0.0, 30.0),
    )
    export_standard_formats(cdir, ["3dm", "obj", "glb"], std_box_parts() + [pohon_part, tanah_part, tetangga_part])
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        is_provisional=False,
        flags_expected=[],
        extra_notes="Z0=0 (dari alas bangunan, bukan Tanah z=-0.5); Pohon & Bangunan Tetangga -> context, Tanah -> ignore; OTTV = Kasus 1.",
    )
    save_expected(
        cdir,
        "13_konteks",
        ["3dm", "obj", "glb"],
        exp,
        drv,
        per_format_overrides={
            "obj": {"is_provisional": True, "flags_expected": ["UNIT_NEEDS_CONFIRMATION"]},
        },
    )

    # ------------------------------------------------------------------
    # Kasus 14: 14_ifc_interior (IFC4 IsExternal=True + 3 partisi IsExternal=False)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "14_ifc_interior")
    os.makedirs(cdir, exist_ok=True)
    write_ifc4_ribbon_building(
        os.path.join(cdir, "model.ifc"),
        polygons=[STD_BOX_POLY],
        roof_polys=[STD_BOX_POLY],
        explicit_is_external=True,
        interior_walls=[
            ((0.0, -14.0), (0.0, 14.0)),
            ((-9.0, -5.0), (9.0, -5.0)),
            ((-9.0, 5.0), (9.0, 5.0)),
        ],
    )
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="3 partisi interior (IsExternal=False) disaring ke peran ignore; hasil = Kasus 1.",
    )
    save_expected(cdir, "14_ifc_interior", ["ifc"], exp, drv)

    # ------------------------------------------------------------------
    # Kasus 15: 15_dinding_tebal (dinding solid tebal 0.2 m, dimensi luar = kotak standar)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "15_dinding_tebal")
    os.makedirs(cdir, exist_ok=True)
    parts_thick = std_box_parts(wall_thickness=0.20)
    export_standard_formats(
        cdir,
        ["obj", "glb", "ifc"],
        parts_thick,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "wall_thickness": 0.20},
    )
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="Dinding solid tebal 0.20 m; hanya sisi luar yang dihitung (sisi dalam & tutup horizontal disaring).",
    )
    save_expected(cdir, "15_dinding_tebal", ["obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 16: 16_skylight (Kasus 1 + skylight datar 4x4 m di atap)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "16_skylight")
    os.makedirs(cdir, exist_ok=True)
    roof_sky_polys = [
        [(-10.0, -15.0), (10.0, -15.0), (10.0, -2.0), (-10.0, -2.0)],
        [(-10.0, 2.0), (10.0, 2.0), (10.0, 15.0), (-10.0, 15.0)],
        [(-10.0, -2.0), (-2.0, -2.0), (-2.0, 2.0), (-10.0, 2.0)],
        [(2.0, -2.0), (10.0, -2.0), (10.0, 2.0), (2.0, 2.0)],
    ]
    skylight_poly = [(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]
    roof_sky_quads = [make_horizontal_quad(rp, 16.0, up=True) for rp in roof_sky_polys]
    parts_sky = build_ribbon_building_parts([STD_BOX_POLY], roof_sky_quads)
    parts_sky.append(
        MeshPart(
            "Kaca Skylight",
            "Kaca Skylight",
            (0.48, 0.76, 0.92),
            transparency=0.7,
            quads=[make_horizontal_quad(skylight_poly, 16.0, up=True)],
        )
    )
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_sky,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": roof_sky_polys, "skylight_poly": skylight_poly},
    )
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        opaque_roof_area=584.0,
        skylight_area=16.0,
        extra_notes="Skylight datar 4x4 m = 16 m2 di atap (atap opak 584 m2); RTTV berlaku, OTTV = Kasus 1.",
    )
    save_expected(cdir, "16_skylight", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 17: 17_kaca_tebal (kaca sebagai kotak tebal 20 mm)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "17_kaca_tebal")
    os.makedirs(cdir, exist_ok=True)
    parts_tglz = std_box_parts(glazing_thickness=0.02)
    export_standard_formats(cdir, ["3dm", "obj", "glb"], parts_tglz)
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        opaque_roof_area=600.0,
        skylight_area=0.0,
        extra_notes="Kaca solid tebal 20 mm: sisi tebal atas disaring (sisi_tebal_panel, bukan skylight), tepi vertikal disaring (sliver), hasil = Kasus 1.",
    )
    save_expected(cdir, "17_kaca_tebal", ["3dm", "obj", "glb"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 18: 18_utm (Kasus 1 digeser ke (500000, 9300000, 25))
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "18_utm")
    os.makedirs(cdir, exist_ok=True)
    utm_shift = (500000.0, 9300000.0, 25.0)
    parts_utm = transform_parts(std_box_parts(), translate_pt(*utm_shift))
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_utm,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "shift_xyz": utm_shift},
    )
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="Model digeser ke koordinat UTM (500000, 9300000, 25) lalu dipusatkan ulang otomatis; hasil = Kasus 1.",
    )
    save_expected(cdir, "18_utm", ["3dm", "obj", "glb", "ifc"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 19: 19_tanpa_nama (semua grup bernama Layer 0 / Default, tanpa material)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "19_tanpa_nama")
    os.makedirs(cdir, exist_ok=True)
    parts_unnamed = build_ribbon_building_parts(
        [STD_BOX_POLY],
        std_box_roof(),
        wall_name="Layer 0",
        glz_name="Default",
        roof_name="Layer 0",
    )
    for pu in parts_unnamed:
        pu.transparency = 0.0
        pu.material_name = "Default"
    export_standard_formats(cdir, ["3dm", "obj", "glb"], parts_unnamed, omit_materials=True)
    exp, drv = compute_analytical_expected(
        {},
        opaque_roof_area=0.0,
        is_provisional=True,
        flags_expected=["UNKNOWN_GROUPS"],
        error_expected=True,
        extra_notes="Semua grup bernama Layer 0/Default tanpa material -> seluruhnya unknown -> analisis ditolak (ValueError).",
    )
    save_expected(cdir, "19_tanpa_nama", ["3dm", "obj", "glb"], exp, drv)

    # ------------------------------------------------------------------
    # Kasus 20: 20_mesh_multimaterial (glb: 1 node berisi primitif kaca BLEND + primitif rangka opak)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "20_mesh_multimaterial")
    os.makedirs(cdir, exist_ok=True)
    base_parts = std_box_parts()
    wall_p = next(p for p in base_parts if p.name == "Dinding Bata")
    glz_p = next(p for p in base_parts if p.name == "Kaca Jendela")
    roof_p = next(p for p in base_parts if p.name == "Atap Beton")
    # Buat primitif rangka mullion opak pada node yang sama dengan primitif kaca BLEND
    mullion_quads: List[Quad3] = []
    for f in range(4):
        za, zb = f * 4.0 + 1.2, f * 4.0 + 2.8
        for x_m in (-10.0, -5.0, 0.0, 5.0, 9.92):
            mullion_quads.append(make_vertical_quad((x_m, -15.02), (x_m + 0.08, -15.02), za, zb))
            mullion_quads.append(make_vertical_quad((x_m + 0.08, 15.02), (x_m, 15.02), za, zb))
    frame_p = MeshPart("Rangka Aluminium", "Rangka Aluminium", (0.35, 0.37, 0.40), transparency=0.0, quads=mullion_quads)
    write_glb(
        os.path.join(cdir, "model.glb"),
        parts=[wall_p, roof_p],
        convert_yup=True,
        merged_single_node_parts=[glz_p, frame_p],
        merged_node_name="Fasad_CurtainWall",
    )
    uf_20_us = analytical_three_zone_uf(20.0, 1.6, fw_m=0.08, measured_ov_frame_m2=5.0 * 0.08 * 1.6)
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        uf_by_orient={"U": uf_20_us, "S": uf_20_us, "T": U_GLZ, "B": U_GLZ},
        extra_notes="Satu node GLB berisi primitif kaca (BLEND) + primitif rangka opak -> dipecah per material, luas kaca = Kasus 1; mullion 80 mm terukur pada U/S.",
    )
    save_expected(cdir, "20_mesh_multimaterial", ["glb"], exp, drv)

    # ------------------------------------------------------------------
    # Kasus 21: 21_ifc_cw_opak (IFC4 curtain wall plate kaca + plate opak bercat + versi OBJ)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "21_ifc_cw_opak")
    os.makedirs(cdir, exist_ok=True)
    write_case21_ifc_cw_opak(
        os.path.join(cdir, "model.ifc"),
        os.path.join(cdir, "model.obj"),
    )
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="IFC4 IfcCurtainWall: plate kaca transparan + plate opak 'Paint - Orange' (spandrel), dibandingkan dengan .obj -> WWR & OTTV identik.",
    )
    save_expected(cdir, "21_ifc_cw_opak", ["ifc", "obj"], exp, drv, per_format_overrides={"obj": obj_unit_warn})

    # ------------------------------------------------------------------
    # Kasus 22: 22_ifc_covering_dan_id (regresi B6/B7 dari korpus Tingkat B:
    #           IfcCovering CEILING/FLOORING -> ignore; sufiks ID instans ArchiCAD/Revit digabung)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "22_ifc_covering_dan_id")
    os.makedirs(cdir, exist_ok=True)
    write_case22_ifc_covering_and_instance_ids(os.path.join(cdir, "model.ifc"))
    exp, drv = compute_analytical_expected(
        std_box_areas(),
        extra_notes="Regresi Tingkat B (B6/B7): IfcCovering CEILING/FLOORING -> ignore (0% unknown) & sufiks ID '_(#...)' digabung bersih -> hasil = Kasus 1.",
    )
    save_expected(cdir, "22_ifc_covering_dan_id", ["ifc"], exp, drv)

    # ------------------------------------------------------------------
    # Kasus 23: 23_tanpa_kaca (regresi K2: kotak dinding opak saja tanpa kaca -> WWR=0, NO_GLAZING)
    # ------------------------------------------------------------------
    cdir = os.path.join(OUT_ROOT, "23_tanpa_kaca")
    os.makedirs(cdir, exist_ok=True)
    parts_no_glz = std_box_parts(include_glazing=False)
    export_standard_formats(
        cdir,
        ["3dm", "obj", "glb", "ifc"],
        parts_no_glz,
        ifc_kwargs={"polygons": [STD_BOX_POLY], "roof_polys": [STD_BOX_POLY], "include_glazing": False},
    )
    areas_no_glz = {
        "U": {"glazing": 0.0, "wall": 320.0},
        "T": {"glazing": 0.0, "wall": 480.0},
        "S": {"glazing": 0.0, "wall": 320.0},
        "B": {"glazing": 0.0, "wall": 480.0},
    }
    exp, drv = compute_analytical_expected(
        areas_no_glz,
        opaque_roof_area=600.0,
        is_provisional=True,
        flags_expected=["NO_GLAZING"],
        extra_notes="Regresi K2: model hanya memiliki dinding opak (tanpa grup kaca) -> WWR=0%, OTTV=3.72 W/m2, is_provisional=True, peringatan NO_GLAZING (tidak lagi memakai default_wall_wwr=0.35 diam-diam).",
    )
    save_expected(
        cdir,
        "23_tanpa_kaca",
        ["3dm", "obj", "glb", "ifc"],
        exp,
        drv,
        per_format_overrides={
            "obj": {"is_provisional": True, "flags_expected": ["NO_GLAZING", "UNIT_NEEDS_CONFIRMATION"]},
        },
    )

    print(f"Berhasil membuat 23 kasus sintetis di {OUT_ROOT}")
    cases = sorted(os.listdir(OUT_ROOT))
    print(f"Total folder: {len(cases)}")
    for c in cases:
        files = sorted(os.listdir(os.path.join(OUT_ROOT, c)))
        with open(os.path.join(OUT_ROOT, c, "expected.json"), "r", encoding="utf-8") as f:
            ed = json.load(f)
        print(
            f"  {c:24s} | formats={','.join(ed['formats']):16s} | "
            f"A={ed['expected']['total_envelope_area_m2']:7.2f} m2 | "
            f"WWR={ed['expected']['wwr_total']*100:5.1f}% | "
            f"OTTV={ed['expected']['ottv_total_wm2']:6.2f} W/m2 | files={len(files)}"
        )


if __name__ == "__main__":
    generate_all()
