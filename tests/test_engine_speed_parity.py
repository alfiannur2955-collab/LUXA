"""Uji paritas optimasi kecepatan engine (T7):
setiap percepatan di backend/ottv_engine.py wajib menghasilkan angka IDENTIK dengan jalur referensi."""

from __future__ import annotations

import os
import sys

import numpy as np
import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from ottv_engine import (  # noqa: E402
    EnvelopeParameters,
    _build_shading_z_index,
    _measure_panel_sni_shading_ratios,
    _z_index_candidates,
    analyze_building_ottv,
)
from universal_pipeline import load_universal_model_stages_1_and_2  # noqa: E402


@pytest.mark.parametrize(
    "rel_path",
    [
        "fixtures/synthetic/08_overhang/model.3dm",
        "fixtures/synthetic/09_sirip/model.3dm",
        "backend/samples/Fasad_Tower_Twisted.3dm",
    ],
)
def test_shading_zindex_cache_dan_precomputed_normal_identik_brute_force(rel_path: str) -> None:
    """_measure_panel_sni_shading_ratios dengan z-index cache + shading_norm_info harus identik 100%
    dengan jalur tanpa indeks-Z dan tanpa precomputed normal."""
    fp = os.path.join(ROOT_DIR, rel_path)
    if not os.path.isfile(fp):
        pytest.skip(f"{rel_path} tidak ada")

    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.materials_confirmed = True
    res = analyze_building_ottv(fp, os.path.basename(fp), prm)

    # Bangun ulang shading_tris dari grup shading/roof/unknown/ignore tidak diperlukan penuh;
    # ambil langsung shading_elements dari hasil analisis sebagai himpunan segitiga uji.
    sh_chunks = []
    for el in (res.get("shading_elements") or []) + (res.get("roof_elements") or []):
        vs = np.asarray(el.get("vertices") or [], dtype=np.float64)
        fs = np.asarray(el.get("faces") or [], dtype=np.int64)
        if len(vs) >= 3 and len(fs) >= 1:
            sh_chunks.append(np.stack([vs[fs[:, 0]], vs[fs[:, 1]], vs[fs[:, 2]]], axis=1))
    if not sh_chunks:
        pytest.skip(f"{rel_path} tidak memiliki elemen peneduh")

    sh_tris = np.vstack(sh_chunks)
    sh_min = np.min(sh_tris, axis=1)
    sh_max = np.max(sh_tris, axis=1)
    zi = _build_shading_z_index(sh_min, sh_max)

    tc = np.cross(sh_tris[:, 1] - sh_tris[:, 0], sh_tris[:, 2] - sh_tris[:, 0])
    tlen = np.linalg.norm(tc, axis=1)
    valid = tlen > 1e-8
    unit = np.zeros((len(sh_tris), 3), dtype=np.float64)
    unit[valid] = tc[valid] / tlen[valid, None]
    norm_info = (unit, valid)

    glz_panels = [p for p in res["panels"] if p.get("active") and p.get("element_type") == "glazing"][:120]
    assert len(glz_panels) > 0

    for p in glz_panels:
        det_fast = {}
        det_ref = {}
        fast = _measure_panel_sni_shading_ratios(
            panel_verts=p["vertices"],
            panel_normal=p["normal"],
            shading_tris=sh_tris,
            shading_aabb=(sh_min, sh_max),
            shading_zindex=zi,
            shading_norm_info=norm_info,
            detail=det_fast,
        )
        ref = _measure_panel_sni_shading_ratios(
            panel_verts=p["vertices"],
            panel_normal=p["normal"],
            shading_tris=sh_tris,
            shading_aabb=(sh_min, sh_max),
            shading_zindex=None,
            shading_norm_info=None,
            detail=det_ref,
        )
        assert fast == ref, f"{rel_path} panel {p['id']}: fast={fast} vs ref={ref}"
        assert det_fast == det_ref, f"{rel_path} panel {p['id']}: detail fast={det_fast} vs ref={det_ref}"


def test_z_index_cache_mengembalikan_array_identik() -> None:
    """Pemanggilan berulang _z_index_candidates pada rentang sama mengembalikan indeks yang identik."""
    rng = np.random.default_rng(42)
    z0 = rng.uniform(0.0, 40.0, size=5000)
    z1 = z0 + rng.uniform(0.1, 3.0, size=5000)
    sh_min = np.column_stack([np.zeros(5000), np.zeros(5000), z0])
    sh_max = np.column_stack([np.ones(5000), np.ones(5000), z1])
    zi = _build_shading_z_index(sh_min, sh_max)

    for zlo, zhi in ((0.0, 4.0), (10.0, 14.0), (10.2, 13.8), (25.0, 30.0)):
        c1 = _z_index_candidates(zi, zlo, zhi)
        c2 = _z_index_candidates(zi, zlo, zhi)
        assert np.array_equal(c1, c2)
        # Bandingkan dengan penyaringan langsung tanpa cache
        zi_nocache = {k: v for k, v in zi.items() if not k.startswith("_")}
        c_ref = _z_index_candidates(zi_nocache, zlo, zhi)
        assert np.array_equal(c1, c_ref)


def test_twisted_tower_ottv_tetap_34_18() -> None:
    """Model acuan Fasad_Tower_Twisted.3dm tetap menghasilkan OTTV 34,18 W/m² setelah optimasi T7."""
    fp = os.path.join(ROOT_DIR, "backend", "samples", "Fasad_Tower_Twisted.3dm")
    if not os.path.isfile(fp):
        pytest.skip("Fasad_Tower_Twisted.3dm tidak ada")
    prm = EnvelopeParameters()
    prm.calculation_mode = "sni"
    prm.materials_confirmed = True
    res = analyze_building_ottv(fp, "Fasad_Tower_Twisted.3dm", prm)
    assert res["ottv_total_wm2"] == pytest.approx(34.18, abs=0.01)
    assert len(res["panels"]) == 12096
