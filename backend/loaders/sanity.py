"""
Pemeriksaan kewajaran geometri sebelum hitung OTTV (Audit langkah 2: AUDIT-02, AUDIT-03).

Nama layer tidak boleh menjadi satu-satunya penentu. Modul ini memeriksa dua hal yang sering
salah di model nyata:

  1. Elemen LINEAR (mullion, transom, rangka): penampang kecil di dua arah, memanjang di arah
     ketiga. Kaca asli hanya tipis di satu arah. Grup "kaca" yang sebagian besar luasnya berupa
     elemen linear hampir pasti rangka yang salah nama.
  2. Face KEMBAR: face dengan posisi, bentuk, dan luas sama (hasil copy-paste tak sengaja,
     objek tertumpuk). Dihitung sekali saja.

Numpy murni (tanpa scipy) agar jalan juga di Pyodide.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Dict, List, Tuple

import numpy as np

from .types import RawGroupMesh

LINEAR_MAX_SECTION_M = 0.30   # dua dimensi terkecil <= 30 cm
LINEAR_MIN_THICK_M = 0.035    # dimensi terkecil > 3,5 cm (kaca IGU 24-32 mm tidak tertangkap)
LINEAR_MIN_ASPECT = 3.0       # dimensi terbesar >= 3x dimensi tengah
LINEAR_GROUP_FRACTION = 0.60  # >= 60% luas grup berupa elemen linear
_MAX_COMPONENT_SAMPLES = 600


def face_components(faces: np.ndarray) -> np.ndarray:
    """Label komponen terhubung per face (face yang berbagi vertex = satu elemen)."""
    if len(faces) == 0:
        return np.zeros(0, dtype=np.int64)
    faces = np.asarray(faces, dtype=np.int64)
    nv = int(faces.max()) + 1
    lab = np.arange(nv, dtype=np.int64)
    flat = faces.ravel()
    k = faces.shape[1]
    for _ in range(200):
        f_lab = lab[faces].min(axis=1)
        new = lab.copy()
        np.minimum.at(new, flat, np.repeat(f_lab, k))
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    return lab[faces].min(axis=1)


def face_areas(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    v = vertices[faces]  # (F, 4, 3)
    a1 = np.linalg.norm(np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]), axis=1)
    a2 = np.linalg.norm(np.cross(v[:, 2] - v[:, 0], v[:, 3] - v[:, 0]), axis=1)
    return 0.5 * (a1 + a2)


def _oriented_extents(pts: np.ndarray) -> np.ndarray:
    """Panjang elemen pada tiga sumbu utamanya (PCA), urut kecil -> besar."""
    if len(pts) < 2:
        return np.zeros(3)
    c = pts - pts.mean(axis=0)
    try:
        _, _, vt = np.linalg.svd(c, full_matrices=False)
    except np.linalg.LinAlgError:
        return np.zeros(3)
    proj = c @ vt.T
    ext = np.ptp(proj, axis=0)
    if len(ext) < 3:
        ext = np.concatenate([ext, np.zeros(3 - len(ext))])
    return np.sort(ext)


def linear_area_fraction(rg: RawGroupMesh) -> float:
    """Fraksi luas grup yang berupa elemen linear (berbentuk batang/profil)."""
    faces = np.asarray(rg.faces, dtype=np.int64)
    if len(faces) == 0:
        return 0.0
    verts = np.asarray(rg.vertices, dtype=np.float64)
    areas = face_areas(verts, faces)
    total = float(areas.sum())
    if total <= 1e-9:
        return 0.0
    # Las vertex berdasarkan posisi (1 mm): mesh hasil Rhino/ekspor sering tidak berbagi vertex antar-face,
    # sehingga satu kotak mullion akan terbaca sebagai enam bidang lepas.
    _, weld = np.unique(np.round(verts / 0.001).astype(np.int64), axis=0, return_inverse=True)
    weld = np.asarray(weld).reshape(-1)
    comp = face_components(weld[faces])
    uniq, inv = np.unique(comp, return_inverse=True)
    comp_area = np.bincount(inv, weights=areas)
    idx = np.arange(len(uniq))
    if len(idx) > _MAX_COMPONENT_SAMPLES:
        rng = np.random.default_rng(0)
        idx = rng.choice(idx, size=_MAX_COMPONENT_SAMPLES, replace=False, p=comp_area / comp_area.sum())
    order = np.argsort(inv, kind="stable")
    bounds = np.searchsorted(inv[order], np.arange(len(uniq) + 1))
    lin_area = 0.0
    samp_area = 0.0
    for ci in idx:
        f_idx = order[bounds[ci]:bounds[ci + 1]]
        pts = verts[np.unique(faces[f_idx])]
        e = _oriented_extents(pts)
        samp_area += comp_area[ci]
        if e[0] >= LINEAR_MIN_THICK_M and e[1] <= LINEAR_MAX_SECTION_M and e[2] >= LINEAR_MIN_ASPECT * max(e[1], 1e-6):
            lin_area += comp_area[ci]
    return float(lin_area / samp_area) if samp_area > 0 else 0.0


def looks_like_frame(rg: RawGroupMesh) -> Tuple[bool, float]:
    frac = linear_area_fraction(rg)
    return frac >= LINEAR_GROUP_FRACTION, frac


_CAT_PRIORITY = {"glazing": 0, "composite_cw": 1, "spandrel": 2, "wall": 3}


def dedupe_surface_groups(
    surface_groups: List[Tuple[RawGroupMesh, str]],
) -> Tuple[List[Tuple[RawGroupMesh, str]], Dict]:
    """Buang face kembar di seluruh grup selubung. Bila kembar lintas kategori (mis. kaca menimpa
    dinding), face dengan prioritas kaca > spandrel > dinding yang dipertahankan dan dicatat sebagai
    konflik. Mengembalikan grup baru (objek asli/cache tidak diubah) + statistik."""
    if not surface_groups:
        return surface_groups, {"removed_faces": 0, "removed_area_m2": 0.0, "groups": [], "conflicts": []}
    keys, owners, areas_all = [], [], []
    for gi, (rg, cat) in enumerate(surface_groups):
        f = np.asarray(rg.faces, dtype=np.int64)
        v = np.asarray(rg.vertices, dtype=np.float64)
        if len(f) == 0:
            continue
        p = v[f]  # (F,4,3)
        is_tri = f[:, 2] == f[:, 3]
        n_pts = np.where(is_tri, 3, 4)[:, None]
        cen = np.where(is_tri[:, None], p[:, :3].mean(axis=1), p.mean(axis=1))
        spread = (np.linalg.norm(p - cen[:, None, :], axis=2) * np.where(is_tri[:, None], [1, 1, 1, 0], 1)).sum(axis=1) / n_pts[:, 0]
        ar = face_areas(v, f)
        key = np.column_stack([
            np.round(cen / 0.005), np.round(ar / 0.002)[:, None], np.round(spread / 0.002)[:, None],
        ]).astype(np.int64)
        keys.append(key)
        owners.append(np.column_stack([np.full(len(f), gi), np.arange(len(f)), np.full(len(f), _CAT_PRIORITY.get(cat, 9))]))
        areas_all.append(ar)
    if not keys:
        return surface_groups, {"removed_faces": 0, "removed_area_m2": 0.0, "groups": [], "conflicts": []}
    K = np.vstack(keys)
    O = np.vstack(owners)
    A = np.concatenate(areas_all)
    # Urut: kunci, lalu prioritas kategori, lalu urutan grup -> wakil pertama tiap kunci dipertahankan
    order = np.lexsort((O[:, 1], O[:, 0], O[:, 2]) + tuple(K[:, i] for i in range(K.shape[1] - 1, -1, -1)))
    Ks = K[order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = np.any(Ks[1:] != Ks[:-1], axis=1)
    drop = order[~first]
    stats = {"removed_faces": int(len(drop)), "removed_area_m2": round(float(A[drop].sum()), 2), "groups": [], "conflicts": []}
    if len(drop) == 0:
        return surface_groups, stats
    # Konflik lintas kategori: face yang dibuang berbeda kategori dengan wakilnya
    keep_owner = np.empty(len(order), dtype=np.int64)
    rep = -1
    for j, is_first in enumerate(first):
        if is_first:
            rep = order[j]
        keep_owner[j] = rep
    conflict_pairs: Dict[Tuple[int, int], float] = {}
    for j in np.where(~first)[0]:
        d, kpt = order[j], keep_owner[j]
        if O[d, 2] != O[kpt, 2]:
            pair = (int(O[kpt, 0]), int(O[d, 0]))
            conflict_pairs[pair] = conflict_pairs.get(pair, 0.0) + float(A[d])
    drop_by_group: Dict[int, List[int]] = {}
    for d in drop:
        drop_by_group.setdefault(int(O[d, 0]), []).append(int(O[d, 1]))
    out: List[Tuple[RawGroupMesh, str]] = []
    for gi, (rg, cat) in enumerate(surface_groups):
        if gi in drop_by_group:
            mask = np.ones(len(rg.faces), dtype=bool)
            mask[drop_by_group[gi]] = False
            stats["groups"].append({
                "group_name": rg.group_name,
                "removed_faces": int((~mask).sum()),
                "removed_area_m2": round(float(face_areas(np.asarray(rg.vertices), np.asarray(rg.faces)[~mask]).sum()), 2),
            })
            if mask.any():
                out.append((replace(rg, faces=np.asarray(rg.faces)[mask]), cat))
            continue
        out.append((rg, cat))
    for (gk, gd), ar in conflict_pairs.items():
        stats["conflicts"].append({
            "kept_group": surface_groups[gk][0].group_name, "kept_category": surface_groups[gk][1],
            "dropped_group": surface_groups[gd][0].group_name, "dropped_category": surface_groups[gd][1],
            "area_m2": round(ar, 2),
        })
    return out, stats
