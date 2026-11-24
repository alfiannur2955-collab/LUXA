"""
Raycast matahari dengan grid proyeksi (A3-04 lanjutan, percepatan engine) harus memberi hasil yang SAMA PERSIS
dengan uji brute-force semua sinar lawan semua segitiga (rumus Möller-Trumbore yang sama).
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pytest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT_DIR, "backend"))

from ottv_engine import _build_shading_z_index, _z_index_candidates, raycast_z_slab_solar_rays  # noqa: E402


def _brute(tris, origins, d, min_dist, max_dist):
    if len(tris) > 12000:  # subsampel yang sama dengan engine
        tris = tris[:: max(1, len(tris) // 12000)]
    d = d / np.linalg.norm(d)
    v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    h = np.cross(np.broadcast_to(d, e2.shape), e2)
    a = np.einsum("ij,ij->i", e1, h)
    ok = np.abs(a) > 1e-7
    v0, e1, e2, h, f = v0[ok], e1[ok], e2[ok], h[ok], 1.0 / a[ok]
    pu, pv, pt = h * f[:, None], np.cross(e1, np.broadcast_to(d, e1.shape)) * f[:, None], np.cross(e1, e2) * f[:, None]
    cu, cv, ct = (np.einsum("ij,ij->i", v0, x) for x in (pu, pv, pt))
    u = origins @ pu.T - cu
    v = origins @ pv.T - cv
    t = origins @ pt.T - ct
    m = (u >= -1e-4) & (u <= 1.0001) & (v >= -1e-4) & ((u + v) <= 1.0001) & (t >= min_dist) & (t <= max_dist)
    return np.any(m, axis=1).astype(np.float64)


def _scene(seed):
    rng = np.random.default_rng(seed)
    # campuran segitiga kecil (sirip), sedang, dan raksasa (atap/pelat besar) di kotak 60 x 60 x 40 m
    small = rng.uniform([-30, -30, 0], [30, 30, 40], (900, 1, 3)) + rng.normal(0, 0.6, (900, 3, 3))
    mid = rng.uniform([-30, -30, 0], [30, 30, 40], (200, 1, 3)) + rng.normal(0, 4.0, (200, 3, 3))
    big = rng.uniform([-30, -30, 0], [30, 30, 40], (6, 1, 3)) + rng.normal(0, 40.0, (6, 3, 3))
    tris = np.concatenate([small, mid, big]).astype(np.float64)
    origins = rng.uniform([-30, -30, 0], [30, 30, 40], (700, 3))
    return tris, origins


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_grid_sama_dengan_brute_force(seed):
    tris, origins = _scene(seed)
    for az in range(0, 360, 45):
        for el in (8, 25, 50, 85):
            d = np.array([np.sin(np.radians(az)) * np.cos(np.radians(el)), np.cos(np.radians(az)) * np.cos(np.radians(el)), np.sin(np.radians(el))])
            got = raycast_z_slab_solar_rays(tris, origins, d, min_dist=0.08, max_dist=35.0)
            ref = _brute(tris, origins, d, 0.08, 35.0)
            assert np.array_equal(got, ref), (seed, az, el, int((got != ref).sum()))


def test_indeks_z_mencakup_semua_segitiga_yang_menyentuh_pita():
    rng = np.random.default_rng(7)
    lo = rng.uniform(0, 80, (3000, 3))
    hi = lo + rng.uniform(0, 6, (3000, 3))
    zi = _build_shading_z_index(lo, hi)
    for z0 in np.linspace(-5, 90, 60):
        z1 = z0 + rng.uniform(0.5, 8)
        expect = np.where((hi[:, 2] >= z0) & (lo[:, 2] <= z1))[0]
        got = _z_index_candidates(zi, z0, z1)
        assert set(expect) <= set(got.tolist())
        assert np.all(np.diff(got) > 0)  # urut naik, tanpa duplikat
