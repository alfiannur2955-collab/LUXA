"""Utilitas Rhino .3dm: konversi mesh rhino3dm/ladybug ke numpy, transformasi blok,
dan tesselasi cadangan untuk BrepFace planar tanpa render mesh (A3-05)."""

from __future__ import annotations

import math
from typing import Any, List, Optional, Sequence, Tuple

import numpy as np
import rhino3dm
from ladybug_geometry.geometry3d.mesh import Mesh3D

_EPS_PT = 1e-6
_EPS_AREA = 1e-10
_EPS_CROSS = 1e-12


def _rhino_mesh_to_numpy(rh_mesh: rhino3dm.Mesh) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    n_v = len(rh_mesh.Vertices)
    n_f = len(rh_mesh.Faces)
    if n_v < 3 or n_f < 1:
        return None
    verts = np.empty((n_v, 3), dtype=np.float64)
    for i in range(n_v):
        v = rh_mesh.Vertices[i]
        verts[i, 0] = v.X
        verts[i, 1] = v.Y
        verts[i, 2] = v.Z

    faces = np.empty((n_f, 4), dtype=np.int64)
    for i in range(n_f):
        f = rh_mesh.Faces[i]
        faces[i, 0] = f[0]
        faces[i, 1] = f[1]
        faces[i, 2] = f[2]
        faces[i, 3] = f[3] if len(f) >= 4 else f[2]
    return verts, faces


def _ladybug_mesh_to_numpy(lb_mesh: Mesh3D) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    verts_lb = lb_mesh.vertices
    faces_lb = lb_mesh.faces
    if len(verts_lb) < 3 or len(faces_lb) < 1:
        return None
    verts = np.array([[p.x, p.y, p.z] for p in verts_lb], dtype=np.float64)
    faces = np.array(
        [[f[0], f[1], f[2], f[3] if len(f) >= 4 else f[2]] for f in faces_lb],
        dtype=np.int64,
    )
    return verts, faces


def _xform_to_matrix(xf: rhino3dm.Transform) -> np.ndarray:
    """Extracts a 4x4 NumPy transformation matrix from a rhino3dm.Transform."""
    mat = np.eye(4, dtype=np.float64)
    try:
        for r in range(4):
            for c in range(4):
                mat[r, c] = float(getattr(xf, f"M{r}{c}"))
    except Exception:
        pass
    return mat


def _apply_xform(verts: np.ndarray, mat4: np.ndarray) -> np.ndarray:
    if np.allclose(mat4, np.eye(4)):
        return verts
    ones = np.ones((len(verts), 1), dtype=np.float64)
    vh = np.hstack([verts, ones])
    vt = vh @ mat4.T
    return vt[:, :3]


# ----------------------------------------------------------------------------
# A3-05: Tesselasi cadangan untuk BrepFace planar (ear clipping + lubang)
# ----------------------------------------------------------------------------

def _signed_area_2d(pts: Sequence[Tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return 0.5 * s


def _cross_2d(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _point_in_triangle_2d(
    p: Tuple[float, float],
    a: Tuple[float, float],
    b: Tuple[float, float],
    c: Tuple[float, float],
    eps: float = 1e-10,
) -> bool:
    c1 = _cross_2d(a, b, p)
    c2 = _cross_2d(b, c, p)
    c3 = _cross_2d(c, a, p)
    return c1 >= -eps and c2 >= -eps and c3 >= -eps


def _segments_properly_intersect(
    a: Tuple[float, float],
    b: Tuple[float, float],
    c: Tuple[float, float],
    d: Tuple[float, float],
) -> bool:
    d1 = _cross_2d(c, d, a)
    d2 = _cross_2d(c, d, b)
    d3 = _cross_2d(a, b, c)
    d4 = _cross_2d(a, b, d)
    if ((d1 > 1e-10 and d2 < -1e-10) or (d1 < -1e-10 and d2 > 1e-10)) and (
        (d3 > 1e-10 and d4 < -1e-10) or (d3 < -1e-10 and d4 > 1e-10)
    ):
        return True
    return False


def _merge_hole_into_ring(
    ring: List[int],
    hole: List[int],
    pts2d: Sequence[Tuple[float, float]],
) -> List[int]:
    """Menyambung satu loop lubang CW ke batas luar CCW lewat jembatan yang saling terlihat (Eberly)."""
    m_pos = max(range(len(hole)), key=lambda i: (pts2d[hole[i]][0], pts2d[hole[i]][1]))
    m_idx = hole[m_pos]
    mx, my = pts2d[m_idx]

    n_r = len(ring)
    best_x = float("inf")
    best_edge = -1
    best_hit_vertex = -1

    for i in range(n_r):
        a = pts2d[ring[i]]
        b = pts2d[ring[(i + 1) % n_r]]
        # Cek jika titik sudut tepat di kanan M pada y yang sama
        if abs(a[1] - my) <= 1e-9 and a[0] >= mx - 1e-9:
            if a[0] < best_x - 1e-9:
                best_x = a[0]
                best_edge = i
                best_hit_vertex = i
        # Cek perpotongan sinar +x dengan segmen (a -> b)
        if (a[1] <= my < b[1]) or (b[1] <= my < a[1]):
            t = (my - a[1]) / (b[1] - a[1])
            ix = a[0] + t * (b[0] - a[0])
            if ix >= mx - 1e-9 and ix < best_x - 1e-9:
                best_x = ix
                best_edge = i
                best_hit_vertex = -1

    vis_pos = -1
    if best_hit_vertex >= 0:
        vis_pos = best_hit_vertex
    elif best_edge >= 0:
        a_pos = best_edge
        b_pos = (best_edge + 1) % n_r
        p_pos = a_pos if pts2d[ring[a_pos]][0] >= pts2d[ring[b_pos]][0] else b_pos
        p_pt = pts2d[ring[p_pos]]
        i_pt = (best_x, my)

        # Cari sudut refleks di dalam segitiga (M, I, P) yang meminimalkan sudut dari sumbu +x
        tri_ccw = _cross_2d((mx, my), i_pt, p_pt) >= 0.0
        ta, tb, tc = ((mx, my), i_pt, p_pt) if tri_ccw else ((mx, my), p_pt, i_pt)

        cand_pos = -1
        cand_key = (float("inf"), float("inf"))
        for i in range(n_r):
            if i == p_pos:
                continue
            r_pt = pts2d[ring[i]]
            if abs(r_pt[0] - p_pt[0]) <= 1e-9 and abs(r_pt[1] - p_pt[1]) <= 1e-9:
                continue
            if abs(r_pt[0] - mx) <= 1e-9 and abs(r_pt[1] - my) <= 1e-9:
                continue
            # Cek apakah sudut refleks pada ring CCW
            prev_pt = pts2d[ring[(i - 1) % n_r]]
            next_pt = pts2d[ring[(i + 1) % n_r]]
            if _cross_2d(prev_pt, r_pt, next_pt) > 1e-10:
                continue
            if _point_in_triangle_2d(r_pt, ta, tb, tc):
                dx = r_pt[0] - mx
                dy = r_pt[1] - my
                dist = math.hypot(dx, dy)
                ang = abs(math.atan2(dy, max(dx, 1e-12)))
                key = (ang, dist)
                if key < cand_key:
                    cand_key = key
                    cand_pos = i
        vis_pos = cand_pos if cand_pos >= 0 else p_pos

    if vis_pos < 0:
        # Cadangan: pilih titik terdekat pada ring yang segmennya tidak memotong tepi ring/lubang
        order = sorted(range(n_r), key=lambda i: math.hypot(pts2d[ring[i]][0] - mx, pts2d[ring[i]][1] - my))
        vis_pos = order[0]
        for i in order:
            v_pt = pts2d[ring[i]]
            blocked = False
            for j in range(n_r):
                if j == i or (j + 1) % n_r == i:
                    continue
                if _segments_properly_intersect((mx, my), v_pt, pts2d[ring[j]], pts2d[ring[(j + 1) % n_r]]):
                    blocked = True
                    break
            if not blocked:
                vis_pos = i
                break

    h_rot = hole[m_pos:] + hole[:m_pos]
    return ring[: vis_pos + 1] + h_rot + [h_rot[0], ring[vis_pos]] + ring[vis_pos + 1 :]


def _ear_clip_2d(ring: Sequence[int], pts2d: Sequence[Tuple[float, float]]) -> List[Tuple[int, int, int]]:
    """Triangulasi ear-clipping untuk poligon 2D sederhana (CCW), aman terhadap titik jembatan ganda."""
    poly = list(ring)
    tris: List[Tuple[int, int, int]] = []

    def _same_pt(i: int, j: int) -> bool:
        a, b = pts2d[i], pts2d[j]
        return abs(a[0] - b[0]) <= 1e-9 and abs(a[1] - b[1]) <= 1e-9

    # Bersihkan duplikat berturut-turut dan duri nol
    changed = True
    while changed and len(poly) >= 3:
        changed = False
        i = 0
        while i < len(poly) and len(poly) >= 3:
            if _same_pt(poly[i], poly[(i + 1) % len(poly)]):
                poly.pop((i + 1) % len(poly))
                changed = True
            else:
                i += 1

    max_guard = max(16, len(poly) * len(poly) + 16)
    steps = 0
    while len(poly) > 3 and steps < max_guard:
        steps += 1
        n = len(poly)
        clipped = False

        # Pass 1: cari telinga konveks ketat tanpa titik lain di dalam segitiga
        for i in range(n):
            ia = poly[(i - 1) % n]
            ib = poly[i]
            ic = poly[(i + 1) % n]
            a, b, c = pts2d[ia], pts2d[ib], pts2d[ic]
            area2 = _cross_2d(a, b, c)
            if area2 <= _EPS_CROSS:
                continue
            has_inside = False
            for j in range(n):
                ij = poly[j]
                if ij == ia or ij == ib or ij == ic:
                    continue
                if _same_pt(ij, ia) or _same_pt(ij, ib) or _same_pt(ij, ic):
                    continue
                if _point_in_triangle_2d(pts2d[ij], a, b, c):
                    has_inside = True
                    break
            if not has_inside:
                tris.append((ia, ib, ic))
                poly.pop(i)
                clipped = True
                break

        if clipped:
            continue

        # Pass 2: buang titik kolinear (area ~ 0) atau duri
        for i in range(n):
            ia = poly[(i - 1) % n]
            ib = poly[i]
            ic = poly[(i + 1) % n]
            if abs(_cross_2d(pts2d[ia], pts2d[ib], pts2d[ic])) <= 1e-9:
                poly.pop(i)
                clipped = True
                break
        if clipped:
            continue

        # Pass 3: toleransi longgar untuk poligon hampir-degenerat
        best_i = -1
        best_area = -1.0
        for i in range(n):
            ia = poly[(i - 1) % n]
            ib = poly[i]
            ic = poly[(i + 1) % n]
            area2 = _cross_2d(pts2d[ia], pts2d[ib], pts2d[ic])
            if area2 > best_area:
                best_area = area2
                best_i = i
        if best_i >= 0 and best_area > _EPS_CROSS:
            ia = poly[(best_i - 1) % n]
            ib = poly[best_i]
            ic = poly[(best_i + 1) % n]
            tris.append((ia, ib, ic))
            poly.pop(best_i)
        else:
            break

    if len(poly) == 3:
        ia, ib, ic = poly
        if abs(_cross_2d(pts2d[ia], pts2d[ib], pts2d[ic])) > _EPS_CROSS:
            tris.append((ia, ib, ic))
    return tris


def _extract_loop_points_3d(brep: rhino3dm.Brep, lp: Any) -> List[Tuple[float, float, float]]:
    pts: List[Tuple[float, float, float]] = []
    n_verts = len(brep.Vertices)
    n_edges = len(brep.Edges)
    trims = lp.Trims
    for ti in range(len(trims)):
        tr = trims[ti]
        ei = tr.EdgeIndex
        if ei < 0 or ei >= n_edges:
            continue
        edge = brep.Edges[ei]
        sv_i = tr.StartVertexIndex
        ev_i = tr.EndVertexIndex
        p_start = brep.Vertices[sv_i].Location if 0 <= sv_i < n_verts else None
        p_end = brep.Vertices[ev_i].Location if 0 <= ev_i < n_verts else None

        is_lin = False
        try:
            is_lin = bool(edge.IsLinear())
        except Exception:
            is_lin = False

        if is_lin and p_start is not None:
            pts.append((float(p_start.X), float(p_start.Y), float(p_start.Z)))
            continue

        # Kurva planar (busur/lingkaran/spline): sampel sepanjang domain tepi
        try:
            dom = edge.Domain
            t0, t1 = float(dom.T0), float(dom.T1)
            q0 = edge.PointAt(t0)
            q1 = edge.PointAt(t1)
            rev = bool(tr.IsReversed)
            if p_start is not None and p_end is not None:
                d_se = math.dist((p_start.X, p_start.Y, p_start.Z), (p_end.X, p_end.Y, p_end.Z))
                if d_se > _EPS_PT:
                    d0 = math.dist((q0.X, q0.Y, q0.Z), (p_start.X, p_start.Y, p_start.Z))
                    d1 = math.dist((q1.X, q1.Y, q1.Z), (p_start.X, p_start.Y, p_start.Z))
                    rev = d1 < d0
            ta, tb = (t1, t0) if rev else (t0, t1)
            is_closed = False
            try:
                is_closed = bool(edge.IsClosed)
            except Exception:
                is_closed = False
            n_seg = 16 if is_closed else 8
            for k in range(n_seg):
                u = ta + (tb - ta) * (k / n_seg)
                pt = edge.PointAt(u)
                pts.append((float(pt.X), float(pt.Y), float(pt.Z)))
        except Exception:
            if p_start is not None:
                pts.append((float(p_start.X), float(p_start.Y), float(p_start.Z)))

    # Hilangkan titik ganda berturut-turut
    dedup: List[Tuple[float, float, float]] = []
    for p in pts:
        if not dedup or math.dist(dedup[-1], p) > _EPS_PT:
            dedup.append(p)
    while len(dedup) >= 2 and math.dist(dedup[-1], dedup[0]) <= _EPS_PT:
        dedup.pop()
    return dedup


def _newell_normal(pts: Sequence[Tuple[float, float, float]]) -> np.ndarray:
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0, z0 = pts[i]
        x1, y1, z1 = pts[(i + 1) % n]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    return np.array([nx, ny, nz], dtype=np.float64)


def tessellate_planar_brep_face(
    brep: rhino3dm.Brep,
    bf: Any,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """Tesselasi cadangan untuk satu BrepFace planar tanpa render mesh.

    Mengembalikan `(verts, faces)` format `(N, 3)` float64 & `(M, 4)` int64
    (segitiga disimpan `[a, b, c, c]`), atau `None` jika face non-planar / degenerat.
    """
    try:
        if not bf.IsPlanar():
            return None
    except Exception:
        return None

    try:
        loops = bf.Loops
        n_loops = len(loops)
    except Exception:
        return None
    if n_loops < 1:
        return None

    outer_type = getattr(rhino3dm.BrepLoopType, "Outer", None)
    inner_type = getattr(rhino3dm.BrepLoopType, "Inner", None)

    outer_pts: Optional[List[Tuple[float, float, float]]] = None
    inner_loops_3d: List[List[Tuple[float, float, float]]] = []
    fallback_loops: List[List[Tuple[float, float, float]]] = []

    for li in range(n_loops):
        lp = loops[li]
        pts = _extract_loop_points_3d(brep, lp)
        if len(pts) < 3:
            continue
        ltype = getattr(lp, "LoopType", None)
        if outer_type is not None and ltype == outer_type and outer_pts is None:
            outer_pts = pts
        elif inner_type is not None and ltype == inner_type:
            inner_loops_3d.append(pts)
        else:
            fallback_loops.append(pts)

    if outer_pts is None:
        if not fallback_loops:
            return None
        # Pilih loop dengan luas proyeksi terbesar sebagai outer loop
        fallback_loops.sort(key=lambda p: float(np.linalg.norm(_newell_normal(p))), reverse=True)
        outer_pts = fallback_loops[0]
        inner_loops_3d.extend(fallback_loops[1:])

    # Tentukan bidang & normal face (menghormati OrientationIsReversed)
    normal = np.zeros(3, dtype=np.float64)
    try:
        du = bf.Domain(0)
        dv = bf.Domain(1)
        n_rh = bf.NormalAt(0.5 * (float(du.T0) + float(du.T1)), 0.5 * (float(dv.T0) + float(dv.T1)))
        normal = np.array([float(n_rh.X), float(n_rh.Y), float(n_rh.Z)], dtype=np.float64)
        if bool(getattr(bf, "OrientationIsReversed", False)):
            normal = -normal
    except Exception:
        pass

    n_len = float(np.linalg.norm(normal))
    if n_len <= 1e-9:
        normal = _newell_normal(outer_pts)
        n_len = float(np.linalg.norm(normal))
    if n_len <= 1e-9:
        return None
    normal = normal / n_len

    origin = np.array(outer_pts[0], dtype=np.float64)
    all_pts_arr = np.array(outer_pts + [p for h in inner_loops_3d for p in h], dtype=np.float64)
    span = np.ptp(all_pts_arr, axis=0)
    diag = float(np.linalg.norm(span))
    if diag <= 1e-7:
        return None
    max_dev = float(np.max(np.abs((all_pts_arr - origin) @ normal)))
    if max_dev > max(1e-3, 1e-3 * diag):
        return None

    ref = np.array([1.0, 0.0, 0.0]) if abs(normal[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u_axis = np.cross(ref, normal)
    u_axis = u_axis / float(np.linalg.norm(u_axis))
    v_axis = np.cross(normal, u_axis)

    def _proj(pts3: Sequence[Tuple[float, float, float]]) -> List[Tuple[float, float]]:
        arr = np.array(pts3, dtype=np.float64) - origin
        return list(zip((arr @ u_axis).tolist(), (arr @ v_axis).tolist()))

    outer_2d = _proj(outer_pts)
    outer_area = _signed_area_2d(outer_2d)
    if abs(outer_area) <= _EPS_AREA:
        return None
    if outer_area < 0.0:
        outer_pts = list(reversed(outer_pts))
        outer_2d = list(reversed(outer_2d))

    pts3d: List[Tuple[float, float, float]] = list(outer_pts)
    pts2d: List[Tuple[float, float]] = list(outer_2d)
    ring: List[int] = list(range(len(outer_pts)))

    valid_holes: List[Tuple[float, List[Tuple[float, float, float]], List[Tuple[float, float]]]] = []
    for h3 in inner_loops_3d:
        h2 = _proj(h3)
        ha = _signed_area_2d(h2)
        if abs(ha) <= _EPS_AREA:
            continue
        if ha > 0.0:
            h3 = list(reversed(h3))
            h2 = list(reversed(h2))
        max_x = max(p[0] for p in h2)
        valid_holes.append((max_x, h3, h2))

    # Urutkan lubang dari paling kanan (x terbesar) agar jembatan tidak saling silang
    valid_holes.sort(key=lambda item: item[0], reverse=True)
    for _, h3, h2 in valid_holes:
        base = len(pts3d)
        pts3d.extend(h3)
        pts2d.extend(h2)
        h_ring = list(range(base, base + len(h3)))
        ring = _merge_hole_into_ring(ring, h_ring, pts2d)

    tris = _ear_clip_2d(ring, pts2d)
    if not tris:
        return None

    verts = np.array(pts3d, dtype=np.float64)
    faces = np.array([[a, b, c, c] for (a, b, c) in tris], dtype=np.int64)
    return verts, faces
