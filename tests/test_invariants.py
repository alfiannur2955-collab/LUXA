"""
Uji Invarian Engine (Audit Langkah 2)
====================================
Bukan mengecek satu angka, tapi aturan yang HARUS selalu benar apa pun bentuk/cara ekspor model:

  - memutar model + memutar arah utara yang sama      -> OTTV sama
  - mengganti satuan (m -> mm, cm) / memindah jauh dari origin -> OTTV sama
  - memecah quad jadi segitiga / satu mesh jadi banyak objek -> OTTV sama
  - membalik arah normal face                          -> OTTV sama
  - mengganti nama layer dengan variasi wajar          -> OTTV sama
  - menambah peneduh                                    -> OTTV tidak naik
  - menambah rangka/mullion                             -> luas kaca tidak bertambah

Model dibangun dengan `tools/make_synthetic.py` ke folder sementara pytest.
"""

from __future__ import annotations

import math
import os
import sys
from typing import Callable, Dict, List, Tuple

import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for sub in ("backend", "tools"):
    p = os.path.join(ROOT_DIR, sub)
    if p not in sys.path:
        sys.path.insert(0, p)

rhino3dm = pytest.importorskip("rhino3dm")

import make_synthetic as ms  # noqa: E402
from ottv_engine import EnvelopeParameters, analyze_building_ottv  # noqa: E402

OTTV_TOL = 0.05      # W/m²
AREA_RTOL = 0.005    # 0,5 %

# Denah L (6 arah fasad berbeda) agar lebih dari empat orientasi ikut teruji.
L_POLY: List[Tuple[float, float]] = [(-12.0, -10.0), (12.0, -10.0), (12.0, 2.0), (2.0, 2.0), (2.0, 14.0), (-12.0, 14.0)]
FLOORS, FH = 4, 4.0


def _roof() -> List[ms.Quad3]:
    # Dua persegi panjang yang menutup denah L
    return [
        ms.make_horizontal_quad([(-12.0, -10.0), (12.0, -10.0), (12.0, 2.0), (-12.0, 2.0)], FLOORS * FH, up=True),
        ms.make_horizontal_quad([(-12.0, 2.0), (2.0, 2.0), (2.0, 14.0), (-12.0, 14.0)], FLOORS * FH, up=True),
    ]


def base_parts(wall="Dinding Bata", glz="Kaca Jendela", roof="Atap Beton") -> List[ms.MeshPart]:
    return ms.build_ribbon_building_parts([L_POLY], _roof(), floors=FLOORS, fh=FH, wall_name=wall, glz_name=glz, roof_name=roof)


def mullion_part(name: str = "Rangka Mullion", spacing: float = 1.5, depth: float = 0.15, width: float = 0.06) -> ms.MeshPart:
    """Mullion berupa kotak tipis menempel di luar pita kaca (sisi sampingnya tegak lurus fasad)."""
    quads: List[ms.Quad3] = []
    n = len(L_POLY)
    for f in range(FLOORS):
        z0 = f * FH + 1.2
        z1 = z0 + 1.6
        for i in range(n):
            a, b = L_POLY[i], L_POLY[(i + 1) % n]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            tx, ty = dx / ln, dy / ln
            nx, ny = dy / ln, -dx / ln  # normal luar (poligon CCW)
            k = 1
            while k * spacing < ln - 0.3:
                s = k * spacing
                cx, cy = a[0] + tx * s, a[1] + ty * s
                p0 = (cx - tx * width / 2, cy - ty * width / 2)
                p1 = (cx + tx * width / 2, cy + ty * width / 2)
                o0 = (p0[0] + nx * depth, p0[1] + ny * depth)
                o1 = (p1[0] + nx * depth, p1[1] + ny * depth)
                quads.append(ms.make_vertical_quad(p0, o0, z0, z1))   # sisi samping kiri
                quads.append(ms.make_vertical_quad(o0, o1, z0, z1))   # muka depan
                quads.append(ms.make_vertical_quad(o1, p1, z0, z1))   # sisi samping kanan
                k += 1
    return ms.MeshPart(name, name, (0.4, 0.4, 0.42), transparency=0.0, quads=quads)


def fins_part(name: str = "Peneduh Sirip", depth: float = 0.8) -> ms.MeshPart:
    p = ms.build_fins_part(L_POLY, depth=depth, spacing=1.5, floors=FLOORS, fh=FH)
    p.name = p.material_name = name
    return p


def run(tmp_path, parts: List[ms.MeshPart], name: str, unit=None, north: float = 0.0) -> Dict:
    path = str(tmp_path / f"{name}.3dm")
    ms.write_3dm(path, parts, unit_system=unit or rhino3dm.UnitSystem.Meters)
    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.city_preset = "jakarta"
    prm.north_angle_deg = north
    r = analyze_building_ottv(path, os.path.basename(path), prm)
    assert r.get("ottv_total_wm2") is not None, r.get("ottv_error") or r.get("warnings")
    return r


def glz_area(r: Dict) -> float:
    return float(r["summary"]["total_glazing_area_m2"])


def env_area(r: Dict) -> float:
    return float(r["summary"]["total_envelope_area_m2"])


def assert_same(a: Dict, b: Dict, label: str) -> None:
    da = abs(a["ottv_total_wm2"] - b["ottv_total_wm2"])
    assert da <= OTTV_TOL, f"{label}: OTTV {a['ottv_total_wm2']} vs {b['ottv_total_wm2']}"
    for f, nm in ((glz_area, "luas kaca"), (env_area, "luas selubung")):
        va, vb = f(a), f(b)
        assert math.isclose(va, vb, rel_tol=AREA_RTOL, abs_tol=0.05), f"{label}: {nm} {va} vs {vb}"


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    return run(tmp_path_factory.mktemp("inv_base"), base_parts(), "base")


# ----------------------------------------------------------------------------
# Transformasi geometri
# ----------------------------------------------------------------------------

@pytest.mark.parametrize("deg", [90.0, 37.0, 180.0, 300.0])
def test_rotasi_model_dan_utara(tmp_path, base, deg):
    parts = ms.transform_parts(base_parts(), ms.rotate_cw_xy(deg))
    assert_same(base, run(tmp_path, parts, f"rot{int(deg)}", north=deg), f"rotasi {deg}°")


@pytest.mark.parametrize("factor,unit", [(1000.0, "Millimeters"), (100.0, "Centimeters")])
def test_satuan(tmp_path, base, factor, unit):
    parts = ms.transform_parts(base_parts(), ms.scale_pt(factor))
    assert_same(base, run(tmp_path, parts, f"unit_{unit}", unit=getattr(rhino3dm.UnitSystem, unit)), f"satuan {unit}")


def test_jauh_dari_origin(tmp_path, base):
    parts = ms.transform_parts(base_parts(), ms.translate_pt(431250.0, 9_212_400.0, 0.0))
    assert_same(base, run(tmp_path, parts, "utm"), "koordinat UTM")


def test_elevasi_tidak_nol(tmp_path, base):
    parts = ms.transform_parts(base_parts(), ms.translate_pt(0.0, 0.0, 25.0))
    assert_same(base, run(tmp_path, parts, "z25"), "model melayang z=+25 m")


# ----------------------------------------------------------------------------
# Cara mesh disimpan
# ----------------------------------------------------------------------------

def _triangulate(parts: List[ms.MeshPart]) -> List[ms.MeshPart]:
    out = []
    for p in parts:
        tris = list(p.tris)
        for q in p.quads:
            tris += [(q[0], q[1], q[2]), (q[0], q[2], q[3])]
        out.append(ms.MeshPart(p.name, p.material_name, p.color_rgb, p.transparency, quads=[], tris=tris))
    return out


def _flip(parts: List[ms.MeshPart]) -> List[ms.MeshPart]:
    return [
        ms.MeshPart(p.name, p.material_name, p.color_rgb, p.transparency,
                    quads=[tuple(reversed(q)) for q in p.quads], tris=[tuple(reversed(t)) for t in p.tris])
        for p in parts
    ]


def _explode(parts: List[ms.MeshPart]) -> List[ms.MeshPart]:
    out = []
    for p in parts:
        for q in p.quads:
            out.append(ms.MeshPart(p.name, p.material_name, p.color_rgb, p.transparency, quads=[q]))
        for t in p.tris:
            out.append(ms.MeshPart(p.name, p.material_name, p.color_rgb, p.transparency, tris=[t]))
    return out


def test_triangulasi(tmp_path, base):
    assert_same(base, run(tmp_path, _triangulate(base_parts()), "tri"), "quad -> segitiga")


def test_normal_terbalik(tmp_path, base):
    assert_same(base, run(tmp_path, _flip(base_parts()), "flip"), "normal dibalik")


def test_satu_objek_per_face(tmp_path, base):
    assert_same(base, run(tmp_path, _explode(base_parts()), "explode"), "dipecah per face")


# ----------------------------------------------------------------------------
# Penamaan layer
# ----------------------------------------------------------------------------

@pytest.mark.parametrize("wall,glz,roof", [
    ("Walls", "Glass", "Roof"),
    ("A-WALL-EXT", "A-GLAZ-CURT", "A-ROOF"),
    ("DINDING_LUAR", "KACA_01", "ATAP"),
    ("Exterior Walls", "Windows", "Roof Slab"),
    ("wall_concrete", "glazing_lowE", "roof_dak"),
    ("Dinding Hebel", "Jendela Kaca Bening", "Dak Beton"),
])
def test_variasi_nama_layer(tmp_path, base, wall, glz, roof):
    r = run(tmp_path, base_parts(wall=wall, glz=glz, roof=roof), f"nm_{wall}")
    assert_same(base, r, f"nama layer {wall}/{glz}/{roof}")


# ----------------------------------------------------------------------------
# Elemen tambahan
# ----------------------------------------------------------------------------

def test_peneduh_tidak_menaikkan_ottv(tmp_path, base):
    r = run(tmp_path, base_parts() + [fins_part()], "fins")
    assert r["ottv_total_wm2"] <= base["ottv_total_wm2"] + 1e-6
    assert math.isclose(glz_area(r), glz_area(base), rel_tol=AREA_RTOL), "sirip tidak boleh menambah luas kaca"


def test_peneduh_lebih_dalam_tidak_lebih_panas(tmp_path):
    a = run(tmp_path, base_parts() + [fins_part(depth=0.4)], "fins04")
    b = run(tmp_path, base_parts() + [fins_part(depth=1.2)], "fins12")
    assert b["ottv_total_wm2"] <= a["ottv_total_wm2"] + 1e-6


@pytest.mark.parametrize("name", ["Rangka Mullion", "CW_Vertical_Mullions", "Mullions", "Aluminium Profiles", "Frames"])
def test_mullion_bukan_kaca(tmp_path, base, name):
    r = run(tmp_path, base_parts() + [mullion_part(name)], f"mul_{name}")
    assert glz_area(r) <= glz_area(base) * (1 + AREA_RTOL), f"{name}: luas kaca {glz_area(r)} > {glz_area(base)}"
    assert env_area(r) <= env_area(base) * (1 + AREA_RTOL), f"{name}: luas selubung {env_area(r)} > {env_area(base)}"


# ----------------------------------------------------------------------------
# Kebiasaan modeling nyata ("model jahil")
# ----------------------------------------------------------------------------

@pytest.mark.xfail(strict=True, reason="AUDIT-02: face kembar tidak dideduplikasi & tanpa peringatan")
def test_geometri_dobel_tidak_dihitung_dua_kali(tmp_path, base):
    """Copy-paste tak sengaja (objek kembar di posisi sama) sangat umum di model mahasiswa."""
    parts = base_parts()
    r = run(tmp_path, parts + [ms.MeshPart(p.name, p.material_name, p.color_rgb, p.transparency, list(p.quads), list(p.tris)) for p in parts], "dobel")
    assert_same(base, r, "geometri dobel")


def _interior_walls(name: str) -> ms.MeshPart:
    quads = []
    for f in range(FLOORS):
        quads.append(ms.make_vertical_quad((-6.0, -10.0), (-6.0, 2.0), f * FH, (f + 1) * FH))
        quads.append(ms.make_vertical_quad((-12.0, 6.0), (2.0, 6.0), f * FH, (f + 1) * FH))
    return ms.MeshPart(name, name, (0.8, 0.8, 0.8), 0.0, quads=quads)


def _slabs(name: str) -> ms.MeshPart:
    quads = []
    for f in range(1, FLOORS):
        quads += [ms.make_horizontal_quad([(-12.0, -10.0), (12.0, -10.0), (12.0, 2.0), (-12.0, 2.0)], f * FH),
                  ms.make_horizontal_quad([(-12.0, 2.0), (2.0, 2.0), (2.0, 14.0), (-12.0, 14.0)], f * FH)]
    return ms.MeshPart(name, name, (0.7, 0.7, 0.7), 0.0, quads=quads)


@pytest.mark.parametrize("name", ["Dinding Bata", "Walls", "Layer 05"])
def test_dinding_interior_diabaikan(tmp_path, base, name):
    r = run(tmp_path, base_parts() + [_interior_walls(name)], f"int_{name}")
    assert_same(base, r, f"dinding interior bernama '{name}'")


@pytest.mark.parametrize("name", ["Pelat Lantai", "Floor Slab", "Slab"])
def test_pelat_lantai_bukan_atap_atau_selubung(tmp_path, base, name):
    r = run(tmp_path, base_parts() + [_slabs(name)], f"slab_{name}")
    assert_same(base, r, f"pelat lantai '{name}'")


def test_konteks_tidak_dihitung(tmp_path, base):
    ctx = ms.MeshPart("Gedung Sekitar", "Gedung Sekitar", (0.9, 0.9, 0.9), 0.0,
                      quads=ms.make_box_quads(30.0, 50.0, -10.0, 10.0, 0.0, 30.0))
    assert_same(base, run(tmp_path, base_parts() + [ctx], "ctx"), "bangunan konteks")


def test_kaca_menjorok_di_dinding_tebal(tmp_path):
    """Dinding tebal 25 cm: muka fasad sama, hanya kusen/reveal yang bertambah. Luas selubung
    (bidang fasad luar) tidak boleh membengkak oleh sisi tebal dinding."""
    thin = run(tmp_path, base_parts(), "tipis")
    thick_parts = ms.build_ribbon_building_parts([L_POLY], _roof(), floors=FLOORS, fh=FH, wall_thickness=0.25)
    thick = run(tmp_path, thick_parts, "tebal")
    assert math.isclose(env_area(thick), env_area(thin), rel_tol=0.03), f"selubung {env_area(thick)} vs {env_area(thin)}"
    assert math.isclose(glz_area(thick), glz_area(thin), rel_tol=AREA_RTOL)


def _twisted_parts(twist_total_deg: float = 60.0, floors: int = 10, n_side: int = 12) -> List[ms.MeshPart]:
    """Menara twisted sederhana: denah persegi 20x20 diputar bertahap per lantai, tiap sisi dibagi panel."""
    half = 10.0
    sq = [(-half, -half), (half, -half), (half, half), (-half, half)]
    wall, glz = [], []
    def rot(p, d):
        c, s = math.cos(math.radians(d)), math.sin(math.radians(d))
        return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)
    for f in range(floors):
        d0 = twist_total_deg * f / floors
        d1 = twist_total_deg * (f + 1) / floors
        z0, zs, z1 = f * FH, f * FH + 1.0, (f + 1) * FH
        for i in range(4):
            a, b = sq[i], sq[(i + 1) % 4]
            for k in range(n_side):
                t0, t1 = k / n_side, (k + 1) / n_side
                pa = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
                pb = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
                ts = (zs - z0) / (z1 - z0)
                ds = d0 + (d1 - d0) * ts
                A0, B0 = rot(pa, d0), rot(pb, d0)
                As, Bs = rot(pa, ds), rot(pb, ds)
                A1, B1 = rot(pa, d1), rot(pb, d1)
                wall.append(((*A0, z0), (*B0, z0), (*Bs, zs), (*As, zs)))
                glz.append(((*As, zs), (*Bs, zs), (*B1, z1), (*A1, z1)))
    top = [rot(p, twist_total_deg) for p in sq]
    roof = [ms.make_horizontal_quad(top, floors * FH)]
    return [ms.MeshPart("Spandrel", "Spandrel", (0.3, 0.3, 0.3), 0.0, quads=wall),
            ms.MeshPart("Vision Glass", "Vision Glass", (0.5, 0.7, 0.9), 0.7, quads=glz),
            ms.MeshPart("Atap", "Atap", (0.6, 0.6, 0.6), 0.0, quads=roof)]


@pytest.mark.parametrize("deg", [90.0, 25.0])
def test_menara_twisted_rotasi(tmp_path, deg):
    a = run(tmp_path, _twisted_parts(), "tw0")
    b = run(tmp_path, ms.transform_parts(_twisted_parts(), ms.rotate_cw_xy(deg)), f"tw{int(deg)}", north=deg)
    assert_same(a, b, f"menara twisted diputar {deg}°")


def test_menara_twisted_luas_panel(tmp_path):
    """Luas kaca hasil engine harus sama dengan luas geometri panel kaca (tidak ada yang hilang/terduplikasi)."""
    parts = _twisted_parts()
    import numpy as np
    def qarea(q):
        p = np.array(q)
        return 0.5 * (np.linalg.norm(np.cross(p[1] - p[0], p[2] - p[0])) + np.linalg.norm(np.cross(p[2] - p[0], p[3] - p[0])))
    expected = sum(qarea(q) for q in parts[1].quads)
    r = run(tmp_path, parts, "tw_area")
    assert math.isclose(glz_area(r), expected, rel_tol=0.01), f"kaca {glz_area(r)} vs geometri {expected}"


@pytest.mark.xfail(strict=True, reason="AUDIT-02: face kembar tidak dideduplikasi & tanpa peringatan")
def test_dobel_sebagian_tidak_mengubah_ottv(tmp_path, base):
    p = base_parts()
    g = p[1]
    half = ms.MeshPart(g.name, g.material_name, g.color_rgb, g.transparency, [q for q in g.quads if q[0][2] < 8.0])
    assert_same(base, run(tmp_path, p + [half], "dobel_sebagian"), "kaca lantai 1-2 dobel")


@pytest.mark.parametrize("name", [
    pytest.param("CW_Vertical", marks=pytest.mark.xfail(strict=True, reason="AUDIT-03: kotak mullion bernama konteks CW dianggap kaca")),
    pytest.param("Curtain Wall Grid", marks=pytest.mark.xfail(strict=True, reason="AUDIT-03: kotak mullion bernama konteks CW dianggap kaca")),
    pytest.param("Kaca Rangka", marks=pytest.mark.xfail(strict=True, reason="AUDIT-03: token kaca mengalahkan token rangka")),
])
def test_mullion_nama_ambigu_bukan_kaca(tmp_path, base, name):
    """Kotak tipis-dalam di depan kaca secara geometri adalah rangka, apa pun namanya."""
    r = run(tmp_path, base_parts() + [mullion_part(name)], f"mul_ambigu_{name}")
    assert_same(base, r, f"mullion bernama '{name}'")


@pytest.mark.parametrize("name", ["Layer 03", "Object 12"])
def test_nama_tak_dikenal_ditandai_provisional(tmp_path, name):
    r = run(tmp_path, base_parts() + [mullion_part(name)], f"unk_{name}")
    assert r["summary"].get("is_provisional") is True, "grup tak dikenal wajib membuat hasil berstatus sementara"


@pytest.mark.parametrize("fmt", ["obj", "glb"])
@pytest.mark.parametrize("case", ["base", "rot37", "fins", "twisted"])
def test_paritas_format(tmp_path, fmt, case):
    parts = {"base": base_parts(), "rot37": ms.transform_parts(base_parts(), ms.rotate_cw_xy(37.0)),
             "fins": base_parts() + [fins_part()], "twisted": _twisted_parts()}[case]
    north = 37.0 if case == "rot37" else 0.0
    ref = run(tmp_path, parts, f"par_{case}", north=north)
    path = str(tmp_path / f"par_{case}.{fmt}")
    (ms.write_obj_and_mtl if fmt == "obj" else ms.write_glb)(path, parts)
    prm = EnvelopeParameters(); prm.calculation_mode = "sni"; prm.city_preset = "jakarta"; prm.north_angle_deg = north
    r = analyze_building_ottv(path, os.path.basename(path), prm)
    assert abs(r["ottv_total_wm2"] - ref["ottv_total_wm2"]) <= OTTV_TOL
    assert math.isclose(glz_area(r), glz_area(ref), rel_tol=0.005)
