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


def run(tmp_path, parts: List[ms.MeshPart], name: str, unit=None, north: float = 0.0, confirmed: bool = True) -> Dict:
    path = str(tmp_path / f"{name}.3dm")
    ms.write_3dm(path, parts, unit_system=unit or rhino3dm.UnitSystem.Meters)
    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.city_preset = "jakarta"
    prm.north_angle_deg = north
    prm.materials_confirmed = confirmed
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


def test_dobel_sebagian_tidak_mengubah_ottv(tmp_path, base):
    p = base_parts()
    g = p[1]
    half = ms.MeshPart(g.name, g.material_name, g.color_rgb, g.transparency, [q for q in g.quads if q[0][2] < 8.0])
    assert_same(base, run(tmp_path, p + [half], "dobel_sebagian"), "kaca lantai 1-2 dobel")


@pytest.mark.parametrize("name", [
    "CW_Vertical",
    "Curtain Wall Grid",
    "Kaca Rangka",
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


# ----------------------------------------------------------------------------
# Pengaman perbaikan AUDIT-02 / AUDIT-03
# ----------------------------------------------------------------------------

def _codes(r: Dict) -> List[str]:
    return [w.get("code") for w in (r["summary"].get("warnings") or [])]


def test_dobel_memberi_peringatan(tmp_path):
    p = base_parts()
    r = run(tmp_path, p + [ms.MeshPart(p[1].name, p[1].material_name, p[1].color_rgb, p[1].transparency, list(p[1].quads))], "dobel_warn")
    assert "DUPLICATE_FACES_REMOVED" in _codes(r)
    assert r["summary"]["is_provisional"] is False, "dobel sekategori sudah beres otomatis, tidak perlu jadi hasil sementara"


def test_dobel_lintas_kategori_wajib_konfirmasi(tmp_path):
    """Kaca ditumpuk persis di atas dinding: mana yang benar hanya perancang yang tahu."""
    p = base_parts()
    wall = p[0]
    fake_glz = ms.MeshPart("Kaca Tambahan", "Kaca Tambahan", (0.5, 0.7, 0.9), 0.7, quads=list(wall.quads[:4]))
    r = run(tmp_path, p + [fake_glz], "dobel_konflik")
    assert "DUPLICATE_FACE_CONFLICT" in _codes(r)
    assert r["summary"]["is_provisional"] is True


def test_mullion_ambigu_memberi_peringatan(tmp_path):
    r = run(tmp_path, base_parts() + [mullion_part("CW_Vertical")], "mul_warn")
    assert "GEOMETRY_RECLASSIFIED" in _codes(r)


def test_pilihan_pengguna_mengalahkan_geometri(tmp_path):
    path = str(tmp_path / "ovr.3dm")
    ms.write_3dm(path, base_parts() + [mullion_part("CW_Vertical")])
    prm = EnvelopeParameters(); prm.calculation_mode = "sni"; prm.materials_confirmed = True
    prm.group_category_overrides = {"CW_Vertical :: CW_Vertical": "glazing"}
    r = analyze_building_ottv(path, "ovr.3dm", prm)
    assert "GEOMETRY_RECLASSIFIED" not in _codes(r)


def _glass_boxes(thick: float, width: float, height: float, name: str) -> ms.MeshPart:
    """Panel kaca berbentuk kotak tebal di pita jendela sisi selatan (y = -10)."""
    quads = []
    for f in range(FLOORS):
        z0 = f * FH + 1.2
        x = -12.0
        while x + width <= 12.0 + 1e-6:
            quads += ms.make_box_quads(x, x + width, -10.0 - thick, -10.0, z0, z0 + height)
            x += width
    return ms.MeshPart(name, name, (0.5, 0.7, 0.9), 0.7, quads=quads)


@pytest.mark.parametrize("thick,width,height", [(0.024, 1.5, 1.6), (0.032, 1.2, 1.6), (0.024, 0.25, 1.6), (0.01, 0.3, 1.6)])
def test_kaca_asli_tidak_dianggap_rangka(tmp_path, thick, width, height):
    walls = ms.MeshPart("Dinding", "Dinding", (0.7, 0.7, 0.7), 0.0, quads=[q for q in base_parts()[0].quads])
    r = run(tmp_path, [walls, _glass_boxes(thick, width, height, "Kaca Panel")], f"glass_{thick}_{width}")
    assert "GEOMETRY_RECLASSIFIED" not in _codes(r), f"kaca {thick*1000:.0f} mm x {width} m salah dianggap rangka"
    assert glz_area(r) > 0


# ----------------------------------------------------------------------------
# A3-01: material default tidak boleh menghasilkan "memenuhi SNI" diam-diam
# ----------------------------------------------------------------------------

def test_material_belum_dikonfirmasi_hasil_sementara(tmp_path):
    r = run(tmp_path, base_parts(), "mat_belum", confirmed=False)
    assert r["summary"]["is_provisional"] is True
    assert "MATERIAL_NOT_CONFIRMED" in _codes(r)
    assert r["compliant"] is False and "SEMENTARA" in r["status_label"]


def test_saran_material_dari_nama_layer(tmp_path):
    r = run(tmp_path, base_parts(wall="Dinding Bata", glz="Kaca Bening"), "mat_saran", confirmed=False)
    w = [x for x in r["summary"]["warnings"] if x["code"] == "MATERIAL_NOT_CONFIRMED"][0]
    sug = {s["category"]: s["material_id"] for s in w["detail"]["suggestions"]}
    assert sug.get("glazing") == "glz_kaca_polos_8"
    assert sug.get("wall") == "wal_bata_merah_plester"


def test_rematerial_memperbarui_status(tmp_path):
    from recommender import rematerial_analysis
    r = run(tmp_path, base_parts(wall="Dinding Bata", glz="Kaca Bening"), "mat_remat", confirmed=False)
    w = [x for x in r["summary"]["warnings"] if x["code"] == "MATERIAL_NOT_CONFIRMED"][0]
    patch = w["detail"]["suggested_patch"]
    # Saran seragam per peran dipasang sebagai material UTAMA (bukan override grup), lihat _suggestion_patch
    assert patch.get("glazing_material_id") == "glz_kaca_polos_8" and "group_material_map" not in patch
    r2 = rematerial_analysis(r, **patch, materials_confirmed=True)
    assert r2["summary"]["is_provisional"] is False
    assert "MATERIAL_NOT_CONFIRMED" not in _codes(r2)
    full = run(tmp_path, base_parts(wall="Dinding Bata", glz="Kaca Bening"), "mat_full")
    path = str(tmp_path / "mat_full2.3dm")
    ms.write_3dm(path, base_parts(wall="Dinding Bata", glz="Kaca Bening"))
    prm = EnvelopeParameters(); prm.calculation_mode = "sni"; prm.materials_confirmed = True
    for k_, v_ in patch.items():
        setattr(prm, k_, v_)
    r3 = analyze_building_ottv(path, "mat_full2.3dm", prm)
    assert abs(r3["ottv_total_wm2"] - r2["ottv_total_wm2"]) <= OTTV_TOL, "jalur cepat & hitung penuh harus sama"
    assert ("MEMENUHI" in r2["status_label"]) == (r2["ottv_total_wm2"] <= 35.0)
    assert full["ottv_total_wm2"] < r2["ottv_total_wm2"], "kaca polos harus lebih panas daripada default"


# ----------------------------------------------------------------------------
# A3-02: peneduh lepas / lebih tinggi dari jendela -> mulus, monoton, setara SNI bila menempel
# ----------------------------------------------------------------------------

def _canopy(depth: float, gap: float = 0.0, rise: float = 0.0) -> ms.MeshPart:
    qs = []
    n = len(L_POLY)
    for f in range(FLOORS):
        z = f * FH + 1.2 + 1.6 + rise
        for i in range(n):
            a, b = L_POLY[i], L_POLY[(i + 1) % n]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            nx, ny = dy / ln, -dx / ln
            p = lambda q, s: (q[0] + nx * s, q[1] + ny * s)
            qs.append(((*p(a, gap), z), (*p(b, gap), z), (*p(b, gap + depth), z), (*p(a, gap + depth), z)))
    return ms.MeshPart("Kanopi", "Kanopi", (0.6, 0.6, 0.6), 0.0, quads=qs)


@pytest.mark.parametrize("kind", ["gap", "rise"])
def test_peneduh_lepas_mulus_dan_monoton(tmp_path, base, kind):
    vals = [0.0, 0.1, 0.3, 0.6, 1.0, 1.5, 2.0, 2.8]
    ottv = [run(tmp_path, base_parts() + [_canopy(1.0, **{kind: v})], f"can_{kind}_{v}")["ottv_total_wm2"] for v in vals]
    assert all(b >= a - 1e-6 for a, b in zip(ottv, ottv[1:])), f"makin jauh tidak boleh makin teduh: {ottv}"
    assert all(b - a <= 1.5 for a, b in zip(ottv, ottv[1:])), f"tidak boleh ada lompatan besar: {ottv}"
    assert ottv[-1] <= base["ottv_total_wm2"] + 1e-6


def test_peneduh_lepas_tidak_lebih_baik_dari_menempel(tmp_path):
    attached = run(tmp_path, base_parts() + [_canopy(1.0)], "can_att")
    for g in (0.2, 1.0):
        det = run(tmp_path, base_parts() + [_canopy(1.0, gap=g)], f"can_det{g}")
        assert det["ottv_total_wm2"] >= attached["ottv_total_wm2"] - 1e-6
        assert "SHADING_DETACHED_APPROX" in _codes(det)
    assert "SHADING_DETACHED_APPROX" not in _codes(attached)


# ----------------------------------------------------------------------------
# A3-06: cek geometri terlihat sejak tahap klasifikasi/inspeksi
# A3-08: pelat menjorok di depan kaca = peneduh, apa pun namanya
# ----------------------------------------------------------------------------

def test_reklasifikasi_geometri_terlihat_di_tahap_inspeksi(tmp_path):
    from universal_pipeline import load_universal_model_stages_1_and_2
    path = str(tmp_path / "insp.3dm")
    ms.write_3dm(path, base_parts() + [mullion_part("CW_Vertical")])
    groups, audit = load_universal_model_stages_1_and_2(filepath=path)
    g = [x for x in groups if x.group_name.startswith("CW_Vertical")][0]
    assert g.default_category == "frame"
    assert g.geometry_reclassified_from == "glazing"
    assert any("CW_Vertical" in n for n in audit.notes)


def _slab(name: str, depth: float, inner: float) -> ms.MeshPart:
    """Pelat menerus per lantai di sisi y = -10 (selatan): `inner` m ke dalam, `depth` m menjorok keluar."""
    qs = []
    for f in range(FLOORS):
        z = f * FH + 1.2 + 1.6
        qs.append(((-12.0, -10.0 - depth, z), (12.0, -10.0 - depth, z), (12.0, -10.0 + inner, z), (-12.0, -10.0 + inner, z)))
    return ms.MeshPart(name, name, (0.6, 0.6, 0.6), 0.0, quads=qs)


@pytest.mark.parametrize("name", ["Plat Balkon", "Pelat Lantai", "Balkon", "Layer 07"])
def test_pelat_balkon_meneduhi_apa_pun_namanya(tmp_path, name):
    ref = run(tmp_path, base_parts() + [_slab("Kanopi", 1.5, 0.0)], "slab_ref")
    r = run(tmp_path, base_parts() + [_slab(name, 1.5, 0.0)], f"slab_{name}")
    assert abs(r["ottv_total_wm2"] - ref["ottv_total_wm2"]) <= OTTV_TOL
    assert "GEOMETRY_SLAB_SHADING" in _codes(r)


def test_pelat_lantai_interior_tidak_meneduhi(tmp_path, base):
    r = run(tmp_path, base_parts() + [_slab("Pelat Lantai", 0.0, 12.0)], "slab_int")
    assert_same(base, r, "pelat lantai di dalam bangunan")
    assert "GEOMETRY_SLAB_SHADING" not in _codes(r)



def test_saran_berbeda_per_grup_jadi_override_grup(tmp_path):
    """Dua grup kaca dengan saran berbeda (bening vs stopsol) -> override per grup, bukan material utama."""
    parts = base_parts(wall="Dinding Bata", glz="Kaca Bening")
    g = parts[1]
    half = len(g.quads) // 2
    parts = [parts[0], parts[2],
             ms.MeshPart("Kaca Bening", "Kaca Bening", g.color_rgb, g.transparency, g.quads[:half]),
             ms.MeshPart("Kaca Stopsol", "Kaca Stopsol", g.color_rgb, g.transparency, g.quads[half:])]
    r = run(tmp_path, parts, "saran_campur", confirmed=False)
    patch = [x for x in r["summary"]["warnings"] if x["code"] == "MATERIAL_NOT_CONFIRMED"][0]["detail"]["suggested_patch"]
    assert "glazing_material_id" not in patch
    gm = patch["group_material_map"]
    assert gm["Kaca Bening :: Kaca Bening"] == "glz_kaca_polos_8"
    assert gm["Kaca Stopsol :: Kaca Stopsol"] == "glz_kaca_reflektif_8"
    assert patch.get("wall_material_id") == "wal_bata_merah_plester"


@pytest.mark.parametrize("glz,wall", [("Glass", "Walls"), ("CW_Vision_Glass", "Dinding"), ("Kaca", "Exterior Walls")])
def test_nama_generik_tanpa_saran_material(tmp_path, glz, wall):
    """Nama yang tidak menyebut jenis material tidak diberi saran: pengguna diminta memilih sendiri."""
    r = run(tmp_path, base_parts(wall=wall, glz=glz), f"generik_{glz}", confirmed=False)
    w = [x for x in r["summary"]["warnings"] if x["code"] == "MATERIAL_NOT_CONFIRMED"][0]
    assert w["detail"]["suggestions"] == []
    assert w["detail"]["suggested_patch"] == {}
    assert r["summary"]["is_provisional"] is True


# ----------------------------------------------------------------------------
# A3-05: file .3dm berisi Brep / Extrusion tanpa render mesh (SaveSmall)
# ----------------------------------------------------------------------------

def _add_layer_and_mat(model: "rhino3dm.File3dm", name: str, rgb: Tuple[int, int, int], transp: float = 0.0) -> Tuple[int, int]:
    lyr = rhino3dm.Layer()
    lyr.Name = name
    lyr.Color = (rgb[0], rgb[1], rgb[2], 255)
    li = model.Layers.Add(lyr)
    mat = rhino3dm.Material()
    mat.Name = name
    mat.Transparency = transp
    mi = model.Materials.Add(mat)
    return li, mi


def _extrusion_box(x0: float, y0: float, x1: float, y1: float, z0: float, z1: float) -> "rhino3dm.Extrusion":
    pl = rhino3dm.Polyline([
        rhino3dm.Point3d(x0, y0, z0),
        rhino3dm.Point3d(x1, y0, z0),
        rhino3dm.Point3d(x1, y1, z0),
        rhino3dm.Point3d(x0, y1, z0),
        rhino3dm.Point3d(x0, y0, z0),
    ])
    return rhino3dm.Extrusion.Create(pl.ToPolylineCurve(), z1 - z0, True)


def _write_meshless_brep_extrusion_building(path: str) -> None:
    """Bangunan kotak 20x12x8 m (2 lantai @ 4 m) murni Brep + Extrusion tanpa render mesh."""
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters
    li_w, mi_w = _add_layer_and_mat(model, "Dinding Bata", (194, 184, 173), 0.0)
    li_g, mi_g = _add_layer_and_mat(model, "Kaca Jendela", (122, 194, 235), 0.7)
    li_r, mi_r = _add_layer_and_mat(model, "Atap Beton", (140, 143, 148), 0.0)

    def _attr(li: int, mi: int) -> "rhino3dm.ObjectAttributes":
        a = rhino3dm.ObjectAttributes()
        a.LayerIndex = li
        a.MaterialIndex = mi
        a.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        return a

    t = 0.2
    for f in range(2):
        z0 = f * 4.0
        # Pita spandrel bawah & atas sebagai Extrusion (tanpa render mesh)
        for zb0, zb1 in ((z0, z0 + 1.2), (z0 + 2.8, z0 + 4.0)):
            for x0, y0, x1, y1 in (
                (-10.0, -6.0, 10.0, -6.0 + t),
                (-10.0, 6.0 - t, 10.0, 6.0),
                (10.0 - t, -6.0 + t, 10.0, 6.0 - t),
                (-10.0, -6.0 + t, -10.0 + t, 6.0 - t),
            ):
                model.Objects.AddExtrusion(_extrusion_box(x0, y0, x1, y1, zb0, zb1), _attr(li_w, mi_w))
        # Pita kaca tengah sebagai Brep kotak (tanpa render mesh)
        zg0, zg1 = z0 + 1.2, z0 + 2.8
        for x0, y0, x1, y1 in (
            (-10.0, -6.0, 10.0, -6.0 + t),
            (-10.0, 6.0 - t, 10.0, 6.0),
            (10.0 - t, -6.0 + t, 10.0, 6.0 - t),
            (-10.0, -6.0 + t, -10.0 + t, 6.0 - t),
        ):
            bb = rhino3dm.BoundingBox(rhino3dm.Point3d(x0, y0, zg0), rhino3dm.Point3d(x1, y1, zg1))
            brep = rhino3dm.Brep.CreateFromBox(rhino3dm.Box(bb))
            model.Objects.AddBrep(brep, _attr(li_g, mi_g))

    # Atap sebagai Extrusion tipis (tanpa render mesh)
    model.Objects.AddExtrusion(_extrusion_box(-10.0, -6.0, 10.0, 6.0, 8.0, 8.2), _attr(li_r, mi_r))
    model.Write(path, 7)


def _mesh_equivalent_parts() -> List[ms.MeshPart]:
    rect = [(-10.0, -6.0), (10.0, -6.0), (10.0, 6.0), (-10.0, 6.0)]
    roof = [ms.make_horizontal_quad(rect, 8.0, up=True)]
    return ms.build_ribbon_building_parts(
        [rect], roof, floors=2, fh=4.0,
        wall_name="Dinding Bata", glz_name="Kaca Jendela", roof_name="Atap Beton",
    )


def test_3dm_brep_dan_extrusion_tanpa_mesh_sama_dengan_versi_mesh(tmp_path):
    """A3-05: file 3DM murni Brep kotak + Extrusion tanpa render mesh menghasilkan OTTV sama dengan versi Mesh."""
    ref = run(tmp_path, _mesh_equivalent_parts(), "box2_mesh")

    path_nomesh = str(tmp_path / "box2_brep_extrusion_nomesh.3dm")
    _write_meshless_brep_extrusion_building(path_nomesh)
    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.city_preset = "jakarta"
    prm.materials_confirmed = True
    res = analyze_building_ottv(path_nomesh, os.path.basename(path_nomesh), prm)
    assert res.get("ottv_total_wm2") is not None, res.get("ottv_error")
    assert_same(ref, res, "Brep+Extrusion tanpa mesh vs Mesh")
    assert "MISSING_MESH" not in _codes(res)


def test_3dm_extrusion_berlubang_tanpa_mesh(tmp_path):
    """A3-05: BrepFace planar dengan lubang (loop dalam) ditriangulasi benar tanpa menutup lubang."""
    path = str(tmp_path / "wall_with_hole_nomesh.3dm")
    model = rhino3dm.File3dm()
    model.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters
    li_w, mi_w = _add_layer_and_mat(model, "Dinding Bata", (194, 184, 173), 0.0)
    li_g, mi_g = _add_layer_and_mat(model, "Kaca Jendela", (122, 194, 235), 0.7)

    def _attr(li: int, mi: int) -> "rhino3dm.ObjectAttributes":
        a = rhino3dm.ObjectAttributes()
        a.LayerIndex = li
        a.MaterialIndex = mi
        a.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
        return a

    # Cincin dinding 20x12 m berlubang 16x8 m di tengah (AddInnerProfile pakai koordinat lokal terhadap outer[0])
    outer = rhino3dm.Polyline([
        rhino3dm.Point3d(-10.0, -6.0, 0.0), rhino3dm.Point3d(10.0, -6.0, 0.0),
        rhino3dm.Point3d(10.0, 6.0, 0.0), rhino3dm.Point3d(-10.0, 6.0, 0.0),
        rhino3dm.Point3d(-10.0, -6.0, 0.0),
    ])
    inner = rhino3dm.Polyline([
        rhino3dm.Point3d(2.0, 2.0, 0.0), rhino3dm.Point3d(18.0, 2.0, 0.0),
        rhino3dm.Point3d(18.0, 10.0, 0.0), rhino3dm.Point3d(2.0, 10.0, 0.0),
        rhino3dm.Point3d(2.0, 2.0, 0.0),
    ])
    ext = rhino3dm.Extrusion.Create(outer.ToPolylineCurve(), 4.0, True)
    ext.AddInnerProfile(inner.ToPolylineCurve())
    model.Objects.AddExtrusion(ext, _attr(li_w, mi_w))

    # Tambahkan atap datar dengan lubang 16x8 di atasnya sebagai Atap Beton (luas harus 20*12 - 16*8 = 112 m²)
    li_r, mi_r = _add_layer_and_mat(model, "Atap Beton", (140, 143, 148), 0.0)
    roof_ext = rhino3dm.Extrusion.Create(outer.ToPolylineCurve(), 0.2, True)
    roof_ext.AddInnerProfile(inner.ToPolylineCurve())
    roof_ext.Translate(rhino3dm.Vector3d(0.0, 0.0, 4.0))
    model.Objects.AddExtrusion(roof_ext, _attr(li_r, mi_r))

    # Kaca kecil di sisi selatan agar tidak NO_GLAZING
    bb_g = rhino3dm.BoundingBox(rhino3dm.Point3d(-2.0, -6.2, 1.0), rhino3dm.Point3d(2.0, -6.0, 3.0))
    model.Objects.AddBrep(rhino3dm.Brep.CreateFromBox(rhino3dm.Box(bb_g)), _attr(li_g, mi_g))
    model.Write(path, 7)

    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.city_preset = "jakarta"
    prm.materials_confirmed = True
    res = analyze_building_ottv(path, os.path.basename(path), prm)
    assert res.get("ottv_total_wm2") is not None
    # Luas atap berlubang: 20*12 - 16*8 = 240 - 128 = 112 m² (bukan 240 m²!)
    roof_area = float(res["rttv"]["total_roof_area_m2"])
    assert abs(roof_area - 112.0) <= 2.0, f"Atap berlubang seharusnya ~112 m², dapat {roof_area:.2f} m²"


def test_3dm_nonplanar_tanpa_mesh_catat_missing_mesh_dan_pesan_savesmall(tmp_path):
    """A3-05: face non-planar tanpa render mesh dicatat di missing_mesh; bila seluruh file non-planar pesan jujur."""
    # 1. File murni non-planar (bola Brep tanpa render mesh) -> ValueError jujur menyarankan SaveSmall
    path_only_curved = str(tmp_path / "only_sphere_nomesh.3dm")
    m1 = rhino3dm.File3dm()
    m1.Settings.ModelUnitSystem = rhino3dm.UnitSystem.Meters
    li_w, mi_w = _add_layer_and_mat(m1, "Dinding Bata", (194, 184, 173), 0.0)
    a = rhino3dm.ObjectAttributes()
    a.LayerIndex = li_w
    a.MaterialIndex = mi_w
    a.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
    sph = rhino3dm.Sphere(rhino3dm.Point3d(0, 0, 5), 5.0)
    m1.Objects.AddBrep(sph.ToBrep(), a)
    m1.Write(path_only_curved, 7)

    from universal_pipeline import load_universal_model_stages_1_and_2
    with pytest.raises(ValueError) as exc_info:
        load_universal_model_stages_1_and_2(path_only_curved)
    msg = str(exc_info.value)
    assert "SaveSmall" in msg and "render mesh" in msg.lower(), f"Pesan error kurang informatif: {msg}"

    # 2. File tanpa mesh berisi dinding kotak planar + satu bola non-planar -> planar tetap terhitung, bola masuk MISSING_MESH
    path_mixed_geom = str(tmp_path / "planar_plus_sphere_nomesh.3dm")
    _write_meshless_brep_extrusion_building(path_mixed_geom)
    m2 = rhino3dm.File3dm.Read(path_mixed_geom)
    a2 = rhino3dm.ObjectAttributes()
    a2.LayerIndex = 0
    a2.MaterialIndex = 0
    a2.MaterialSource = rhino3dm.ObjectMaterialSource.MaterialFromObject
    m2.Objects.AddBrep(rhino3dm.Sphere(rhino3dm.Point3d(25, 0, 5), 2.0).ToBrep(), a2)
    m2.Write(path_mixed_geom, 7)

    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.city_preset = "jakarta"
    prm.materials_confirmed = True
    res = analyze_building_ottv(path_mixed_geom, os.path.basename(path_mixed_geom), prm)
    assert "MISSING_MESH" in _codes(res)
    mm_warn = [w for w in res["summary"]["warnings"] if w["code"] == "MISSING_MESH"][0]
    assert "SaveSmall" in mm_warn["message"]
    assert mm_warn["detail"]["total_face_count"] == 1


def test_3dm_campuran_missing_mesh_sebut_objek_dan_sarankan_savesmall():
    """A3-05 (Opsi 2): file campuran (punya mesh + Brep tanpa mesh) tetap mencatat MISSING_MESH lengkap."""
    p = os.path.join(ROOT_DIR, "fixtures", "synthetic", "12_brep_tanpa_mesh", "model.3dm")
    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.city_preset = "jakarta"
    prm.materials_confirmed = True
    res = analyze_building_ottv(p, "model.3dm", prm)
    mm = [w for w in res["summary"]["warnings"] if w["code"] == "MISSING_MESH"]
    assert len(mm) == 1
    msg = mm[0]["message"]
    assert "32 objek" in msg and "192 permukaan" in msg, f"Jumlah objek/permukaan tidak disebut: {msg}"
    assert "simpan ulang dari Rhino tanpa SaveSmall" in msg, f"Saran SaveSmall tidak ada: {msg}"
